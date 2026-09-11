import { describe, expect, it } from 'vitest'
import { CodexAuthError } from '../src/auth.ts'
import { liveFailureBody, liveFailureFromUnknown } from '../src/failure.ts'
import { LiveSignalingError } from '../src/signaling.ts'

describe('liveFailureFromUnknown', () => {
  it('maps Codex auth failures to 401', () => {
    const failure = liveFailureFromUnknown(new CodexAuthError('no grant'))
    expect(failure).toEqual({ kind: 'auth', status: 401, message: 'no grant' })
  })

  it('maps signaling 429 to quota instead of collapsing to 502', () => {
    const failure = liveFailureFromUnknown(
      new LiveSignalingError(429, 'Codex live signaling failed (429): rate limit'),
    )
    expect(failure.kind).toBe('quota')
    expect(failure.status).toBe(429)
    expect(failure.upstreamStatus).toBe(429)
    expect(liveFailureBody(failure)).toEqual({
      error: 'Codex live signaling failed (429): rate limit',
      kind: 'quota',
      upstreamStatus: 429,
    })
  })

  it('maps signaling 403 to forbidden', () => {
    const failure = liveFailureFromUnknown(
      new LiveSignalingError(403, 'Codex live signaling failed (403): forbidden'),
    )
    expect(failure.kind).toBe('forbidden')
    expect(failure.status).toBe(403)
  })

  it('keeps signaling 500 as 502 with the upstream status', () => {
    const failure = liveFailureFromUnknown(
      new LiveSignalingError(500, 'Codex live signaling failed (500): boom'),
    )
    expect(failure.kind).toBe('signaling')
    expect(failure.status).toBe(502)
    expect(failure.upstreamStatus).toBe(500)
  })

  it('classifies a missing DSH session separately from quota', () => {
    const failure = liveFailureFromUnknown(new Error('Session abc is not active.'))
    expect(failure).toEqual({
      kind: 'session',
      status: 409,
      message: 'Session abc is not active.',
    })
  })

  it('classifies fetch/network failures separately from quota', () => {
    const error = new Error('fetch failed')
    error.cause = new Error('connect ECONNREFUSED 127.0.0.1:1')
    const failure = liveFailureFromUnknown(error)
    expect(failure.kind).toBe('network')
    expect(failure.status).toBe(502)
  })
})
