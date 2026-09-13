import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const id = manifest.name

// dsh-v0.1.5-rc.2 packages/client/web/src/platform.ts
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const production = [...new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {}),
])].sort().map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`))

function matchesProduction(specifier) {
  return production.some((pattern) => pattern.test(specifier))
}

function isClientExternal(specifier) {
  return PLATFORM_MODULES.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

const CSS_MODULE_PREFIX = '\0dshx-css-module:'
const VIRTUAL_SUFFIX = '.mjs'

function styleModule(path, css, classMap) {
  const tagId = `${id}/${basename(path)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

const cssModules = {
  name: 'dsh-livevoice-css-modules',
  resolveId(source, importer) {
    if (!source.endsWith('.module.css')) return null
    const path = importer === undefined ? source : resolve(dirname(importer), source)
    return CSS_MODULE_PREFIX + path + VIRTUAL_SUFFIX
  },
  async load(virtualId) {
    if (!virtualId.startsWith(CSS_MODULE_PREFIX)) return null
    const path = virtualId.slice(CSS_MODULE_PREFIX.length, -VIRTUAL_SUFFIX.length)
    this.addWatchFile(path)
    const source = await readFile(path)
    const { code, exports: cssExports } = transform({
      filename: path,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap = {}
    for (const [local, value] of Object.entries(cssExports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      classMap[local] = value.name
    }
    return styleModule(path, code.toString(), classMap)
  },
}

const portableOutput = {
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

export default [{
  name: id,
  entry: { 'dsh-livevoice': 'src/dsh-livevoice.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: (specifier) => matchesProduction(specifier),
    alwaysBundle: (specifier) => !isBuiltin(specifier) && !matchesProduction(specifier),
  },
}, {
  name: `${id}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier) => isClientExternal(specifier),
    alwaysBundle: (specifier) => !isClientExternal(specifier),
  },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  plugins: [cssModules, portableOutput],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}]
