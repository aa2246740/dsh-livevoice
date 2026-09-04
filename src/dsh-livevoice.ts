import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolveCodexAccess } from './auth.js'
import { executeLiveCommand } from './command.js'
import { LiveCallRegistry } from './controller.js'
import { PLUGIN_NAME } from './ids.js'
import { loadLiveProxy } from './proxy.js'
import { registerLiveVoiceRoutes } from './routes.js'
import { warmupLiveSignaling } from './signaling.js'
import { DEFAULT_LIVE_VOICE } from './voices.js'

export const name = PLUGIN_NAME
export const inject = ['agents', 'commands', 'sessions']

export interface Config {
  readonly enabled?: boolean
  readonly voice?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  voice: z.string().default(DEFAULT_LIVE_VOICE),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (config.enabled === false) {
    ctx.logger.info('[my-plugins/dsh-livevoice] disabled')
    return
  }

  const proxy = await loadLiveProxy()
  warmupLiveSignaling(proxy)
  const registry = new LiveCallRegistry(
    (sessionId) => ctx.agents.get(SessionId(sessionId)),
    () => resolveCodexAccess(ctx, proxy),
    proxy,
  )
  ctx.effect(() => () => { void registry.closeAll() }, 'dsh-livevoice: close live calls')
  registerLiveVoiceRoutes(ctx, registry, proxy)
  ctx.effect(() => ctx.commands.register({
    name: 'live',
    description: 'start or inspect Codex realtime voice in this session',
    input: { hint: '[help]' },
    handler: executeLiveCommand,
  }), 'dsh-livevoice: /live')
  console.log('[my-plugins/dsh-livevoice] loaded')
}
