// Assemble a single offline page using the existing client, engine and icon pack.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { shardOf, shardFile } from '../src/iconrules.js'
import { buildHint, loadEngine } from './verdict.mjs'
import { assembleHtml, CURRENT, HISTORY } from '../src/html.js'

export { CURRENT, HISTORY, escapeHtml, escapeScript, escapeJson } from '../src/html.js'
export const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const snapshotName = /^[\w.-]+\.c4$/

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

export async function buildHtml({ mode = 'embedded', name = 'diagram', files = {}, lang = null, icons, root = packageRoot, result, generatedAt = new Date().toISOString() } = {}) {
  if (!['embedded', 'remote'].includes(mode)) throw new Error(`Unknown HTML mode: ${mode}`)
  const bundle = await readAsset(root, 'lib/standalone.js')
  const engine = mode === 'embedded' ? await readAsset(root, 'client.likec4.js') : ''
  const selected = mode === 'embedded' ? icons ?? await selectIcons(files, { root, result }) : undefined
  return assembleHtml({ mode, name, files, lang, icons: selected, bundle, engine, generatedAt })
}
