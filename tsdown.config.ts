import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TsdownPlugin, UserConfig } from 'tsdown'

function resolveHarness(): string {
  const configured = process.env.DSHX_HARNESS?.trim()
  const configPath = join(homedir(), '.config/dshx/harness')
  const recorded = existsSync(configPath) ? readFileSync(configPath, 'utf8').trim() : undefined
  const selected = configured === undefined || configured.length === 0 ? recorded : configured
  if (!selected) throw new Error('dshx client build requires a Harness root from DSHX_HARNESS or ~/.config/dshx/harness')
  return resolve(selected)
}

const adapter = join(resolveHarness(), 'tools/dshx/src/client-build.js')
if (!existsSync(adapter)) throw new Error(`dshx client build adapter not found: ${adapter}`)
const { externalClientBundle } = await import(pathToFileURL(adapter).href)

const bundle = externalClientBundle('dsh-livevoice', ['lib/types/dsh-livevoice.js'], {
  clientEntry: 'src/client/index.tsx',
}) as UserConfig[]

const portableOutput: TsdownPlugin = {
  name: 'dsh-livevoice-portable-output',
  generateBundle(_options, output) {
    const client = output['client.js']
    if (client?.type !== 'chunk') this.error('client.js was not emitted')
    client.code = client.code.replace(
      /^([ \t]*\/\/#region \\0dshx-css-module:).*[\\/]([^/\\\r\n]+\.module\.css\.mjs)(\r?)$/gmu,
      '$1$2$3',
    )
    if (/^.*\/\/#region \\0dshx-css-module:.*[\\/].*$/mu.test(client.code)) {
      this.error('client.js contains a non-portable CSS module path')
    }
  },
}

export default bundle.map((config) => {
  if (config.name !== 'dsh-livevoice/client') return config
  const plugins = Array.isArray(config.plugins)
    ? config.plugins
    : config.plugins === undefined
      ? []
      : [config.plugins]
  return { ...config, plugins: [...plugins, portableOutput] }
})
