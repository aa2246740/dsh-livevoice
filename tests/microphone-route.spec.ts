import { beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LiveCallRegistry } from '../src/controller.js'
import type { LiveProxy } from '../src/proxy.js'
const open = vi.hoisted(() => vi.fn())
vi.mock('../src/microphone-host.js', () => ({ openMicrophoneSettings: open, describeHostMicrophone: vi.fn() }))
vi.mock('../src/auth.js', () => ({ CodexAuthError: class extends Error {}, describeCodexAuth: vi.fn() }))
vi.mock('../src/signaling.js', () => ({ warmupLiveSignaling: vi.fn() }))
import { registerLiveVoiceRoutes } from '../src/routes.js'

type Handler = (req: IncomingMessage, res: ServerResponse) => unknown
let handler: Handler
beforeEach(() => {
  open.mockReset().mockResolvedValue(undefined)
  const web = { effect: (fn: () => unknown) => fn(), webServer: { register: (route: { path: string; handler: Handler }) => {
    if (route.path.endsWith('/microphone-settings')) handler = route.handler
    return () => {}
  } } }
  registerLiveVoiceRoutes({ inject: (_keys: string[], callback: (ctx: unknown) => unknown) => callback(web) } as unknown as Context,
    {} as LiveCallRegistry, {} as LiveProxy)
})
async function invoke(method = 'POST', headers: Record<string, string> = { 'x-dsh-livevoice-action': 'microphone-settings' }) {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await handler({ method, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:1234', ...headers } } as unknown as IncomingMessage, res as unknown as ServerResponse)
  return res.writeHead.mock.calls[0][0]
}
it('opens the fixed settings pane only on an explicit same-origin POST', async () => {
  expect(await invoke()).toBe(200)
  expect(open).toHaveBeenCalledExactlyOnceWith()
})
it('rejects GET, cross-site and missing action headers before opening anything', async () => {
  expect(await invoke('GET')).toBe(405)
  expect(await invoke('POST', {})).toBe(403)
  expect(await invoke('POST', { 'x-dsh-livevoice-action': 'microphone-settings', origin: 'https://evil.example' })).toBe(403)
  expect(await invoke('POST', { 'x-dsh-livevoice-action': 'microphone-settings', 'sec-fetch-site': 'cross-site' })).toBe(403)
  expect(open).not.toHaveBeenCalled()
})
it('reports opening failure instead of pretending to have opened settings', async () => {
  open.mockRejectedValueOnce(new Error('open failed'))
  expect(await invoke()).toBe(503)
})
