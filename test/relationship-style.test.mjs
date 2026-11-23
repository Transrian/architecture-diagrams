import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relationStyle, viewLegend, relationAssumed, relationLabel, relationLabelBox } from '../src/viewer/theme.js'

test('relationship meaning has distinct non-colour channels and mixed has its own pattern', () => {
  assert.deepEqual(relationStyle(), { pattern: undefined, width: 2.5, head: 'full' })
  assert.deepEqual(relationStyle('async'), { pattern: '16 8', width: 2.5, head: 'open' })
  assert.deepEqual(relationStyle('data'), { pattern: undefined, width: 4, head: 'double' })
  assert.deepEqual(relationStyle('mixed'), { pattern: '10 4 2 4', width: 2.5, head: 'full' })
  const patterns = [undefined, 'async', 'data', 'mixed'].map((kind) => JSON.stringify(relationStyle(kind)))
  assert.equal(new Set(patterns).size, 4, 'every kind, mixed included, draws differently')
})

test('assumed provenance adds text and italics semantics without another line motif', () => {
  const t = (key, args) => key === 'count.links' ? `${args.n} links` : key
  assert.equal(relationAssumed({ assumedCount: 1 }), true)
  assert.equal(relationAssumed({ marks: ['assumed'] }), true)
  assert.equal(relationAssumed({ tags: ['assumed'] }), true)
  assert.equal(relationAssumed({ state: 'planned', marks: ['new'] }), false)
  assert.equal(relationLabel({ label: 'events', marks: ['assumed'] }, 0, false, t), 'events ?')
  assert.equal(relationLabel({ label: '', marks: ['assumed'] }, 0, false, t), '?')
  assert.equal(relationLabel({ id: 'step-02:par.01', label: 'events', assumedCount: 1 }, 0, true, t), '2a. events ?')
  assert.equal(relationLabel({ id: 'step-02', label: '', marks: ['assumed'] }, 0, true, t), '2. ?')
  assert.equal(relationLabel({ count: 3, label: 'first', assumedCount: 1 }, 0, false, t), '3 links ?')
  assert.equal(relationLabel({ label: 'events', marks: [] }, 0, false, t), 'events')
  for (const view of [{ nodes: [{ marks: ['assumed'] }] }, { nodes: [{ assumedCount: 2 }] }, { edges: [{ assumedCount: 1 }] }]) assert.equal(viewLegend(view).assumed, true)
})

test('an unlabelled assumed arrow gets a question-mark anchor on its existing curve', () => {
  const existing = { x: 1, y: 2, width: 3, height: 4 }
  assert.equal(relationLabelBox({ labelBBox: existing }), existing)
  assert.equal(relationLabelBox({ points: [[0, 0], [100, 0]] }), null)
  assert.equal(relationLabelBox({ marks: ['assumed'], points: [] }), null)
  assert.deepEqual(relationLabelBox({ marks: ['assumed'], points: [[0, 0], [100, 0]] }), { x: 58, y: -24, width: 12, height: 24 })
  const curve = { marks: ['assumed'], points: [[0, 0], [0, 40], [100, 40], [100, 0]] }
  const before = structuredClone(curve)
  assert.deepEqual(relationLabelBox(curve), { x: 58, y: 6, width: 12, height: 24 })
  assert.deepEqual(curve, before)
})

test('local legend contains only states and kinds drawn in the current view in vocabulary order', () => {
  assert.deepEqual(viewLegend(), { states: [], kinds: [], assumed: false, opens: false, elsewhere: false })
  const view = {
    nodes: [{ state: 'done' }, { rollup: { state: 'planned' } }, { state: 'frozen' }],
    edges: [{ state: 'blocked', kind: 'data' }, { kind: 'async' }, { kind: 'mixed' }, {}, { kind: 'data' }],
  }
  assert.deepEqual(viewLegend(view), { states: ['blocked', 'planned', 'done', 'frozen'], kinds: ['call', 'async', 'data', 'mixed'], assumed: false, opens: false, elsewhere: false })
  assert.deepEqual(viewLegend({ nodes: [{ state: 'done' }], edges: [] }), { states: ['done'], kinds: [], assumed: false, opens: false, elsewhere: false })
})

test('the legend explains collapsed groups: ⊕ inside the frame, ↗ around it', () => {
  const nodes = [{ id: 'a', children: ['a.b', 'a.c'] }, { id: 'a.b', hidden: 3 }, { id: 'z', hidden: 2 }]
  assert.deepEqual([viewLegend({ viewOf: 'a', nodes }).opens, viewLegend({ viewOf: 'a', nodes }).elsewhere], [true, true])
  assert.deepEqual([viewLegend({ nodes: [{ id: 'z', hidden: 2 }] }).opens, viewLegend({ nodes: [{ id: 'z', hidden: 2 }] }).elsewhere], [true, false])
  assert.deepEqual([viewLegend({ viewOf: 'a', nodes: nodes.slice(0, 2) }).elsewhere, viewLegend({ nodes: [{ id: 'q' }] }).opens], [false, false])
})
