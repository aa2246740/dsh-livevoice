import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CodexAccess } from '../src/auth.ts'
import type { LiveProxy } from '../src/proxy.ts'

const wire = vi.hoisted(() => ({ signal: vi.fn(), close: vi.fn() }))
vi.mock('../src/signaling.js', () => ({ signalLiveCall: wire.signal }))
vi.mock('../src/sideband.js', () => ({ LiveSideband: class {
  async connect() {}
  async close() { wire.close() }
  async send() {}
} }))
import { LiveCallRegistry } from '../src/controller.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve() }
const answer = { callId: 'fixture-call', answer: 'fixture-answer' }
const request = { sessionId: 'fixture-session', offer: 'fixture-offer' }
function registry() {
  const agent = { ctx: { on: () => () => {} } } as unknown as Agent
  return new LiveCallRegistry(() => agent, async () => ({} as CodexAccess), {} as LiveProxy)
}
beforeEach(() => { vi.resetAllMocks(); wire.signal.mockResolvedValue(answer) })

describe('one registry has one call even across concurrent browser requests', () => {
  it('serializes two overlapping starts and leaves only the later call', async () => {
    const firstSignal = deferred<typeof answer>()
    wire.signal.mockReturnValueOnce(firstSignal.promise)
    const calls = registry()
    const first = calls.start(request)
    await settle()
    const second = calls.start(request)
    await settle()
    const concurrentSignals = wire.signal.mock.calls.length
    firstSignal.resolve(answer)
    const [a, b] = await Promise.all([first, second])
    try {
      expect(concurrentSignals).toBe(1)
      expect(calls.get(a.callToken)).toBeUndefined()
      expect(calls.get(b.callToken)).toBeDefined()
      expect(wire.close).toHaveBeenCalledOnce()
    } finally { await calls.closeAll() }
  })

  it('a failed start does not poison the next queued dial', async () => {
    const firstSignal = deferred<typeof answer>()
    wire.signal.mockReturnValueOnce(firstSignal.promise)
    const calls = registry()
    const first = calls.start(request).catch(error => error)
    await settle()
    const second = calls.start(request)
    firstSignal.reject(new Error('fixture signaling failed'))
    const [failure, next] = await Promise.all([first, second])
    try {
      expect(failure).toBeInstanceOf(Error)
      expect(calls.get(next.callToken)).toBeDefined()
    } finally { await calls.closeAll() }
  })

  it('closeAll is a barrier for starts already in flight or queued', async () => {
    const firstSignal = deferred<typeof answer>()
    wire.signal.mockReturnValueOnce(firstSignal.promise)
    const calls = registry()
    const first = calls.start(request)
    await settle()
    const second = calls.start(request)
    const closed = calls.closeAll()
    firstSignal.resolve(answer)
    const [a, b] = await Promise.all([first, second])
    await closed
    const survivors = [a, b].filter(call => calls.get(call.callToken) !== undefined)
    await calls.closeAll()
    expect(survivors).toHaveLength(0)
    expect(wire.close).toHaveBeenCalledTimes(2)
  })
})
