import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { CodexAccess } from './auth.js'
import { presentFinalTranscript } from './conversation.js'
import {
  applyDelegationInput,
  type DelegationJob,
} from './delegation.js'
import { briefLiveDelegation, renderWorkerHandoff, type TranscriptLine } from './handoff.js'
import { PLUGIN_ID } from './ids.js'
import { livePhaseForSpeech, liveWorkRoute, openTurnNumber } from './work.js'
import type { LiveProxy } from './proxy.js'
import {
  buildDelegationContextAppend,
  chunkLiveContext,
  type LiveClientMessage,
  type LivePhase,
  type LiveServerEvent,
} from './protocol.js'
import {
  emptyTranscriptState,
  ingestLiveEvent,
  type LiveTranscript,
  type TranscriptState,
} from './transcript.js'

export type { LiveTranscript }
import { renderAgentFinalMessage, renderLiveInstructions } from './prompts.js'
import { LiveSideband } from './sideband.js'
import { signalLiveCall } from './signaling.js'
import { hasToolCalls, lastAssistantTextForTurn, textFromBlocks } from './text.js'
import { resolveLiveVoice } from './voices.js'

export type LiveUiEvent =
  | { type: 'phase'; phase: LivePhase }
  | { type: 'transcript'; transcript: LiveTranscript | undefined }
  | { type: 'error'; message: string }
  | { type: 'closed' }

export interface LiveCallHandle {
  readonly callToken: string
  readonly callId: string
  readonly answer: string
  readonly voice: string
  readonly sessionId: string
  subscribe(listener: (event: LiveUiEvent) => void): () => void
  close(): Promise<void>
}

export class LiveCallRegistry {
  private readonly calls = new Map<string, LiveCallSession>()

  constructor(
    private readonly resolveAgent: (sessionId: string) => Agent | undefined,
    private readonly resolveAccess: () => Promise<CodexAccess>,
    private readonly proxy: LiveProxy,
  ) {}

  async start(input: {
    sessionId: string
    offer: string
    voice?: string
  }): Promise<LiveCallHandle> {
    const agent = this.resolveAgent(input.sessionId)
    if (agent === undefined) {
      throw new Error(`Session ${input.sessionId} is not active.`)
    }
    await this.closeAll()
    const voice = resolveLiveVoice(input.voice)
    const access = await this.resolveAccess()
    const realtimeSessionId = crypto.randomUUID()
    const abort = new AbortController()
    const signaling = await signalLiveCall({
      access,
      sessionId: input.sessionId,
      realtimeSessionId,
      offer: input.offer,
      instructions: renderLiveInstructions(),
      voice,
      proxy: this.proxy,
      signal: abort.signal,
    })
    const callToken = crypto.randomUUID()
    const session = new LiveCallSession({
      callToken,
      callId: signaling.callId,
      answer: signaling.answer,
      voice,
      sessionId: input.sessionId,
      agent,
      access,
      realtimeSessionId,
      proxy: this.proxy,
      abort,
    })
    this.calls.set(callToken, session)
    try {
      await session.connect()
    } catch (error) {
      this.calls.delete(callToken)
      await session.close()
      throw error
    }
    return {
      callToken,
      callId: signaling.callId,
      answer: signaling.answer,
      voice,
      sessionId: input.sessionId,
      subscribe: listener => session.subscribe(listener),
      close: async () => {
        this.calls.delete(callToken)
        await session.close()
      },
    }
  }

  get(callToken: string): LiveCallHandle | undefined {
    const session = this.calls.get(callToken)
    if (session === undefined) return undefined
    return {
      callToken: session.callToken,
      callId: session.callId,
      answer: session.answer,
      voice: session.voice,
      sessionId: session.sessionId,
      subscribe: listener => session.subscribe(listener),
      close: async () => {
        this.calls.delete(callToken)
        await session.close()
      },
    }
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.calls.values()]
    this.calls.clear()
    await Promise.all(sessions.map(session => session.close()))
  }
}

class LiveCallSession {
  readonly callToken: string
  readonly callId: string
  readonly answer: string
  readonly voice: string
  readonly sessionId: string

  private readonly agent: Agent
  private readonly abort: AbortController
  private readonly listeners = new Set<(event: LiveUiEvent) => void>()
  private readonly offAgent: () => void
  private sideband: LiveSideband | undefined
  private sendChain: Promise<void> = Promise.resolve()
  private closed = false
  private phase: LivePhase = 'connecting'
  private job: DelegationJob | undefined
  private transcripts: TranscriptState = emptyTranscriptState()
  private lastTranscript: LiveTranscript | undefined
  private spoken: TranscriptLine[] = []
  private readonly t0 = Date.now()
  private readonly marks = new Set<string>()

  constructor(options: {
    callToken: string
    callId: string
    answer: string
    voice: string
    sessionId: string
    agent: Agent
    access: CodexAccess
    realtimeSessionId: string
    proxy: LiveProxy
    abort: AbortController
  }) {
    this.callToken = options.callToken
    this.callId = options.callId
    this.answer = options.answer
    this.voice = options.voice
    this.sessionId = options.sessionId
    this.agent = options.agent
    this.abort = options.abort
    this.sideband = new LiveSideband(
      options.access,
      options.sessionId,
      options.realtimeSessionId,
      options.proxy,
      {
        onEvent: event => this.handleLiveEvent(event),
        onClose: reason => this.fail(reason),
      },
      options.abort.signal,
    )
    const offs = [
      this.agent.ctx.on('session/event', (session: Session, event: SessionEvent) => {
        if (session.id !== this.agent.session.id) return
        this.handleSessionEvent(event)
      }),
      this.agent.ctx.on('agent/inbox/claimed', ({ message, turn }) => {
        this.applyJob({ type: 'claimed', messageId: message.id, turn })
      }),
      this.agent.ctx.on('agent/inbox/discarded', ({ message }) => {
        this.applyJob({ type: 'discarded', messageId: message.id })
        if (this.job === undefined && this.phase === 'working') this.emitPhase('listening')
      }),
    ]
    this.offAgent = () => {
      for (const off of offs) off()
    }
  }

  async connect(): Promise<void> {
    if (!this.sideband) throw new Error('Live sideband is missing')
    await this.sideband.connect(this.callId)
    // session.started rides the client's oai-events channel after this answer
    // is applied. Waiting for it here deadlocks signaling against ICE.
    this.mark('sideband')
    this.emitPhase('listening')
  }

  subscribe(listener: (event: LiveUiEvent) => void): () => void {
    this.listeners.add(listener)
    listener({ type: 'phase', phase: this.phase })
    if (this.lastTranscript) listener({ type: 'transcript', transcript: this.lastTranscript })
    return () => { this.listeners.delete(listener) }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    this.offAgent()
    await this.sendChain
    const sideband = this.sideband
    this.sideband = undefined
    await sideband?.close()
    this.emit({ type: 'closed' })
    this.listeners.clear()
  }

  private handleLiveEvent(event: LiveServerEvent): void {
    if (this.closed) return
    switch (event.type) {
      case 'session.started':
        this.mark('session.started')
        this.emitPhase('listening')
        break
      case 'input_transcript.added':
        this.mark('first-asr')
        this.applyTranscript(event)
        break
      case 'output_transcript.added':
        this.mark('first-tts')
        this.applyTranscript(event)
        break
      case 'turn.created':
      case 'turn.delta':
      case 'turn.done':
        this.applyTranscript(event)
        break
      case 'delegation.created':
        this.mark('delegation')
        this.handleDelegation(event)
        break
      case 'error':
        this.fail(event.message)
        break
      case 'unknown':
        if (event.wireType !== 'session.usage.updated') {
          console.log(`[dsh-livevoice] unknown live event ${event.wireType}`)
        }
        break
      default:
        break
    }
  }

  private handleDelegation(event: Extract<LiveServerEvent, { type: 'delegation.created' }>): void {
    let request = ''
    for (const content of event.item.content) {
      if (content.type !== 'input_text') continue
      request += `${request ? '\n' : ''}${content.text}`
    }
    const lastSpokenUser = [...this.spoken].reverse().find(line => line.role === 'user')?.text
    const openUser = this.transcripts.user.text
    const lastUser = openUser || lastSpokenUser
    const input = briefLiveDelegation({ liveText: request, lastUserSpeech: lastUser })
    if (input === undefined) return
    const handoff = renderWorkerHandoff({
      input,
      transcriptDelta: this.spoken,
    })
    if (handoff === undefined) return
    const message = createUserMessage({
      content: [{ type: 'text', text: handoff }],
      source: { kind: 'plugin', plugin: PLUGIN_ID },
    })
    this.applyJob({ type: 'created', liveId: event.item.id, messageId: message.id })
    this.emitPhase('working')
    const steer = liveWorkRoute(this.agent.status) === 'steer'
      && openTurnNumber(this.agent.session.snapshotEvents()) !== undefined
    try {
      if (steer) this.agent.steer(message)
      else this.agent.followup(message)
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private handleSessionEvent(event: SessionEvent): void {
    if (this.closed || this.job === undefined) return
    if (event.type === 'assistant/message') {
      if (this.job.claimedTurn !== event.data.turn) return
      if (hasToolCalls(event.data.message.content)) {
        this.fanout(this.job.liveIds, textFromBlocks(event.data.message.content), 'commentary')
      }
      return
    }
    if (event.type === 'turn/end') {
      const applied = this.applyJob({ type: 'turn-end', turn: event.data.turn })
      if (applied.finalizeTurn !== undefined && applied.finalizeLiveIds !== undefined) {
        this.appendFinalResponse(applied.finalizeTurn, applied.finalizeLiveIds)
      }
    }
  }

  private applyJob(input: Parameters<typeof applyDelegationInput>[1]): ReturnType<typeof applyDelegationInput> {
    const applied = applyDelegationInput(this.job, input)
    this.job = applied.job
    return applied
  }

  private fanout(liveIds: readonly string[], text: string, channel?: 'commentary'): void {
    const trimmed = text.trim()
    if (!trimmed || liveIds.length === 0) return
    for (const liveId of liveIds) {
      for (const chunk of chunkLiveContext(trimmed)) {
        this.queueSend(buildDelegationContextAppend(liveId, chunk, channel))
      }
    }
  }

  private appendFinalResponse(turn: number, liveIds: readonly string[]): void {
    const text = lastAssistantTextForTurn(this.agent.session.snapshotEvents(), turn).trim()
    if (text) this.fanout(liveIds, renderAgentFinalMessage(text))
    this.emitPhase('listening')
  }

  private applyTranscript(event: LiveServerEvent): void {
    const result = ingestLiveEvent(this.transcripts, event)
    if (result === null) return
    const updates = Array.isArray(result) ? result : [result]
    for (const update of updates) {
      this.transcripts = update.state
      const duplicate = this.lastTranscript?.role === update.emit.role
        && this.lastTranscript.turn === update.emit.turn
        && this.lastTranscript.text === update.emit.text
        && this.lastTranscript.final === update.emit.final
      if (!duplicate) {
        this.lastTranscript = update.emit
        this.emit({ type: 'transcript', transcript: update.emit })
        const phase = livePhaseForSpeech({
          backendWorking: this.job !== undefined,
          role: update.emit.role,
          final: update.emit.final,
        })
        if (phase !== undefined) this.emitPhase(phase)
      }
      if (!update.present) continue
      this.spoken.push({ role: update.present.role, text: update.present.text })
      try {
        presentFinalTranscript(this.agent.session, {
          role: update.present.role,
          text: update.present.text,
          backendWorking: this.job !== undefined,
        })
      } catch {
        // Conversation present must not take down the live call.
      }
    }
  }

  private queueSend(message: LiveClientMessage): void {
    const sideband = this.sideband
    if (!sideband || this.closed) return
    this.sendChain = this.sendChain
      .then(async () => {
        if (!this.closed) await sideband.send(message)
      })
      .catch(error => this.fail(error instanceof Error ? error.message : String(error)))
  }

  private emitPhase(phase: LivePhase): void {
    if (this.phase === phase) return
    this.phase = phase
    this.emit({ type: 'phase', phase })
  }

  private fail(message: string): void {
    if (this.closed) return
    this.phase = 'error'
    this.emit({ type: 'error', message })
    void this.close()
  }

  private emit(event: LiveUiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // UI listeners must not take down the live call.
      }
    }
  }

  private mark(label: string): void {
    if (this.marks.has(label)) return
    this.marks.add(label)
    console.log(`[dsh-livevoice] +${Date.now() - this.t0}ms ${label} ${this.callId}`)
  }
}
