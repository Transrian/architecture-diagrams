// Parse-only engine entry, built from build/entry.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { modelOf, compute } from '../skills/dsh-diagram/assets/engine.mjs'

const source = `// diagram v1
model {
  shop = system 'Shop' {
    api = service 'Gateway' {
      #doing #new
      technology 'Go'
      metadata {
        proof 'Focused tests'
      }
    }
    db = data 'Records'
    api -> db 'queries'
  }
}`

test('modelOf returns the same cached model summary as compute without generated views', async () => {
  const model = await modelOf(source)
  assert.equal(model.elements['shop.api'].title, 'Gateway')
  assert.equal(model.elements['shop.api'].state, 'doing')
  assert.deepEqual(model.elements['shop.api'].marks, ['new'])
  assert.deepEqual(model.elements['shop.api'].metadata, { proof: 'Focused tests' })
  const link = Object.values(model.relations)[0]
  assert.equal(link.source, 'shop.api')
  assert.equal(link.target, 'shop.db')
  assert.equal(link.title, 'queries')
  assert.ok(model.views.every((view) => view.id === 'index'), 'only LikeC4’s implicit landscape view, no generated drill-downs')
  assert.ok(model.views.every((view) => !Object.hasOwn(view, 'nodes') && !Object.hasOwn(view, 'bounds')), 'view summaries have no layout')
  assert.equal(await modelOf(source), model, 'same source reuses the parse cache')
  const laidOut = await compute(source)
  assert.deepEqual(laidOut.errors, [])
  assert.equal(laidOut.model, model)
  assert.ok(laidOut.views.length > 0)
})

test('modelOf is parse-only, not a readability refusal or layout result', async () => {
  const source = "// diagram v1\nmodel { api = service 'Alone at root' }"
  const model = await modelOf(source)
  assert.ok(model?.elements.api)
  assert.equal(model.schemas, undefined)
  assert.equal(model.problems, undefined)
  assert.ok((await compute(source)).problems.length > 0)
})

test('reused workspaces preserve deterministic views and previous results across unfolding', async () => {
  const source = await readFile(new URL('../examples/web-shop.c4', import.meta.url), 'utf8')
  const before = await compute(source)
  assert.deepEqual(before.errors, [])
  const snapshot = structuredClone(before)
  assert.deepEqual(before.views.map(view => view.id), before.views.map(view => view.id).sort())
  const fresh = await import('../skills/dsh-diagram/assets/engine.mjs?workspace-isolation')
  const expand = ['shop.front', 'shop.back']
  const expected = await fresh.compute(source, { expand })
  assert.deepEqual(await compute(source, { expand }), expected, 'lease history must not affect layout order or geometry')
  await compute(source, { expand, direction: 'LeftRight' })
  const repeated = await compute(source)
  assert.deepEqual(repeated, snapshot)
  assert.deepEqual(before, snapshot, 'reuse must not mutate returned models or layouts')
})

test('concurrent workspace leases isolate edits, diagnostics and cached summaries', async () => {
  const changed = source.replace("'Gateway'", "'Changed gateway'").replace('#doing #new', '#blocked')
  const invalid = '// diagram v1\nmodel { broken ='
  const [before, broken, after] = await Promise.all([compute(source), compute(invalid), compute(changed)])
  assert.deepEqual(before.errors, [])
  assert.ok(broken.errors.length > 0)
  assert.deepEqual(after.errors, [])
  assert.equal(before.model.elements['shop.api'].title, 'Gateway')
  assert.equal(before.model.elements['shop.api'].state, 'doing')
  assert.equal(after.model.elements['shop.api'].title, 'Changed gateway')
  assert.equal(after.model.elements['shop.api'].state, 'blocked')
  const snapshot = structuredClone([before, after])
  const recovered = await compute(source.replace("'Gateway'", "'Recovered'"))
  assert.deepEqual(recovered.errors, [], 'invalid documents must not leak into the next lease')
  assert.equal(recovered.model.elements['shop.api'].title, 'Recovered')
  assert.deepEqual([before, after], snapshot)
  assert.equal((await modelOf(source)).elements['shop.api'].title, 'Gateway')
})

test('workspace cache rotation survives invalid-source churn without retaining diagnostics or mutating output', async () => {
  const before = await compute(source)
  const snapshot = structuredClone(before)
  for (let i = 0; i < 20; i++) {
    assert.equal(await modelOf(`// diagram v1\nmodel { broken =\n// revision ${i}`), null)
  }
  assert.deepEqual(await compute(source), snapshot)
  assert.deepEqual(before, snapshot)
})

test('modelOf returns null for invalid or unsupported input, including the former header', async () => {
  assert.equal(await modelOf(source.replace('// diagram v1', '// carte v2')), null)
  assert.equal(await modelOf('// diagram v1\nmodel { broken ='), null)
  assert.equal(await modelOf(source.replace('// diagram v1', '// diagram v999')), null)
  assert.equal(await modelOf(source.replace('// diagram v1', '// missing')), null)
})
