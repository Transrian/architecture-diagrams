import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { buildHtml, CURRENT, HISTORY, escapeScript, escapeJson, packageRoot, selectIcons } from '../cli/html.mjs'
import { compute } from '../lib/likec4.mjs'
import { shardOf, shardFile } from '../src/iconrules.js'

const source = await readFile(new URL('../examples/reference.c4', import.meta.url), 'utf8')
const result = await compute(source)
const files = { [CURRENT]: source, [`${HISTORY}/0001-20260101T000000Z.c4`]: source }
let embedded
function dataOf(html) {
  return JSON.parse(/<script type="application\/json" id="dshd-data">([\s\S]*?)<\/script>/.exec(html)[1])
}

test('embedded HTML is bounded, offline, private and preserves the sources', async () => {
  embedded = await buildHtml({ mode: 'embedded', name: 'reference', files, result })
  assert.equal((embedded.match(/<script\b/g) ?? []).length, (embedded.match(/<\/script>/g) ?? []).length)
  const data = dataOf(embedded)
  assert.equal(data.files[CURRENT], source)
  assert.equal(data.files[`${HISTORY}/0001-20260101T000000Z.c4`], source)
  assert.equal(data.mode, 'embedded')
  assert.ok(!embedded.includes(homedir()))
  assert.ok(!embedded.includes(packageRoot))
  assert.ok(Buffer.byteLength(embedded) <= 5_000_000, `${Buffer.byteLength(embedded)} bytes`)
  assert.doesNotMatch(embedded, /<script\b[^>]*\bsrc=/i)
})

test('all icons in every reference view are embedded', async () => {
  const data = dataOf(embedded ?? await buildHtml({ files, result }))
  const present = new Set(Object.values(data.icons).flatMap((shard) => Object.keys(shard)))
  for (const v of result.views) for (const n of v.nodes) if (n.icon) {
    const pack = await readFile(path.join(packageRoot, shardFile(shardOf(n.icon))), 'utf8').catch(() => '')
    if (pack.includes(JSON.stringify(n.icon))) assert.ok(present.has(n.icon), `missing ${n.icon}`)
  }
})

test('remote HTML omits data and inline engine but retains the loader', async () => {
  const html = await buildHtml({ mode: 'remote', name: '/not/published/reference', lang: 'fr' })
  const data = dataOf(html)
  assert.equal(data.name, 'reference')
  assert.equal(data.files, undefined)
  assert.equal(data.icons, undefined)
  assert.match(html, /client\.likec4\.js/)
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
    await mkdir(path.join(root, 'lib'))
    await writeFile(path.join(root, 'lib/standalone.js'), js)
    await writeFile(path.join(root, 'client.likec4.js'), js)
    const html = await buildHtml({ root, name: '"<&>', lang: '"<&>', files: { [CURRENT]: '</script><!--' }, icons: {} })
    assert.equal((html.match(/<script\b/g) ?? []).length, (html.match(/<\/script>/g) ?? []).length)
    assert.equal(dataOf(html).files[CURRENT], '</script><!--')
    assert.match(html, /<title>&quot;&lt;&amp;&gt;<\/title>/)
    assert.ok(!html.includes(root))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing builds have a clear diagnostic', async () => {
  await assert.rejects(buildHtml({ root: '/nonexistent-dshd-build', files, icons: {} }), /run "cd build && node build\.mjs" first/)
})

test('a missing icon shard is harmless', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dshd-icons-'))
  try {
    assert.deepEqual(await selectIcons({ [CURRENT]: source }, { root, result }), {})
  } finally { await rm(root, { recursive: true, force: true }) }
})
