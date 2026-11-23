// Parse-only engine entry, built from build/entry.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
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

test('modelOf returns null for invalid or unsupported input, including the former header', async () => {
  assert.equal(await modelOf(source.replace('// diagram v1', '// carte v2')), null)
  assert.equal(await modelOf('// diagram v1\nmodel { broken ='), null)
  assert.equal(await modelOf(source.replace('// diagram v1', '// diagram v999')), null)
  assert.equal(await modelOf(source.replace('// diagram v1', '// missing')), null)
})
