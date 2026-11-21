import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffModels } from '../src/diff.js'
import { changeLine, lossLine, unlabeledLine, okReport } from '../report.js'

const element = (id, fields = {}) => ({ id, kind: 'service', title: id.split('.').at(-1), description: '', technology: '', metadata: {}, state: undefined, marks: [], ...fields })
const relation = (id, source, target, title = '', fields = {}) => ({ id, source, target, title, tags: [], ...fields })
const model = (elements = [], relations = []) => ({ elements: Object.fromEntries(elements.map((entry) => [entry.id, entry])), relations: Object.fromEntries(relations.map((entry) => [entry.id, entry])) })
const unchanged = (diff) => assert.equal(changeLine(diff), '')

test('semantic diff reports element and relation additions/removals without mutating inputs', () => {
  const before = model([element('a'), element('b')], [relation('r1', 'a', 'b', 'calls')])
  const after = model([element('a'), element('c')], [relation('r2', 'a', 'c', 'calls')])
  const copy = structuredClone([before, after])
  const diff = diffModels(before, after)
  assert.equal(diff.beforeCount, 2)
  assert.equal(diff.afterCount, 2)
  assert.deepEqual(diff.elements.added.map((entry) => entry.id), ['c'])
  assert.deepEqual(diff.elements.removed.map((entry) => entry.id), ['b'])
  assert.deepEqual(diff.relations.added.map((entry) => entry.id), ['r2'])
  assert.deepEqual(diff.relations.removed.map((entry) => entry.id), ['r1'])
  assert.deepEqual([before, after], copy)
})

test('element changes list every semantic field, including state and marks', () => {
  const before = element('root.api', { state: 'planned' })
  const after = element('root.api', { title: 'Gateway', description: 'Receives calls', technology: 'Go', kind: 'component', metadata: { why: 'Smaller scope' }, state: 'doing', marks: ['new'] })
  const diff = diffModels(model([before]), model([after]))
  assert.deepEqual(diff.elements.changed[0].fields, ['title', 'description', 'technology', 'kind', 'metadata', 'state', 'marks'])
  assert.match(changeLine(diff, { version: 12 }), /^Changes since v12: \+0 elements, −0, 1 changed, 1 state change; links \+0 −0\.$/)
})

test('unique moves remap both relation endpoints before matching links', () => {
  const before = model([element('old.api'), element('old.db')], [relation('r1', 'old.api', 'old.db', 'queries')])
  const after = model([element('new.api'), element('new.db')], [relation('newGeneratedId', 'new.api', 'new.db', 'queries')])
  const diff = diffModels(before, after)
  assert.deepEqual(diff.elements.moved.map(({ from, to }) => [from, to]), [['old.api', 'new.api'], ['old.db', 'new.db']])
  assert.deepEqual(diff.elements.added, [])
  assert.deepEqual(diff.elements.removed, [])
  assert.deepEqual(diff.elements.changed, [])
  assert.deepEqual(diff.relations, { added: [], removed: [], changed: [] })
  assert.match(changeLine(diff), /2 moved/)
})

test('moved elements may also change state or metadata', () => {
  const diff = diffModels(model([element('a.api')]), model([element('b.api', { state: 'done' })]))
  assert.equal(diff.elements.moved.length, 1)
  assert.deepEqual(diff.elements.changed[0].fields, ['state'])
})

test('ambiguous moves remain additions/removals, in either matching direction', () => {
  for (const [oldIds, newIds] of [[['a.api', 'b.api'], ['c.api']], [['a.api'], ['b.api', 'c.api']]]) {
    const diff = diffModels(model(oldIds.map((id) => element(id))), model(newIds.map((id) => element(id))))
    assert.equal(diff.elements.moved.length, 0)
    assert.equal(diff.elements.removed.length, oldIds.length)
    assert.equal(diff.elements.added.length, newIds.length)
  }
})

test('moves require kind, title and final id segment to agree', () => {
  for (const after of [element('b.api', { kind: 'component' }), element('b.api', { title: 'Other' }), element('b.gateway', { title: 'api' })]) {
    const diff = diffModels(model([element('a.api')]), model([after]))
    assert.equal(diff.elements.moved.length, 0)
    assert.equal(diff.elements.added.length, 1)
    assert.equal(diff.elements.removed.length, 1)
  }
})

test('relations match exact labels before remaining endpoint pairs and detect relabels', () => {
  const before = model([], [relation('first', 'a', 'b', 'old'), relation('second', 'a', 'b', 'keep')])
  const after = model([], [relation('x', 'a', 'b', 'keep'), relation('y', 'a', 'b', 'new')])
  const diff = diffModels(before, after)
  assert.equal(diff.relations.changed.length, 1)
  assert.deepEqual(diff.relations.changed[0], { id: 'y', before: before.relations.first, after: after.relations.y, fields: ['title'] })
  assert.deepEqual(diff.relations.added, [])
  assert.deepEqual(diff.relations.removed, [])
})

test('relation tag changes are semantic, ids and array order are not', () => {
  const before = model([], [relation('one', 'a', 'b', 'calls', { tags: ['doing', 'new'] })])
  unchanged(diffModels(before, model([], [relation('two', 'a', 'b', 'calls', { tags: ['new', 'doing'] })])))
  const diff = diffModels(before, model([], [relation('two', 'a', 'b', 'calls', { tags: ['done', 'new'] })]))
  assert.deepEqual(diff.relations.changed[0].fields, ['tags'])
})

test('reordered metadata, marks and derived layout/icon properties do not create changes', () => {
  const before = element('a', { metadata: { why: 'Scope', proof: 'Tests' }, marks: ['new', 'removed'], children: ['a.b'], icon: 'one' })
  const after = element('a', { metadata: { proof: 'Tests', why: 'Scope' }, marks: ['removed', 'new'], children: [], icon: 'two', parent: null, depth: 1 })
  unchanged(diffModels(model([before]), model([after])))
  unchanged(diffModels(model(), model()))
})

test('tuple relation identity does not collide with separators in titles', () => {
  const before = model([], [relation('a', 'x', 'y', 'a|b'), relation('b', 'x', 'y', 'a')])
  unchanged(diffModels(before, model([], Object.values(before.relations).reverse())))
})

function deletion(beforeCount, removedCount) {
  return diffModels(model(Array.from({ length: beforeCount }, (_, i) => element(`n${i}`))), model(Array.from({ length: beforeCount - removedCount }, (_, i) => element(`n${i + removedCount}`))))
}

test('mass deletion requires both at least five removals and at least 25 percent', () => {
  assert.equal(lossLine(deletion(10, 4)), '', '40% is not enough when fewer than five')
  assert.equal(lossLine(deletion(21, 5)), '', 'five out of 21 is below 25%')
  assert.match(lossLine(deletion(20, 5), { snapshot: '/work/.diagram/s/0001.c4' }), /5 of 20 elements removed[\s\S]*restore them from <\/work\/\.diagram\/s\/0001\.c4>/)
  const warning = lossLine(deletion(20, 10), { snapshot: '/work/base.c4' })
  assert.match(warning, /n0, n1, n2, n3, n4, n5, n6, n7 \(\+2 more\)/)
  assert.doesNotMatch(warning, /n8|n9|refused/)
  assert.match(lossLine(deletion(10, 5)), /history is disabled; no snapshot was saved/)
  assert.equal(lossLine(null), '')
})

test('unlabeled guidance counts absent, empty and whitespace-only relation labels', () => {
  assert.equal(unlabeledLine(model()), '')
  assert.equal(unlabeledLine(model([], [relation('a', 'a', 'b', 'calls')])), '')
  assert.match(unlabeledLine(model([], [relation('a', 'a', 'b'), relation('b', 'b', 'a', '  ')])), /^Note: 2 unlabeled relations;/)
  assert.match(unlabeledLine(model([], [relation('a', 'a', 'b')])), /^Note: 1 unlabeled relation;/)
})

test('accepted verdicts include all optional editing notes before the diagram link', () => {
  assert.equal(okReport({ result: { views: [], schemas: [], extras: [] }, changes: 'Changes', warning: 'Warning', unlabeled: 'Note', icons: 'Icons', link: 'Link' }), '[diagram] Diagram valid and shown to the user: no schema.\nChanges\nWarning\nNote\nIcons\nLink')
})
