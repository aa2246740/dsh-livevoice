import { describe, expect, it, vi } from 'vitest'
import { OPENAI_HEADERS, SIGNALING_URL } from '../src/catalog.ts'
import { LIVE_ORIGINATOR } from '../src/ids.ts'
import type { LiveProxy } from '../src/proxy.ts'
import { warmupLiveSignaling } from '../src/signaling.ts'

const fetchMock = vi.hoisted(() => vi.fn(() => Promise.reject(new Error('refused'))))

vi.mock('undici', () => ({
  fetch: fetchMock,
}))

function proxy(overrides: Partial<LiveProxy> = {}): LiveProxy {
  return {
    httpUrl: undefined,
    websocketUrl: undefined,
    dispatcher() { return undefined },
    websocketAgent() { return undefined },
    ...overrides,
  }
}

describe('warmupLiveSignaling', () => {
  it('does not throw when the HEAD request fails', () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('refused')))
    expect(() => warmupLiveSignaling(proxy())).not.toThrow()
  })

  it('does not throw when fetch construction throws', () => {
    fetchMock.mockImplementationOnce(() => {
      throw new Error('dispatcher')
    })
    expect(() => warmupLiveSignaling(proxy({
      dispatcher() { throw new Error('dispatcher') },
    }))).not.toThrow()
  })

  it('fires HEAD at signaling and the sideband origin', () => {
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.reject(new Error('refused')))
    warmupLiveSignaling(proxy())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map(call => call[0])
    expect(urls).toEqual([SIGNALING_URL, 'https://api.openai.com/'])
    const init = fetchMock.mock.calls[0]?.[1] as { method?: string; headers?: Record<string, string> }
    expect(init.method).toBe('HEAD')
    expect(init.headers?.[OPENAI_HEADERS.ORIGINATOR]).toBe(LIVE_ORIGINATOR)
  })
})
