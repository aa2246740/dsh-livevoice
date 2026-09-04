import { DEFAULT_LIVE_VOICE, type LiveVoice, resolveLiveVoice } from '../voices.js'
import {
  fetchLiveStatus,
  startLiveCall,
  stopLiveCall,
  subscribeLiveEvents,
  type LiveStatus,
  type LiveUiEvent,
} from './api.js'
import { createLevelMonitor } from './levels.js'
import { unlockPlayback, type PreparedPlayback } from './playback.js'
import { acceptLiveAnswer, createLivePeer, type LivePeer } from './webrtc.js'
import { isLiveSessionProof, parseLiveServerEvent, type LivePhase } from '../protocol.js'

const VOICE_KEY = 'dsh-livevoice.voice'
const voiceHub = new Set<() => void>()

export function storedLiveVoice(): LiveVoice {
  return loadVoice()
}

export function subscribeStoredVoice(listener: () => void): () => void {
  voiceHub.add(listener)
  return () => { voiceHub.delete(listener) }
}

export function chooseStoredVoice(voice: LiveVoice): void {
  saveVoice(voice)
  for (const listener of voiceHub) listener()
}

export interface LiveClientState {
  phase: LivePhase | 'idle'
  stage?: string
  dialStartedAt?: number
  muted: boolean
  inputLevel: number
  outputLevel: number
  transcript?: { role: 'user' | 'assistant'; text: string; final: boolean }
  error?: string
  voice: LiveVoice
  status?: LiveStatus
  capture?: string
}

export type LiveClientListener = (state: LiveClientState) => void

export class LiveClientSession {
  private readonly listeners = new Set<LiveClientListener>()
  private peer: LivePeer | undefined
  private playback: PreparedPlayback | undefined
  private remoteStream: MediaStream | undefined
  private stopEvents: (() => void) | undefined
  private stopInputLevels: (() => void) | undefined
  private callToken: string | undefined
  private starting = false
  private startGen = 0
  private mediaSessionReady = false
  private resolveMediaSession: (() => void) | undefined
  private state: LiveClientState = {
    phase: 'idle',
    muted: false,
    inputLevel: 0,
    outputLevel: 0,
    voice: loadVoice(),
  }

  constructor(private readonly sessionId: string) {
    subscribeStoredVoice(() => {
      const next = loadVoice()
      if (next === this.state.voice) return
      if (this.state.phase !== 'idle' || this.starting) return
      this.patch({ voice: next })
    })
  }

  get snapshot(): LiveClientState {
    return this.state
  }

  subscribe(listener: LiveClientListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  async refreshStatus(): Promise<void> {
    try {
      const status = await fetchLiveStatus()
      this.patch({ status, voice: resolveLiveVoice(this.state.voice || status.defaultVoice) })
    } catch (error) {
      this.patch({
        status: {
          ready: false,
          source: 'none',
          voices: [],
          defaultVoice: DEFAULT_LIVE_VOICE,
        },
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  setVoice(voice: LiveVoice): void {
    saveVoice(voice)
    this.patch({ voice })
  }

  async switchVoice(voice: LiveVoice): Promise<void> {
    const previous = this.state.voice
    this.setVoice(voice)
    if (voice === previous) return
    if (this.state.phase === 'idle' && !this.starting) return
    await this.stop()
    await this.start()
  }

  async toggle(): Promise<void> {
    if (this.state.phase !== 'idle') {
      await this.stop()
      return
    }
    await this.start()
  }

  retryPlayback(): void {
    this.playback?.retry()
  }

  toggleMute(): void {
    if (this.state.phase === 'idle') return
    const muted = !this.state.muted
    this.peer?.setMuted(muted)
    this.patch({
      muted,
      phase: muted ? 'muted' : this.state.phase === 'muted' ? 'listening' : this.state.phase,
      inputLevel: muted ? 0 : this.state.inputLevel,
    })
  }

  async start(): Promise<void> {
    if (this.state.phase !== 'idle') return
    const gen = ++this.startGen
    this.starting = true
    this.mediaSessionReady = false
    this.patch({
      phase: 'connecting',
      stage: 'dial.mic',
      dialStartedAt: Date.now(),
      error: undefined,
      transcript: undefined,
      voice: loadVoice(),
    })
    const playback = unlockPlayback()
    this.playback = playback
    try {
      if (this.state.status?.ready !== true) {
        await this.refreshStatus()
      }
      if (this.state.status?.ready !== true) {
        throw new Error(this.state.status
          ? 'No Codex OAuth credential is available. Sign in to ChatGPT Codex first.'
          : 'Live voice status is unavailable.')
      }
      this.patch({ stage: 'dial.offer' })
      const created = await createLivePeer({
        onRemoteStream: stream => {
          this.remoteStream = stream
          playback.attach(stream)
        },
        onIceState: () => {
          if (this.state.phase === 'connecting') {
            this.patch({ stage: 'dial.media' })
          }
        },
        onControlPayload: payload => this.applyControlPayload(payload),
      })
      this.peer = created.peer
      this.patch({ capture: created.peer.captureLabel })
      this.stopInputLevels = createLevelMonitor(created.peer.localStream, (level) => {
        if (this.state.muted) {
          if (this.state.inputLevel !== 0) this.patch({ inputLevel: 0 })
          return
        }
        if (Math.abs(level - this.state.inputLevel) < 0.02) return
        this.patch({ inputLevel: level })
      })
      this.patch({ stage: 'dial.codex' })
      const call = await startLiveCall({
        sessionId: this.sessionId,
        sdp: created.offer,
        voice: this.state.voice,
      })
      this.callToken = call.callToken
      this.stopEvents = subscribeLiveEvents(call.callToken, (event) => this.handleEvent(event))
      this.patch({ stage: 'dial.media' })
      await acceptLiveAnswer(created.peer, call.answer)
      this.trace('ice+oai-events')
      this.patch({ stage: 'dial.ear' })
      await this.waitForMediaSession(20_000)
      this.trace(this.mediaSessionReady ? 'session-proof' : 'listening-without-proof')
      if (gen !== this.startGen || !this.peer) return
      this.patch({
        phase: this.state.muted ? 'muted' : 'listening',
        stage: undefined,
        dialStartedAt: undefined,
      })
    } catch (error) {
      if (gen !== this.startGen || this.state.phase === 'idle') return
      await this.stop(error instanceof Error ? error.message : String(error))
    } finally {
      if (gen === this.startGen) this.starting = false
    }
  }

  async stop(error?: string): Promise<void> {
    this.startGen += 1
    this.starting = false
    this.resolveMediaSession?.()
    this.resolveMediaSession = undefined
    this.mediaSessionReady = false
    const callToken = this.callToken
    this.callToken = undefined
    this.stopEvents?.()
    this.stopEvents = undefined
    this.stopInputLevels?.()
    this.stopInputLevels = undefined
    this.playback?.stop()
    this.playback = undefined
    this.remoteStream = undefined
    this.peer?.close()
    this.peer = undefined
    if (callToken) {
      try {
        await stopLiveCall(callToken)
      } catch {
        // Local teardown still completes if the host call is already gone.
      }
    }
    this.patch({
      phase: 'idle',
      stage: undefined,
      dialStartedAt: undefined,
      muted: false,
      inputLevel: 0,
      outputLevel: 0,
      capture: undefined,
      ...error === undefined ? { error: this.state.error } : { error },
    })
  }

  private applyControlPayload(payload: string): void {
    const event = parseLiveServerEvent(payload)
    if (event && isLiveSessionProof(event)) this.markMediaSessionReady()
    if (event?.type === 'error') this.handleEvent({ type: 'error', message: event.message })
  }

  private handleEvent(event: LiveUiEvent): void {
    if (event.type === 'phase') {
      if (this.starting && event.phase === 'listening') return
      const phase = this.state.muted ? 'muted' : event.phase
      this.patch({
        phase,
        ...event.phase === 'listening' || event.phase === 'speaking' || event.phase === 'working' || event.phase === 'error'
          ? { stage: undefined, dialStartedAt: undefined }
          : {},
      })
      if (event.phase === 'working' || event.phase === 'speaking' || event.phase === 'muted') {
        this.markMediaSessionReady()
      }
      return
    }
    if (event.type === 'transcript') {
      if (event.transcript) this.markMediaSessionReady()
      this.patch({
        transcript: event.transcript
          ? { role: event.transcript.role, text: event.transcript.text, final: event.transcript.final }
          : undefined,
        stage: undefined,
      })
      return
    }
    if (event.type === 'error') {
      void this.stop(event.message)
      return
    }
    if (event.type === 'closed') {
      void this.stop()
    }
  }

  private waitForMediaSession(ms: number): Promise<void> {
    if (this.mediaSessionReady) return Promise.resolve()
    return new Promise(resolve => {
      const timer = window.setTimeout(() => {
        this.resolveMediaSession = undefined
        resolve()
      }, ms)
      this.resolveMediaSession = () => {
        window.clearTimeout(timer)
        this.resolveMediaSession = undefined
        resolve()
      }
    })
  }

  private markMediaSessionReady(): void {
    if (!this.mediaSessionReady) this.trace('session-proof')
    this.mediaSessionReady = true
    this.resolveMediaSession?.()
  }

  private trace(label: string): void {
    const started = this.state.dialStartedAt
    const elapsed = started === undefined ? 0 : Date.now() - started
    console.log(`[dsh-livevoice] +${elapsed}ms ${label}`)
  }

  private patch(patch: Partial<LiveClientState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }
}

function loadVoice(): LiveVoice {
  try {
    return resolveLiveVoice(window.localStorage.getItem(VOICE_KEY) ?? undefined)
  } catch {
    return DEFAULT_LIVE_VOICE
  }
}

function saveVoice(voice: LiveVoice): void {
  try {
    window.localStorage.setItem(VOICE_KEY, voice)
  } catch {
    // Private mode can refuse localStorage.
  }
}
