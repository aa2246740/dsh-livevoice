import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeLiveEvents } from '../src/client/api.ts'

class FixtureEventSource extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static latest: FixtureEventSource
  readyState = FixtureEventSource.CONNECTING
  close = vi.fn(() => { this.readyState = FixtureEventSource.CLOSED })
  constructor(_url: string) { super(); FixtureEventSource.latest = this }
}
beforeEach(() => vi.stubGlobal('EventSource', FixtureEventSource))
afterEach(() => vi.unstubAllGlobals())

describe('call event subscription termination', () => {
  it('reports a permanently closed HTTP subscription so stale calls tear down', () => {
    const event = vi.fn()
    const unsubscribe = subscribeLiveEvents('removed-token', event)
    const source = FixtureEventSource.latest
    source.readyState = FixtureEventSource.CLOSED
    source.dispatchEvent(new Event('error'))
    expect(event).toHaveBeenCalledWith({ type: 'error', message: expect.any(String) })
    expect(source.close).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('does not turn a retryable connection interruption into a terminal call error', () => {
    const event = vi.fn()
    const unsubscribe = subscribeLiveEvents('active-token', event)
    FixtureEventSource.latest.dispatchEvent(new Event('error'))
    expect(event).not.toHaveBeenCalled()
    expect(FixtureEventSource.latest.close).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('still delivers provider error messages carried in SSE frames', () => {
    const event = vi.fn()
    const unsubscribe = subscribeLiveEvents('active-token', event)
    FixtureEventSource.latest.dispatchEvent(new MessageEvent('error', { data: JSON.stringify({ type: 'error', message: 'fixture provider failed' }) }))
    expect(event).toHaveBeenCalledWith({ type: 'error', message: 'fixture provider failed' })
    unsubscribe()
  })

  it('delivers task receipt frames without rewriting their handoff text', () => {
    const event = vi.fn()
    const unsubscribe = subscribeLiveEvents('active-token', event)
    const receipt = {
      id: 'delegation-1',
      input: '现在优化',
      handoff: '<realtime_delegation>\n现在优化\n</realtime_delegation>',
      context: [],
      requestKind: 'new',
      route: 'followup',
      status: 'queued',
      createdAt: 1,
      updatedAt: 1,
    }
    FixtureEventSource.latest.dispatchEvent(new MessageEvent('task-receipt', {
      data: JSON.stringify({ type: 'task-receipt', receipt }),
    }))
    expect(event).toHaveBeenCalledWith({ type: 'task-receipt', receipt })
    unsubscribe()
  })
})
