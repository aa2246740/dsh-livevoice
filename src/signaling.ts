import { fetch } from 'undici'
import type { CodexAccess } from './auth.js'
import { OPENAI_HEADERS, parseLiveCallId, SIGNALING_URL } from './catalog.js'
import { liveSessionHeaders } from './headers.js'
import { LIVE_ORIGINATOR } from './ids.js'
import type { LiveProxy } from './proxy.js'
import { buildLiveSessionPayload } from './protocol.js'
import { prepareRemoteSdp } from './sdp.js'

const MAX_ERROR_BODY_LENGTH = 2_048

export class LiveSignalingError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'LiveSignalingError'
    this.status = status
  }
}

export interface LiveSignalingResult {
  readonly answer: string
  readonly callId: string
}

function boundedErrorBody(body: string, statusText: string): string {
  const normalized = body.trim().replaceAll(/\s+/g, ' ')
  if (!normalized) return statusText || 'empty response body'
  if (normalized.length <= MAX_ERROR_BODY_LENGTH) return normalized
  return `${normalized.slice(0, MAX_ERROR_BODY_LENGTH)}…`
}

const WARMUP_URLS = [SIGNALING_URL, 'https://api.openai.com/'] as const

export function warmupLiveSignaling(proxy: LiveProxy): void {
  for (const url of WARMUP_URLS) {
    try {
      void fetch(url, {
        method: 'HEAD',
        dispatcher: proxy.dispatcher(),
        headers: {
          [OPENAI_HEADERS.ORIGINATOR]: LIVE_ORIGINATOR,
        },
      }).catch(() => {})
    } catch {
      // Status JSON and plugin boot must not fail if HEAD construction throws.
    }
  }
}

export async function signalLiveCall(options: {
  readonly access: CodexAccess
  readonly sessionId: string
  readonly realtimeSessionId: string
  readonly offer: string
  readonly instructions: string
  readonly voice: string
  readonly proxy: LiveProxy
  readonly signal?: AbortSignal
}): Promise<LiveSignalingResult> {
  const headers = {
    ...liveSessionHeaders(options.access, options.sessionId, options.realtimeSessionId),
    Accept: '*/*',
    'Content-Type': 'application/json',
  }
  const timeout = AbortSignal.timeout(20_000)
  const signal = options.signal === undefined
    ? timeout
    : AbortSignal.any([options.signal, timeout])
  const response = await fetch(SIGNALING_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sdp: options.offer,
      session: buildLiveSessionPayload(options.instructions, options.voice),
    }),
    signal,
    dispatcher: options.proxy.dispatcher(),
  })
  const responseBody = await response.text()
  if (!response.ok) {
    throw new LiveSignalingError(
      response.status,
      `Codex live signaling failed (${response.status}): ${boundedErrorBody(responseBody, response.statusText)}`,
    )
  }
  if (!responseBody.trim()) {
    throw new LiveSignalingError(response.status, 'Codex live signaling returned an empty SDP answer')
  }
  const callId = parseLiveCallId(response.headers.get('location'))
  if (!callId) {
    throw new LiveSignalingError(response.status, 'Codex live signaling returned no valid call ID')
  }
  return { answer: prepareRemoteSdp(responseBody), callId }
}
