import { CodexAuthError } from './auth.js'
import { errorMessage } from './http.js'
import { isLiveFailureKind, type LiveFailureKind } from './kinds.js'
import { LiveSignalingError } from './signaling.js'

export type LiveFailure = {
  readonly kind: LiveFailureKind
  readonly status: number
  readonly message: string
  readonly upstreamStatus?: number
}

const QUOTA_RE = /\b(quota|rate limit|too many requests|usage limit|exceeded.*limit)\b/i

function kindFromSignaling(status: number, message: string): LiveFailureKind {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'quota'
  if (QUOTA_RE.test(message)) return 'quota'
  return 'signaling'
}

function httpStatusFor(kind: LiveFailureKind, upstreamStatus?: number): number {
  switch (kind) {
    case 'auth':
      return 401
    case 'forbidden':
      return 403
    case 'quota':
      return 429
    case 'session':
      return 409
    case 'signaling':
    case 'network':
    case 'media':
    case 'unknown':
      return upstreamStatus !== undefined && upstreamStatus >= 400 && upstreamStatus < 500
        ? upstreamStatus
        : 502
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network/i.test(errorMessage(error))
}

export function liveFailureFromUnknown(error: unknown): LiveFailure {
  if (error instanceof CodexAuthError) {
    return { kind: 'auth', status: 401, message: error.message }
  }
  if (error instanceof LiveSignalingError) {
    const kind = kindFromSignaling(error.status, error.message)
    return {
      kind,
      status: httpStatusFor(kind, error.status),
      message: error.message,
      upstreamStatus: error.status,
    }
  }
  const message = errorMessage(error)
  if (/is not active/i.test(message)) {
    return { kind: 'session', status: 409, message }
  }
  if (isNetworkError(error)) {
    return { kind: 'network', status: 502, message }
  }
  return { kind: 'unknown', status: 502, message }
}

export function liveFailureBody(failure: LiveFailure): {
  error: string
  kind: LiveFailureKind
  upstreamStatus?: number
} {
  return {
    error: failure.message,
    kind: failure.kind,
    ...failure.upstreamStatus === undefined ? {} : { upstreamStatus: failure.upstreamStatus },
  }
}

export function parseLiveFailureKind(value: unknown): LiveFailureKind | undefined {
  return typeof value === 'string' && isLiveFailureKind(value) ? value : undefined
}
