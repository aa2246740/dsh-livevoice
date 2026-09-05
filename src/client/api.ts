import {
  LIVE_CALLS_PATH,
  LIVE_EVENTS_PATH,
  LIVE_STATUS_PATH,
  LIVE_STOP_PATH,
} from '../ids.js'
import type { LivePhase, LiveServerEvent } from '../protocol.js'
import type { LiveTaskReceipt } from '../receipts.js'
import type { LiveVoice } from '../voices.js'

export interface LiveStatus {
  ready: boolean
  source: 'dsh-oauth-login' | 'dsh-llm' | 'codex-cli' | 'none'
  expiresAt?: number
  voices: readonly { value: LiveVoice; label: string }[]
  defaultVoice: LiveVoice
}

export interface LiveCallResponse {
  callToken: string
  callId: string
  answer: string
  voice: LiveVoice
}

export type LiveUiEvent =
  | { type: 'ready' }
  | { type: 'phase'; phase: LivePhase }
  | { type: 'transcript'; transcript?: { role: 'user' | 'assistant'; text: string; turn: number; final: boolean } }
  | { type: 'task-receipt'; receipt: LiveTaskReceipt }
  | { type: 'error'; message: string }
  | { type: 'closed' }

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  const parsed: unknown = text.length === 0 ? {} : JSON.parse(text)
  if (!response.ok) {
    const message = typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string'
      ? parsed.error
      : `Live voice request failed (${response.status})`
    throw new Error(message)
  }
  return parsed as T
}

export async function fetchLiveStatus(): Promise<LiveStatus> {
  return readJson<LiveStatus>(await fetch(LIVE_STATUS_PATH))
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const abort = new AbortController()
  const timer = window.setTimeout(() => abort.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: abort.signal, credentials: 'same-origin' })
  } catch (error) {
    if (abort.signal.aborted) throw new Error(`Live voice request timed out after ${Math.round(timeoutMs / 1000)}s`)
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function startLiveCall(input: {
  sessionId: string
  sdp: string
  voice: LiveVoice
}): Promise<LiveCallResponse> {
  return readJson<LiveCallResponse>(await fetchWithTimeout(LIVE_CALLS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: input.sessionId, sdp: input.sdp, voice: input.voice }),
  }, 40_000))
}

export async function stopLiveCall(callToken: string): Promise<void> {
  await readJson(await fetch(LIVE_STOP_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callToken }),
  }))
}

export function subscribeLiveEvents(
  callToken: string,
  onEvent: (event: LiveUiEvent) => void,
): () => void {
  const source = new EventSource(`${LIVE_EVENTS_PATH}?call=${encodeURIComponent(callToken)}`)
  let terminalReported = false
  const handle = (message: Event): void => {
    if (!(message instanceof MessageEvent) || typeof message.data !== 'string') return
    try {
      onEvent(JSON.parse(message.data) as LiveUiEvent)
    } catch {
      // Ignore a malformed frame; the next event still updates the UI.
    }
  }
  const handleSourceError = (event: Event): void => {
    if (event instanceof MessageEvent) {
      handle(event)
      return
    }
    if (terminalReported || source.readyState !== EventSource.CLOSED) return
    terminalReported = true
    source.close()
    onEvent({
      type: 'error',
      message: 'Live voice call ended or was replaced. Try again.',
    })
  }
  source.addEventListener('phase', handle)
  source.addEventListener('ready', handle)
  source.addEventListener('transcript', handle)
  source.addEventListener('task-receipt', handle)
  source.addEventListener('error', handleSourceError)
  source.addEventListener('closed', handle)
  return () => { source.close() }
}

export type { LiveServerEvent }
