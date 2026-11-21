// Merged links and hidden content must remain explainable at every scope.
// Engine cases need a build; pure endpoint helpers can be selected separately.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compute, stateOf, STATES } from '../lib/likec4.mjs'
import { endpointPath, endpointUnfolds } from '../src/relations.js'

let reference
const referenceResult = () => reference ??= compute(readFileSync(new URL('../examples/reference.c4', import.meta.url), 'utf8'))
const inView = (result, scope) => result.views.find((view) => view.viewOf === scope)

test('Azure prod → Data exposes its three exact original links, ids and states', async () => {
  const result = await referenceResult()
  assert.deepEqual(result.errors, [])
  const edge = inView(result, 'azure').edges.find((edge) => edge.source === 'azure.prod' && edge.target === 'data')
  assert.equal(edge.count, 3)
  assert.deepEqual(edge.relations, ['9oma2', '3kri63', 'ytvj4a'])
  assert.deepEqual(edge.relationList, [
    { id: '9oma2', source: 'Service Bus', target: 'Kafka Connect', sourceId: 'azure.prod.tracking.vnet.app.bus', targetId: 'data.pipelines.ingest.connect', title: 'scan events', state: undefined, marks: [] },
    { id: '3kri63', source: 'Cosmos DB', target: 'Kafka Connect', sourceId: 'azure.prod.tracking.vnet.data.cosmos', targetId: 'data.pipelines.ingest.connect', title: 'change feed', state: undefined, marks: [] },
    { id: 'ytvj4a', source: 'Log Analytics', target: 'BigQuery', sourceId: 'azure.prod.tracking.monitoring.logs', targetId: 'data.gcp.warehouse', title: 'ops metrics', state: undefined, marks: [] },
  ])
  for (const relation of edge.relationList) {
    assert.equal(relation.state, result.model.relations[relation.id].state)
    assert.deepEqual(relation.marks, result.model.relations[relation.id].marks)
  }
  assert.equal(edge.state, undefined, 'endpoint element states never leak onto links')
  assert.equal(edge.mixed, false)
})

test('rg-tracking hides 11 internal links and has 9 links across its boundary', async () => {
  const result = await referenceResult()
  const node = inView(result, 'azure.prod').nodes.find((node) => node.id === 'azure.prod.tracking')
  assert.equal(node.children.length, 0)
  assert.equal(node.internalLinks, 11)
  assert.equal(node.externalLinks, 9)
  const unfolded = await compute(readFileSync(new URL('../examples/reference.c4', import.meta.url), 'utf8'), { expand: ['azure.prod.tracking'] })
  assert.deepEqual(unfolded.errors, [])
  const frame = inView(unfolded, 'azure.prod').nodes.find((node) => node.id === 'azure.prod.tracking')
  assert.ok(frame.children.length > 0)
  assert.equal(frame.internalLinks, undefined, 'expanded frames do not claim their links are hidden')
})

test('merged states use STATES precedence, preserving untagged links and original marks', async () => {
  const tagged = STATES.map((state) => `left.api -> mixed.api '${state}' { #${state}${state === 'done' ? ' #new #removed' : ''} }`).join('\n')
  const source = `// diagram v1
model {
  app = system 'App' {
    left = system 'Left' { api = service 'API' }
    mixed = system 'Mixed' { api = service 'API' }
    uniform = system 'Uniform' { api = service 'API' }
    neutral = system 'Neutral' { api = service 'API' }
    partial = system 'Partial' { api = service 'API' }
    ${tagged}
    left.api -> mixed.api 'none'
    left.api -> uniform.api 'one' { #done }
    left.api -> uniform.api 'two' { #done }
    left.api -> neutral.api 'one'
    left.api -> neutral.api 'two'
    left.api -> partial.api 'one' { #done }
    left.api -> partial.api 'two'
  }
}`
  const result = await compute(source)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.problems, [])
  const view = inView(result, 'app')
  const edgeTo = (id) => view.edges.find((edge) => edge.source === 'app.left' && edge.target === 'app.' + id)
  const mixed = edgeTo('mixed')
  assert.equal(mixed.count, STATES.length + 1)
  assert.equal(mixed.state, STATES[0])
  assert.equal(mixed.mixed, true)
  for (const state of STATES) {
    const relation = mixed.relationList.find((relation) => relation.title === state)
    assert.equal(relation.state, state)
    assert.equal(result.model.relations[relation.id].state, stateOf([state]))
  }
  assert.deepEqual(mixed.relationList.find((relation) => relation.title === 'done').marks, ['new', 'removed'])
  assert.equal(mixed.relationList.find((relation) => relation.title === 'none').state, undefined)
  assert.equal(edgeTo('uniform').state, 'done')
  assert.equal(edgeTo('uniform').mixed, false)
  assert.equal(edgeTo('neutral').state, undefined)
  assert.equal(edgeTo('neutral').mixed, false)
  assert.equal(edgeTo('partial').state, 'done')
  assert.equal(edgeTo('partial').mixed, true, 'no state is different from an explicit state')
})

test('collapsed counts include links to the group but not similarly prefixed siblings', async () => {
  const result = await compute(`// diagram v1
model {
  app = system 'App' {
    group = system 'Group' {
      api = service 'API'
      db = data 'DB'
      api -> db 'internal'
    }
    group_extra = service 'Other'
    external = service 'Caller'
    group.api -> group_extra 'outside'
    external -> group.db 'incoming'
    external -> group 'group endpoint'
  }
}`)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.problems, [])
  const view = inView(result, 'app')
  const group = view.nodes.find((node) => node.id === 'app.group')
  assert.equal(group.internalLinks, 1)
  assert.equal(group.externalLinks, 3)
  assert.equal(view.nodes.find((node) => node.id === 'app.group_extra').internalLinks, undefined)
})

// Repeated short ids/titles in another schema guard against title-based lookup.
const elements = {}
for (const [id, title] of [
  ['shop', 'Shop'], ['shop.checkout', 'Checkout'], ['shop.checkout.pay', 'Payment'],
  ['shop.checkout.pay.api', 'payments.ts'], ['shop.checkout.pay.db', 'DB'],
  ['shop.catalog', 'Catalog'], ['shop.catalog.api', 'API'],
  ['shop_extra', 'Other shop'], ['shop_extra.checkout', 'Checkout'], ['shop_extra.checkout.api', 'payments.ts'],
]) {
  const parent = id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null
  elements[id] = { id, parent, title, children: [] }
  if (parent) elements[parent].children.push(id)
}
const model = { elements }
const edge = { relationList: [
  { sourceId: 'shop.checkout.pay.api', targetId: 'shop.catalog.api' },
  { sourceId: 'shop.checkout.pay.db', targetId: 'shop_extra.checkout.api' },
] }
const scopedView = { generated: true, viewOf: 'shop', nodes: [
  { id: 'shop', children: ['shop.checkout', 'shop.catalog'] },
  { id: 'shop.checkout', children: [], unfold: true },
  { id: 'shop.catalog', children: [], unfold: true },
  { id: 'shop_extra', children: [], unfold: false },
] }

test('endpoint breadcrumbs resolve exact ids relative to the current scope', () => {
  assert.equal(endpointPath(model, 'shop.checkout.pay.api', scopedView), 'Checkout › Payment › payments.ts')
  assert.equal(endpointPath(model, 'shop.checkout.pay.api', { viewOf: 'shop.checkout' }), 'Payment › payments.ts')
  assert.equal(endpointPath(model, 'shop.checkout', { viewOf: 'shop.checkout' }), 'Checkout')
  assert.equal(endpointPath(model, 'shop_extra.checkout.api', scopedView), 'Other shop › Checkout › payments.ts')
  assert.equal(endpointPath(model, 'shop.checkout.pay.api', { viewOf: null }), 'Shop › Checkout › Payment › payments.ts')
  assert.equal(endpointPath(model, 'missing.api', scopedView), 'missing.api')
})

test('endpoint unfolding adds only closed ancestors within the generated scope', () => {
  assert.deepEqual(endpointUnfolds(edge, model, scopedView), ['shop.catalog', 'shop.checkout', 'shop.checkout.pay'])
  assert.deepEqual(endpointUnfolds(edge, model, scopedView, ['shop.checkout.pay']), ['shop.catalog', 'shop.checkout'])
  const open = { ...scopedView, nodes: scopedView.nodes.map((node) => node.id === 'shop.checkout' ? { ...node, expanded: true, children: ['shop.checkout.pay'] } : node) }
  assert.deepEqual(endpointUnfolds(edge, model, open, ['shop.checkout']), ['shop.catalog', 'shop.checkout.pay'])
  assert.deepEqual(endpointUnfolds(edge, model, open, ['shop.checkout', 'shop.checkout.pay', 'shop.catalog']), [])
  assert.deepEqual(endpointUnfolds(edge, model, { ...scopedView, generated: false }), [], 'user views never unfold')
  assert.deepEqual(endpointUnfolds(edge, model, { ...scopedView, generated: undefined, _type: 'dynamic' }), [])
})

test('endpoint unfolding never opens the scope frame, outside branches or group endpoints', () => {
  const inside = { generated: true, viewOf: 'shop.checkout', nodes: [] }
  assert.deepEqual(endpointUnfolds(edge, model, inside), ['shop.checkout.pay'])
  assert.deepEqual(endpointUnfolds({ relationList: [{ sourceId: 'shop.checkout', targetId: 'shop.checkout.pay' }] }, model, inside), [], 'a visible group endpoint itself stays folded')
  assert.deepEqual(endpointUnfolds({ relationList: [{ sourceId: 'shop_extra.checkout.api', targetId: 'shop.catalog.api' }] }, model, inside), [], 'outside endpoints do not affect the wrong schema')
  const overview = endpointUnfolds(edge, model, { generated: true, viewOf: null, nodes: [] })
  assert.deepEqual(new Set(overview), new Set(['shop', 'shop_extra', 'shop.catalog', 'shop.checkout', 'shop_extra.checkout', 'shop.checkout.pay']))
  for (const id of overview) {
    const parent = elements[id].parent
    if (parent) assert.ok(overview.indexOf(parent) < overview.indexOf(id), 'ancestors unfold before their descendants')
  }
})
