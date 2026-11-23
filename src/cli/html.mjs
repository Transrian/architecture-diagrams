// Assemble one viewer page from the built viewer, engine and icon pack.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { groupByShard, shardFile } from '../core/iconrules.js'
import { bySnapshotIndex } from '../core/shared.js'
import { ASSETS, buildHint } from './assets.mjs'
import { loadEngine } from './verdict.mjs'
import { pack } from './pack.mjs'

export const snapshotName = /^[\w.-]+\.c4$/

export const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export const escapeScript = (text) => String(text)
  .replace(/<\/script/gi, (match) => match.replace('</', '<\\/'))
  .replace(/<!--/g, '<\\!--')
  // React includes an opening script tag in a string. Escape its first letter
  // too, preserving string/regex/identifier semantics and unambiguous tag counts.
  .replace(/<script/gi, (match) => '<\\u' + match.charCodeAt(1).toString(16).padStart(4, '0') + match.slice(2))
export const escapeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export const PACKED_TYPE = 'application/x-dshd-gzip-base64'
const PACKED = /^[A-Za-z0-9+/]*={0,2}$/

// Chunks (engine, icon shards) register through window.__DSHD__.define. The
// packed viewer and engine are inflated with the browser's own
// DecompressionStream (no network, no decoder shipped), then run by a global
// (indirect) eval. Never inject them as <script> elements: SharePoint's HTML
// viewer runs eval but refuses scripts inserted at runtime.
const shim = `(() => {
  const chunks = new Map();
  const unpack = async (id) => {
    const node = document.getElementById(id);
    if (!node) return null;
    const bytes = Uint8Array.from(atob(node.textContent.trim()), c => c.charCodeAt(0));
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  };
  // Indirect eval: global scope, like a classic script; sourceURL names it in stack traces.
  const run = (code, name) => { (0, eval)(code + '\\n//# sourceURL=' + name); };
  const fail = error => {
    const app = document.getElementById('dshd-app');
    if (app) app.textContent = 'This diagram cannot open in this browser: ' + (error && error.message || error);
    console.error(error);
  };
  let engine;
  // Embedded mode only; in remote mode the viewer loads /engine.js and /icons-NNN.js.
  const loadEngine = () => engine ??= unpack('dshd-engine').then(code => { if (code !== null) run(code, 'dshd-engine.js'); });
  window.__DSHD__ = { chunks, define: (name, factory) => chunks.set(name, factory()), engine: loadEngine };
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof DecompressionStream !== 'function') return fail(new Error('DecompressionStream is missing (Chrome 80, Firefox 113, Safari 16.4 or later)'));
    loadEngine().catch(() => {});
    unpack('dshd-viewer').then(code => run(code, 'dshd-viewer.js')).catch(fail);
  });
})();`

/**
 * Pure page assembly. Embedded pages carry the source, its history, the icons
 * and icon-index entries they use; remote pages fetch everything from `serve`.
 */
export function assembleHtml({ mode = 'embedded', name = 'diagram', source = '', history = {}, lang = null, icons = {}, iconIndex = null, bundle = '', engine = '', generatedAt = new Date().toISOString() } = {}) {
  if (!['embedded', 'remote'].includes(mode)) throw new Error(`Unknown HTML mode: ${mode}`)
  // Base64 cannot close a script element; anything else is a caller bug.
  if (!PACKED.test(bundle) || !PACKED.test(engine)) throw new Error('HTML assets must be packed (gzip + base64)')
  // Publish only a display name, never a source path (POSIX or Windows).
  const data = { v: 1, mode, name: String(name).split(/[\\/]/).pop(), generatedAt, lang }
  if (mode === 'embedded') Object.assign(data, { source, history, icons, iconIndex })
  return `<!doctype html>
<html lang="${escapeHtml(lang ?? 'en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.name)}</title>
<script>${escapeScript(shim)}</script>
</head><body><div id="dshd-app"></div>
<!-- The viewer (React license included) and the LikeC4/Graphviz engine below are gzip + base64. -->

<script type="application/json" id="dshd-data">${escapeJson(data)}</script>
${mode === 'embedded' ? `<script type="${PACKED_TYPE}" id="dshd-engine">${engine}</script>` : ''}
<script type="${PACKED_TYPE}" id="dshd-viewer">${bundle}</script>
</body></html>
`
}

export async function readAsset(root, name) {
  try {
    return await readFile(path.join(root, name), 'utf8')
  } catch (error) {
    throw new Error(`Cannot read built asset ${name}; ${buildHint}`, { cause: error })
  }
}

const shards = new Map()
const sourcesOf = (source, history) => new Set([source, ...Object.values(history)])

export async function selectIcons(sources, { root = ASSETS } = {}) {
  const ids = new Set()
  const eng = await loadEngine()
  for (const source of sources) for (const id of await eng.iconIds(source)) ids.add(id)
  const out = {}
  for (const [n, needed] of groupByShard(ids)) {
    const key = path.join(root, shardFile(n))
    if (!shards.has(key)) {
      shards.set(key, (async () => {
        try {
          let value = {}
          const src = await readFile(key, 'utf8')
          vm.runInNewContext(src, { window: { __DSHD__: { define: (_name, factory) => { value = factory() } } } }, { timeout: 1000 })
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

/** The newest `max` snapshots, by name. */
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
  const history = {}
  for (const name of names) history[name] = await readFile(path.join(historyDir, name), 'utf8')
  return history
}

export async function buildHtml({ mode = 'embedded', name = 'diagram', source = '', history = {}, lang = null, icons, iconIndex, root = ASSETS, generatedAt = new Date().toISOString() } = {}) {
  if (!['embedded', 'remote'].includes(mode)) throw new Error(`Unknown HTML mode: ${mode}`)
  const embedded = mode === 'embedded'
  const bundle = pack(await readAsset(root, 'viewer.js'))
  if (!embedded) return assembleHtml({ mode, name, lang, bundle, generatedAt })
  // The offline engine ships without an icon index: the page carries the entries its sources use.
  const engine = pack(await readAsset(root, 'engine-offline.js'))
  const sources = sourcesOf(source, history)
  icons ??= await selectIcons(sources, { root })
  iconIndex ??= await (await loadEngine()).iconIndexFor(sources)
  return assembleHtml({ mode, name, source, history, lang, icons, iconIndex, bundle, engine, generatedAt })
}
