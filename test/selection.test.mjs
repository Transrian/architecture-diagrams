// Selection survives navigation/version changes, but detail data always comes from the current model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectionContainer, selectionItem } from '../src/viewer/navigation.js'
import { isGroup } from '../src/viewer/zoom.js'

const element = (id, fields = {}) => ({
  id, title: id.split('.').at(-1), kind: 'service', parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null,
  description: '', technology: '', state: undefined, marks: [], tags: [], metadata: {}, children: [], ...fields,
})
const modelOf = (...elements) => ({ elements: Object.fromEntries(elements.map((element) => [element.id, element])) })
const viewOf = (...nodes) => ({ nodes })

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

test('selectionContainer finds the deepest visible ancestor, regardless of node order', () => {
  const view = viewOf({ id: 'shop.checkout' }, { id: 'shop' }, { id: 'shop.checkout.payment' })
  assert.equal(selectionContainer(view, 'shop.checkout.payment.api'), 'shop.checkout.payment')
  assert.equal(selectionContainer(viewOf(...view.nodes.toReversed()), 'shop.checkout.payment.api'), 'shop.checkout.payment')
  assert.equal(selectionContainer(view, 'shop.checkout.other'), 'shop.checkout')
  assert.equal(selectionContainer(view, 'shop.catalog.api'), 'shop')
})

test('selectionContainer uses dot boundaries, not similarly prefixed ids', () => {
  const view = viewOf({ id: 'shop' }, { id: 'shop.pay' }, { id: 'shop.pay_extra' }, { id: 'shop.pay2' })
  assert.equal(selectionContainer(view, 'shop.pay.api'), 'shop.pay')
  assert.equal(selectionContainer(view, 'shop.pay_extra.api'), 'shop.pay_extra')
  assert.equal(selectionContainer(view, 'shop.pay2.api'), 'shop.pay2')
  assert.equal(selectionContainer(view, 'shop.payment.api'), 'shop')
  assert.equal(selectionContainer(view, 'shop_extra.pay.api'), null)
  assert.equal(selectionContainer(view, 'shopper.api'), null)
})

test('selectionContainer returns null for exact visibility, unrelated views and absent selection', () => {
  const view = viewOf({ id: 'shop' }, { id: 'shop.checkout' }, { id: 'shop.checkout.api' })
  assert.equal(selectionContainer(view, 'shop.checkout.api'), null)
  assert.equal(selectionContainer(view, 'shop.checkout'), null)
  assert.equal(selectionContainer(view, 'shop'), null)
  assert.equal(selectionContainer(view, 'other.api'), null)
  assert.equal(selectionContainer(viewOf(), 'shop.checkout.api'), null)
  assert.equal(selectionContainer(null, 'shop.checkout.api'), null)
  for (const id of [null, undefined, '']) assert.equal(selectionContainer(view, id), null)
})

test('selectionItem disappears with the current-model id, even when a stale layout still contains it', () => {
  const id = 'shop.api'
  const stale = viewOf({ id, title: 'Old title', state: 'planned', x: 10, children: [] })
  assert.equal(selectionItem(modelOf(), stale, id), null)
  assert.equal(selectionItem(null, stale, id), null)
  const restored = modelOf(element(id, { title: 'Restored API', state: 'done' }))
  const selected = selectionItem(restored, stale, id)
  assert.equal(selected.id, id)
  assert.equal(selected.title, 'Restored API')
  assert.equal(selected.state, 'done')
  assert.equal(selected.x, 10)
  assert.equal(selectionItem(modelOf(), stale, id), null, 'a later removal is not masked by previous selection data')
})

test('selectionItem refreshes semantic fields while preserving current layout geometry and actions', () => {
  const id = 'shop.api'
  const canonical = element(id, {
    title: 'Current API', kind: 'component', description: 'Current description', technology: 'Rust',
    state: 'done', marks: ['removed'], tags: ['done', 'removed'], metadata: { proof: 'Current tests' },
  })
  const node = {
    id, title: 'Stale API', kind: 'service', description: 'Stale description', technology: 'Go',
    state: 'planned', marks: ['new'], tags: ['planned', 'new'], metadata: { proof: 'Stale tests' }, metadataPlain: { proof: 'Stale tests' },
    x: 10, y: 20, width: 100, height: 50, drill: 'diagram_shop__api', unfold: true,
    expanded: false, hidden: 4, internalLinks: 2, externalLinks: 3, children: [],
  }
  const selected = selectionItem(modelOf(canonical), viewOf(node), id)
  for (const field of ['id', 'title', 'kind', 'description', 'technology', 'state', 'parent']) assert.equal(selected[field], canonical[field], field)
  for (const field of ['marks', 'tags', 'metadata']) assert.deepEqual(selected[field], canonical[field], field)
  assert.deepEqual(selected.metadataPlain, canonical.metadata)
  for (const field of ['x', 'y', 'width', 'height', 'drill', 'unfold', 'expanded', 'hidden', 'internalLinks', 'externalLinks']) assert.equal(selected[field], node[field], field)
})

test('selectionItem clears semantic values removed from a later model instead of leaking stale layout values', () => {
  const id = 'shop.api'
  const model = modelOf({ id, title: 'API', kind: 'service', parent: 'shop', children: [] })
  const stale = viewOf({ id, state: 'planned', marks: ['new'], tags: ['planned', 'new'], description: 'Old', technology: 'Old', metadata: { proof: 'Old' }, metadataPlain: { proof: 'Old' }, children: [] })
  const selected = selectionItem(model, stale, id)
  assert.equal(selected.state, undefined)
  assert.equal(selected.description, '')
  assert.equal(selected.technology, '')
  assert.deepEqual(selected.marks, [])
  assert.deepEqual(selected.tags, [])
  assert.deepEqual(selected.metadata, {})
  assert.deepEqual(selected.metadataPlain, {})
})

test('selectionItem preserves collapsed layout children instead of turning a box into a group frame', () => {
  const id = 'shop.checkout'
  const model = modelOf(element(id, { kind: 'system', children: [id + '.api', id + '.db'] }))
  const node = { id, children: [], hidden: 2, internalLinks: 1, externalLinks: 3, drill: 'checkout_view', unfold: true }
  const selected = selectionItem(model, viewOf(node), id)
  assert.deepEqual(selected.children, [])
  assert.equal(isGroup(selected), false)
  assert.equal(selected.hidden, 2)
  assert.equal(selected.drill, 'checkout_view')
  assert.equal(selected.unfold, true)
  assert.deepEqual(model.elements[id].children, [id + '.api', id + '.db'])
  const open = selectionItem(model, viewOf({ ...node, children: [id + '.api'] }), id)
  assert.deepEqual(open.children, [id + '.api'], 'expanded frames also retain the exact local layout children')
  assert.equal(isGroup(open), true)
})

test('selectionItem outside the current view returns a fresh canonical summary and detail metadata', () => {
  const id = 'shop.checkout'
  const canonical = element(id, { kind: 'system', children: [id + '.api'], state: 'waiting', metadata: { why: 'Review' } })
  const model = modelOf(canonical)
  const selected = selectionItem(model, viewOf({ id: 'other', x: 99 }), id)
  assert.notEqual(selected, canonical)
  assert.equal(selected.id, id)
  assert.equal(selected.state, 'waiting')
  assert.equal(selected.x, undefined)
  assert.equal(selected.drill, undefined)
  assert.deepEqual(selected.children, canonical.children)
  assert.deepEqual(selected.metadataPlain, canonical.metadata)
  assert.equal(selectionItem(model, null, id).title, canonical.title)
})

test('selection helpers never mutate inputs and return fresh semantic collections', () => {
  const id = 'shop.api'
  const model = deepFreeze(modelOf(element(id, { state: 'doing', marks: ['new'], tags: ['doing', 'new'], metadata: { proof: 'Tests' } })))
  const view = deepFreeze(viewOf({ id, children: [], x: 10 }))
  const before = structuredClone({ model, view })
  const selected = selectionItem(model, view, id)
  const again = selectionItem(model, view, id)
  assert.notEqual(selected, again)
  assert.notEqual(selected, view.nodes[0])
  assert.notEqual(selected, model.elements[id])
  selected.marks.push('removed')
  selected.tags.push('done')
  selected.metadata.proof = 'Changed result only'
  selected.metadataPlain.proof = 'Changed detail only'
  selected.children.push('other')
  assert.equal(selectionContainer(view, id + '.child'), id)
  assert.deepEqual({ model, view }, before)
  assert.deepEqual(again.marks, ['new'])
  assert.deepEqual(again.children, [])
})
