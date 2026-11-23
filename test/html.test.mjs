import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { buildHtml, escapeScript, escapeJson, selectIcons, readHistory } from '../src/cli/html.mjs'
import { ASSETS } from '../src/cli/assets.mjs'
import { compute } from '../skills/dsh-diagram/assets/engine.mjs'
import { shardOf, shardFile } from '../src/core/iconrules.js'
import { unpack } from '../src/cli/pack.mjs'

const source = await readFile(new URL('../examples/reference.c4', import.meta.url), 'utf8')
const result = await compute(source)
const history = { '0001-20260101T000000Z.c4': source }
let embedded
function dataOf(html) {
  return JSON.parse(/<script type="application\/json" id="dshd-data">([\s\S]*?)<\/script>/.exec(html)[1])
}

test('embedded HTML is bounded, offline, private and preserves the sources', async () => {
  embedded = await buildHtml({ mode: 'embedded', name: 'reference', source, history })
  assert.equal((embedded.match(/<script\b/g) ?? []).length, (embedded.match(/<\/script>/g) ?? []).length)
  const data = dataOf(embedded)
  assert.equal(data.v, 1)
  assert.equal(data.source, source)
  assert.deepEqual(data.history, history)
  assert.equal(data.mode, 'embedded')
  assert.ok(!embedded.includes(homedir()))
  assert.ok(!embedded.includes(ASSETS))
  // Packed viewer and engine (gzip + base64): about 1.75 MB instead of 3 MB as raw text.
  assert.ok(Buffer.byteLength(embedded) <= 2_500_000, `${Buffer.byteLength(embedded)} bytes`)
  assert.equal(unpack(/id="dshd-engine">([^<]*)</.exec(embedded)[1]), await readFile(path.join(ASSETS, 'engine-offline.js'), 'utf8'))
  // The lean engine has no icon index; the page carries the entries its sources use.
  assert.ok(data.iconIndex.brand && JSON.stringify(data.iconIndex).length < 10_000)
  assert.equal(unpack(/id="dshd-viewer">([^<]*)</.exec(embedded)[1]), await readFile(path.join(ASSETS, 'viewer.js'), 'utf8'))
  assert.doesNotMatch(embedded, /<script\b[^>]*\bsrc=/i)
})

test('all icons in every reference view are embedded', async () => {
  const data = dataOf(embedded ?? await buildHtml({ source, history }))
  const present = new Set(Object.values(data.icons).flatMap((shard) => Object.keys(shard)))
  for (const v of result.views) for (const n of v.nodes) if (n.icon) {
    const pack = await readFile(path.join(ASSETS, shardFile(shardOf(n.icon))), 'utf8').catch(() => '')
    if (pack.includes(JSON.stringify(n.icon))) assert.ok(present.has(n.icon), `missing ${n.icon}`)
  }
})

test('remote HTML omits data and inline engine but retains the loader', async () => {
  const html = await buildHtml({ mode: 'remote', name: '/not/published/reference', lang: 'fr' })
  const data = dataOf(html)
  assert.equal(data.name, 'reference')
  assert.equal(data.mode, 'remote')
  assert.equal(data.lang, 'fr')
  for (const key of ['source', 'history', 'icons', 'iconIndex']) assert.equal(data[key], undefined, key)
  assert.match(html, /window\.__DSHD__ = /)
  assert.doesNotMatch(html, /id="dshd-engine"/)
  assert.ok(Buffer.byteLength(html) < 1_000_000)
  assert.equal((html.match(/<script\b/g) ?? []).length, 3)
})

test('inline JavaScript and JSON escaping cannot break out of their script', async () => {
  const js = 'return ["</script>", "</ScRiPt>", "<!--", `</script> <!--`, /<\\/script/.source]'
  const opening = 'const script = 2; return [1<script, "<script>", "<ScRiPt>", /<script/.test("<script")]'
  assert.deepEqual(new Function(escapeScript(opening))(), new Function(opening)())
  assert.doesNotMatch(escapeScript(opening), /<script/i)
  const escaped = escapeScript(js)
  assert.doesNotMatch(escaped, /<\/script|<!--/i)
  assert.deepEqual(new Function(escaped)(), new Function(js)())
  const value = { name: '</script>\u2028\u2029<!--"&' }
  assert.deepEqual(JSON.parse(escapeJson(value)), value)
  assert.doesNotMatch(escapeJson(value), /</)
  const root = await mkdtemp(path.join(tmpdir(), 'dshd-html-'))
  try {
    await writeFile(path.join(root, 'viewer.js'), js)
    await writeFile(path.join(root, 'engine-offline.js'), js)
    const html = await buildHtml({ root, name: '"<&>', lang: '"<&>', source: '</script><!--', history: { '0001-x.c4': '<!--</script>' }, icons: {}, iconIndex: {} })
    assert.equal((html.match(/<script\b/g) ?? []).length, (html.match(/<\/script>/g) ?? []).length)
    assert.equal(dataOf(html).source, '</script><!--')
    assert.equal(dataOf(html).history['0001-x.c4'], '<!--</script>')
    assert.equal(unpack(/id="dshd-viewer">([^<]*)</.exec(html)[1]), js)
    assert.equal(unpack(/id="dshd-engine">([^<]*)</.exec(html)[1]), js)
    assert.match(html, /<title>&quot;&lt;&amp;&gt;<\/title>/)
    assert.ok(!html.includes(root))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the page shim runs packed code without inserting script elements', async () => {
  // SharePoint's HTML viewer allows eval but refuses <script> elements added at runtime.
  const root = await mkdtemp(path.join(tmpdir(), 'dshd-shim-'))
  try {
    await writeFile(path.join(root, 'viewer.js'), 'var viewerRan = true; window.ran.push("viewer")')
    await writeFile(path.join(root, 'engine-offline.js'), 'window.__DSHD__.define("engine.js", () => ({ ok: 1 })); window.ran.push("engine")')
    const html = await buildHtml({ root, source, history: {}, icons: {}, iconIndex: {} })
    const nodes = Object.fromEntries([...html.matchAll(/<script\b[^>]*\bid="([^"]+)">([^<]*)<\/script>/g)].map((m) => [m[1], { textContent: m[2] }]))
    const listeners = {}
    const blocked = () => { throw new Error('runtime script elements are blocked') }
    const errors = []
    const context = vm.createContext({
      ran: [], atob, Uint8Array, Blob, Response, DecompressionStream,
      console: { error: (e) => errors.push(e) },
      document: {
        getElementById: (id) => nodes[id] ?? null,
        addEventListener: (type, fn) => { listeners[type] = fn },
        createElement: blocked,
        head: { appendChild: blocked },
      },
    })
    context.window = context
    vm.runInContext(/<script>([\s\S]*?)<\/script>/.exec(html)[1], context)
    listeners.DOMContentLoaded()
    await context.__DSHD__.engine()
    for (let i = 0; i < 50 && !context.ran.includes('viewer'); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(errors, [])
    assert.deepEqual([...context.ran].sort(), ['engine', 'viewer'])
    // Global scope, like a classic script: top-level declarations stay visible.
    assert.equal(vm.runInContext('viewerRan', context), true)
    assert.deepEqual({ ...context.__DSHD__.chunks.get('engine.js') }, { ok: 1 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing builds have a clear diagnostic', async () => {
  await assert.rejects(buildHtml({ root: '/nonexistent-dshd-build', source, history, icons: {}, iconIndex: {} }), /run "cd build && node build\.mjs" first/)
})

test('a missing icon shard is harmless', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dshd-icons-'))
  try {
    assert.deepEqual(await selectIcons([source], { root }), {})
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('icons unique to the oldest of twelve snapshots are embedded', async () => {
  const diagram = (technology) => `// diagram v1\nmodel {\n app = system 'App' {\n node = service 'Node' {\n technology '${technology}'\n }\n }\n}`
  const current = diagram('React')
  const old = diagram('Redis')
  const history = {}
  for (let i = 1; i <= 12; i++) history[`${String(i).padStart(4, '0')}-x.c4`] = i === 1 ? old : current + `\n// Version ${i}`
  const oldestIcon = (await compute(old)).model.icons['app.node'].icon
  assert.ok(oldestIcon)
  const data = dataOf(await buildHtml({ source: current, history }))
  assert.ok(data.icons[shardOf(oldestIcon)]?.[oldestIcon], 'icon from a snapshot older than the former ten-version window')
  assert.equal(Object.keys(data.history).length, 12)
})

test('HTML history limits select the numerically newest snapshots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dshd-html-history-'))
  try {
    await writeFile(path.join(dir, '9999-x.c4'), 'old')
    await writeFile(path.join(dir, '10000-y.c4'), 'new')
    assert.deepEqual(await readHistory(dir, 1), { '10000-y.c4': 'new' })
  } finally {
    assert.equal(path.dirname(dir), path.resolve(tmpdir()))
    assert.match(path.basename(dir), /^dshd-html-history-/)
    await rm(dir, { recursive: true, force: true })
  }
})
