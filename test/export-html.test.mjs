import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { makeHtmlExporter } from '../src/export-html.js'
import { assembleHtml, CURRENT } from '../src/html.js'
import { shardFile, shardOf } from '../src/iconrules.js'
import { fileName } from '../src/export.js'
import { compute } from '../lib/likec4.mjs'

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8')
function moduleOf(source) {
  let value
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: ({ factory }) => {
    value = factory(() => { throw new Error('Data chunks must not require dependencies') })
  } } } }, { timeout: 2000 })
  return value
}
function dataOf(html) {
  return JSON.parse(/<script type="application\/json" id="dshd-data">([\s\S]*?)<\/script>/.exec(html)[1])
}

test('DSH export loads assets lazily and includes the whole model without history', async () => {
  const source = await read('examples/reference.c4')
  const calls = []
  const assets = moduleOf(await read('client.export-html.js'))
  assert.equal(assets.bundle, await read('lib/standalone.js'))
  assert.equal(assets.engine, await read('client.likec4.js'))
  const exporter = makeHtmlExporter({ async: async (chunk) => {
    calls.push(chunk)
    if (chunk === './client.export-html.js') return assets
    if (chunk === './client.likec4.js') return { compute }
    assert.match(chunk, /^\.\/client\.icons-\d{3}\.js$/)
    return moduleOf(await read(chunk.slice(2)))
  } })
  assert.deepEqual(calls, [])
  const html = await exporter({ text: source, name: 'reference · v2' })
  const data = dataOf(html)
  assert.deepEqual(data.files, { [CURRENT]: source })
  assert.equal(data.name, 'reference · v2')
  assert.equal(data.mode, 'embedded')
  assert.equal(calls.filter((p) => p === './client.export-html.js').length, 1)
  assert.equal(new Set(calls).size, calls.length, 'icon shards should be loaded once per export')
  const result = await compute(source)
  const needed = new Set(result.views.flatMap((v) => v.nodes.map((n) => n.icon).filter(Boolean)))
  for (const id of needed) assert.ok(data.icons[shardOf(id)]?.[id], `missing ${id} in an unvisited view`)
  assert.equal(Object.values(data.icons).flatMap(Object.keys).length, needed.size, 'unrelated icons must not be embedded')
  assert.ok(Buffer.byteLength(html) < 5_000_000)
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i)
  assert.equal((html.match(/<script\b/g) ?? []).length, 4)
  assert.equal((html.match(/<\/script>/g) ?? []).length, 4)
})

test('HTML exporter retries a failed asset download and rejects invalid diagrams', async () => {
  let attempts = 0
  const exporter = makeHtmlExporter({ async: async (chunk) => {
    if (chunk === './client.export-html.js') {
      if (++attempts === 1) throw new Error('Offline while downloading assets')
      return { bundle: '', engine: '' }
    }
    return { compute: async (text) => ({ errors: text === 'invalid' ? [{}] : [], views: [{ nodes: [] }] }) }
  } })
  await assert.rejects(exporter({ text: 'valid' }), /Offline while downloading assets/)
  const html = await exporter({ text: 'valid' })
  assert.deepEqual(dataOf(html).files, { [CURRENT]: 'valid' })
  await assert.rejects(exporter({ text: 'invalid' }), /No valid diagram/)
})

test('browser assembly escapes source, names and all inline scripts', () => {
  const text = '// diagram v1\n</script><script>alert(1)</script><!--\u2028\u2029'
  const html = assembleHtml({
    files: { [CURRENT]: text }, name: 'C:\\private\\<name>&"',
    engine: 'const e = "</ScRiPt><!--<script>";', bundle: 'const b = "</script>";',
  })
  assert.deepEqual(dataOf(html).files, { [CURRENT]: text })
  assert.equal(dataOf(html).name, '<name>&"')
  assert.match(html, /<title>&lt;name&gt;&amp;&quot;<\/title>/)
  assert.doesNotMatch(html, /private/)
  assert.equal((html.match(/<script\b/g) ?? []).length, 4)
  assert.equal((html.match(/<\/script>/g) ?? []).length, 4)
  assert.throws(() => assembleHtml({ mode: 'invalid' }), /Unknown HTML mode/)
})

test('HTML download naming uses a safe title', () => {
  const date = new Date(2026, 0, 2, 3, 4)
  assert.equal(fileName('···', date), 'diagram-diagram-20260102-0304.html')
  assert.equal(fileName('Schéma / <démo>', date), 'diagram-schema-demo-20260102-0304.html')
})

test('DSH client keeps React external and standalone has no DSH HTML exporter', async () => {
  const client = await read('client.js')
  const standalone = await read('lib/standalone.js')
  assert.match(client, /require\("react"\)/)
  assert.doesNotMatch(client, /React, React DOM and Scheduler/)
  assert.doesNotMatch(standalone, /client\.export-html\.js/)
  for (const bundle of [client, standalone]) assert.doesNotMatch(bundle, /composeSvg|toPng|png\.title|image\/png/, 'PNG export code must not ship')
  // An existing icon shard remains a dependency-free data chunk.
  assert.equal(typeof moduleOf(await read(shardFile(0))), 'object')
})
