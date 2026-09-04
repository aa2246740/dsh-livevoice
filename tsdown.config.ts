import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function resolveHarness() {
  const configured = process.env.DSHX_HARNESS?.trim()
  const configPath = join(homedir(), '.config/dshx/harness')
  const recorded = existsSync(configPath) ? readFileSync(configPath, 'utf8').trim() : undefined
  const roots = [...new Set([configured, recorded].filter(Boolean).map(value => resolve(value!)))]
  if (roots.length !== 1) {
    throw new Error('dshx client build requires one Harness root from DSHX_HARNESS or ~/.config/dshx/harness')
  }
  return roots[0]!
}

const adapter = join(resolveHarness(), 'tools/dshx/src/client-build.js')
if (!existsSync(adapter)) throw new Error(`dshx client build adapter not found: ${adapter}`)
const { externalClientBundle } = await import(pathToFileURL(adapter).href)

export default externalClientBundle('dsh-livevoice', ['lib/types/dsh-livevoice.js'], {
  clientEntry: 'src/client/index.tsx',
})
