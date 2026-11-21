// examples/reference.c4 is the diagram every new version of the plugin is
// checked against, by eye. These tests keep it honest: valid, and still using
// every kind, state, mark, icon path and limit. When RULES, KINDS, STATES or
// MARKS change, a failure here says what the reference has to gain.
// Needs the built engine: `cd build && node build.mjs` first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compute, RULES, KINDS, STATES, MARKS } from '../lib/likec4.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(path.join(root, 'examples/reference.c4'), 'utf8')
const result = await compute(source)
const { model } = result
const els = model.order.map((id) => model.elements[id])
const rels = Object.values(model.relations)

test('the reference diagram is valid and accepted', () => {
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.problems, [])
})

test('it is bigger than the old 60-element cap', () => {
  assert.ok(els.length > 60, `${els.length} elements`)
})

test('it uses every kind, state and mark', () => {
  for (const k of KINDS) assert.ok(els.some((e) => e.kind === k), `kind ${k}`)
  for (const s of STATES) assert.ok(els.some((e) => e.state === s), `state #${s} on an element`)
  for (const m of MARKS) assert.ok(els.some((e) => e.marks.includes(m)), `mark #${m}`)
  assert.ok(rels.some((r) => r.tags.some((t) => STATES.includes(t))), 'a state on a relation')
  assert.ok(rels.some((r) => r.tags.includes('removed')), 'a mark on a relation')
})

test('it reaches every structural limit without crossing it', () => {
  assert.equal(Math.max(...els.map((e) => e.depth)), RULES.depth, 'deepest leaf')
  assert.equal(Math.max(...els.map((e) => e.children.length)), RULES.children, 'fullest group')
  assert.equal(els.filter((e) => e.parent === null).length, RULES.roots, 'top-level elements')
  assert.ok(els.some((e) => e.parent === null && e.kind === 'person'), 'a person at the root')
  assert.ok(els.some((e) => e.parent === null && e.kind === 'external'), 'an external at the root')
})

test('it uses every kind of metadata', () => {
  const keys = new Set(els.flatMap((e) => Object.keys(e.metadata)))
  for (const k of ['why', 'decided', 'proof']) assert.ok(keys.has(k), `metadata ${k}`)
  assert.ok([...keys].some((k) => !['why', 'decided', 'proof'].includes(k)), 'a free-form metadata key')
  for (const e of els.filter((x) => x.state === 'deviation')) {
    assert.ok(e.metadata.why && e.metadata.decided, `${e.id}: a deviation needs why and decided`)
  }
})

test('it goes through every icon path', () => {
  const how = new Set(Object.values(model.icons).map((i) => i.how))
  for (const h of ['explicit', 'none', 'technology', 'title', 'file', 'word', 'kind']) assert.ok(how.has(h), `icon from ${h}`)
  for (const v of ['aws', 'azure', 'gcp']) {
    assert.ok(Object.values(model.icons).some((i) => i.icon?.startsWith(v + ':')), `a ${v} service icon`)
  }
  // A bare service name resolves through its vendor group.
  assert.equal(model.icons['azure.prod.tracking.vnet.app.functions'].icon, 'azure:function-apps')
  assert.equal(model.icons['aws.legacy.region.tracking.ingest'].icon, 'aws:lambda')
})

test('it has a flow, merged links, and labels that wrap', () => {
  assert.ok(result.extras.some((v) => v.type === 'dynamic'), 'a dynamic view')
  const azureView = result.views.find((v) => v.id === result.schemas.find((s) => s.element === 'azure')?.view)
  assert.ok(result.views.some((v) => (v.edges ?? []).some((e) => e.count > 1)), 'an edge that merges several relations')
  assert.ok(azureView, 'Azure has its own schema button')
  assert.ok(els.some((e) => /[\u4e00-\u9fff]/.test(e.title)), 'a CJK title')
  assert.ok(els.some((e) => /[àéèç]/.test(e.title + e.description)), 'accented text')
  assert.ok(els.some((e) => e.title.length >= RULES.title - 6), 'a title close to the limit')
})
