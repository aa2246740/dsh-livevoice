import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { LiveCallRegistry } from '../src/controller.ts'
import type { LiveProxy } from '../src/proxy.ts'
vi.mock('../src/auth.js', () => ({ CodexAuthError: class extends Error {}, describeCodexAuth: vi.fn() }))
vi.mock('../src/signaling.js', () => ({ warmupLiveSignaling: vi.fn() }))
import { registerLiveVoiceRoutes } from '../src/routes.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture() {
  type Handler = (req: IncomingMessage, res: ServerResponse) => unknown
  const routes = new Map<string, Handler>()
  const started = deferred<void>()
  const complete = deferred<any>()
  const handled = deferred<void>()
  const disconnected = deferred<void>()
  const close = vi.fn(async () => {})
  const fakeRegistry = { start: vi.fn(() => { started.resolve(); return complete.promise }) }
  const web = { effect: (fn: () => unknown) => fn(), webServer: {
    register: (route: { path: string; handler: Handler }) => { routes.set(route.path, route.handler); return () => {} },
  } }
  const ctx = { inject: (_keys: string[], callback: (ctx: unknown) => unknown) => callback(web) }
  registerLiveVoiceRoutes(ctx as unknown as Context, fakeRegistry as unknown as LiveCallRegistry, {} as LiveProxy)
  const server = createServer((req, res) => {
    res.on('close', () => disconnected.resolve())
    Promise.resolve(routes.get('/plugins/dsh-livevoice/calls')!(req, res)).finally(() => handled.resolve())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No local test port')
  return { port: address.port, started, complete, handled, disconnected, close,
    call: { callToken: 'fixture-token', callId: 'fixture-call', answer: 'fixture-answer', voice: 'marin', close } }
}

describe('unclaimed HTTP call responses cannot leave orphaned calls', () => {
  it('closes the exact late call when the browser disconnects during signaling', async () => {
    const f = await fixture()
    const req = request({ host: '127.0.0.1', port: f.port, path: '/plugins/dsh-livevoice/calls', method: 'POST' })
    req.on('error', () => {})
    req.end(JSON.stringify({ sessionId: 'fixture-session', sdp: 'fixture-offer' }))
    await f.started.promise
    req.destroy()
    await f.disconnected.promise
    f.complete.resolve(f.call)
    await f.handled.promise
    expect(f.close).toHaveBeenCalledOnce()
  })

  it('does not close a successfully delivered call on normal HTTP completion', async () => {
    const f = await fixture()
    const response = fetch(`http://127.0.0.1:${f.port}/plugins/dsh-livevoice/calls`, {
      method: 'POST', body: JSON.stringify({ sessionId: 'fixture-session', sdp: 'fixture-offer' }),
    })
    await f.started.promise
    f.complete.resolve(f.call)
    expect((await (await response).json()).callToken).toBe('fixture-token')
    await f.disconnected.promise
    expect(f.close).not.toHaveBeenCalled()
  })
})
