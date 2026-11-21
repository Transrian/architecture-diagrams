// Assemble a single offline page using the existing client, engine and icon pack.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { shardOf, shardFile } from '../src/iconrules.js'
import { buildHint, loadEngine } from './verdict.mjs'

export const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const CURRENT = '.diagram/diagram.c4'
export const HISTORY = '.diagram/diagram'
export const snapshotName = /^[\w.-]+\.c4$/

export const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export const escapeScript = (text) => String(text)
  .replace(/<\/script/gi, (match) => match.replace('</', '<\\/'))
  .replace(/<!--/g, '<\\!--')
  // React includes an opening script tag in a string. Escape its first letter
  // too, preserving string/regex/identifier semantics and unambiguous tag counts.
  .replace(/<script/gi, (match) => '<\\u' + match.charCodeAt(1).toString(16).padStart(4, '0') + match.slice(2))
export const escapeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export async function readAsset(root, name) {
  try {
    return await readFile(path.join(root, name), 'utf8')
  } catch (error) {
    throw new Error(`Cannot read built asset ${name}; ${buildHint}`, { cause: error })
  }
}

const shards = new Map()
export async function selectIcons(files, { root = packageRoot, result } = {}) {
  const ids = new Set()
  const add = (r) => {
    for (const v of r?.views ?? []) for (const n of v.nodes ?? []) if (n.icon) ids.add(n.icon)
  }
  const eng = await loadEngine()
  add(result ?? await eng.compute(files[CURRENT] ?? ''))
  // A reference layout takes ~0.4 s warm. Keep export time bounded for long
  // histories: old snapshots still render, but may lack their unique icons.
  const recent = Object.keys(files).filter((p) => p.startsWith(HISTORY + '/')).sort().slice(-10)
  const sources = new Set([files[CURRENT]])
  for (const p of recent) {
    if (sources.has(files[p])) continue
    sources.add(files[p])
    add(await eng.compute(files[p]))
  }
  const out = {}
  for (const id of ids) {
    const n = shardOf(id)
    const key = path.join(root, shardFile(n))
    if (!shards.has(key)) {
      shards.set(key, (async () => {
        try {
          let value = {}
          const src = await readFile(key, 'utf8')
          vm.runInNewContext(src, { window: { __ModuleLoader__: { load: (d) => { value = d.factory(() => { throw new Error('Icon shards cannot require modules') }) } } } }, { timeout: 1000 })
          return value
        } catch (error) {
          if (error.code === 'ENOENT') return {}
          throw error
        }
      })())
    }
    const pack = await shards.get(key)
    if (pack[id]) (out[n] ??= {})[id] = pack[id]
  }
  return out
}

export async function readHistory(historyDir, max = 50) {
  if (max === 0) return {}
  let entries
  try {
    entries = await readdir(historyDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
  const names = entries.filter((e) => e.isFile() && snapshotName.test(e.name)).map((e) => e.name).sort().slice(-max)
  const files = {}
  for (const name of names) files[`${HISTORY}/${name}`] = await readFile(path.join(historyDir, name), 'utf8')
  return files
}

const shim = `(() => {
  const chunks = new Map();
  window.__DSHD__ = { chunks };
  const req = name => { throw new Error('Standalone chunks cannot require ' + name); };
  window.__ModuleLoader__ = { load({chunk, factory}) {
    chunks.set(chunk.replace(/^\\.\\//, ''), factory(req));
  } };
  // In remote mode the client loads /client.likec4.js and /client.icons-NNN.js.
})();`

export async function buildHtml({ mode = 'embedded', name = 'diagram', files = {}, lang = null, icons, root = packageRoot, result, generatedAt = new Date().toISOString() } = {}) {
  if (!['embedded', 'remote'].includes(mode)) throw new Error(`Unknown HTML mode: ${mode}`)
  const bundle = await readAsset(root, 'lib/standalone.js')
  const data = { v: 1, mode, name: path.basename(name), generatedAt, lang }
  let engine = ''
  if (mode === 'embedded') {
    engine = await readAsset(root, 'client.likec4.js')
    data.files = files
    data.icons = icons ?? await selectIcons(files, { root, result })
  }
  return `<!doctype html>
<html lang="${escapeHtml(lang ?? 'en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.name)}</title>
<script>${escapeScript(shim)}</script>
</head><body><div id="dshd-app"></div>
<script type="application/json" id="dshd-data">${escapeJson(data)}</script>
${mode === 'embedded' ? `<script>${escapeScript(engine)}</script>` : ''}
<script>${escapeScript(bundle)}</script>
</body></html>
`
}
