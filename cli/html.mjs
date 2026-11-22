// Assemble a single offline page using the existing client, engine and icon pack.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { groupByShard, shardFile } from '../src/iconrules.js'
import { buildHint, loadEngine } from './verdict.mjs'
import { assembleHtml, CURRENT, HISTORY } from '../src/html.js'
import { bySnapshotIndex } from '../src/shared.js'
import { pack } from './pack.mjs'

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
const sourcesOf = (files) => new Set([files[CURRENT] ?? '', ...Object.entries(files).filter(([p]) => p.startsWith(HISTORY + '/')).map(([, text]) => text)])

/** The icon-index entries the embedded sources use (the page's engine ships without the index). */
export async function selectIconIndex(files) {
  return (await loadEngine()).iconIndexFor(sourcesOf(files))
}

export async function selectIcons(files, { root = packageRoot } = {}) {
  const ids = new Set()
  const eng = await loadEngine()
  const sources = sourcesOf(files)
  for (const source of sources) for (const id of await eng.iconIds(source)) ids.add(id)
  const out = {}
  for (const [n, needed] of groupByShard(ids)) {
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
    for (const id of needed) if (pack[id]) (out[n] ??= {})[id] = pack[id]
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
  const names = entries.filter((e) => e.isFile() && snapshotName.test(e.name)).map((e) => e.name).sort(bySnapshotIndex).slice(-max)
  const files = {}
  for (const name of names) files[`${HISTORY}/${name}`] = await readFile(path.join(historyDir, name), 'utf8')
  return files
}

export async function buildHtml({ mode = 'embedded', name = 'diagram', files = {}, lang = null, icons, iconIndex, root = packageRoot, generatedAt = new Date().toISOString() } = {}) {
  if (!['embedded', 'remote'].includes(mode)) throw new Error(`Unknown HTML mode: ${mode}`)
  const embedded = mode === 'embedded'
  const bundle = pack(await readAsset(root, 'lib/standalone.js'))
  // Remote pages load the full client.likec4.js from `serve`; embedded ones the lean engine.
  const engine = embedded ? pack(await readAsset(root, 'lib/likec4.export.js')) : ''
  const selected = embedded ? icons ?? await selectIcons(files, { root }) : undefined
  const index = embedded ? iconIndex ?? await selectIconIndex(files) : null
  return assembleHtml({ mode, name, files, lang, icons: selected, iconIndex: index, bundle, engine, generatedAt })
}
