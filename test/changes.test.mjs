import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffModels } from '../src/core/diff.js'
import { projectChanges } from '../src/viewer/changes.js'

const element = (id, fields = {}) => ({ id, kind: 'service', title: id.split('.').at(-1), ...fields })
const relation = (id, source, target, title, fields = {}) => ({ id, source, target, title, ...fields })
const modelOf = (elements = [], relations = []) => ({
  elements: Object.fromEntries(elements.map((item) => [item.id, item])),
  relations: Object.fromEntries(relations.map((item) => [item.id, item])),
})
const modelIds = (...ids) => modelOf(ids.map((id) => element(id)))
const counts = (fields = {}) => ({ added: 0, changed: 0, moved: 0, removed: 0, ...fields })
const relationCounts = (fields = {}) => ({ added: 0, changed: 0, removed: 0, ...fields })
const empty = {
  nodes: {},
  counts: { ...counts(), relations: relationCounts() },
  removed: [],
  unplaced: [],
  relations: { added: [], changed: [], removed: [] },
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const project = (before, after) => projectChanges(diffModels(before, after), after)

test('absent, unknown and empty diffs produce no badges', () => {
  for (const diff of [undefined, null, {}, { unknown: [1] }, { elements: {}, relations: {} }]) {
    assert.deepEqual(projectChanges(diff, modelIds('R', 'R.api')), empty)
  }
  assert.deepEqual(projectChanges(), empty)
  const model = modelIds('R', 'R.api')
  assert.deepEqual(project(model, model), empty)
})

test('own additions and folded totals count each current element exactly once', () => {
  const before = modelIds('R', 'R.group', 'R.untouched')
  const after = modelIds('R', 'R.group', 'R.untouched', 'R.group.new', 'R.group.new.child')
  const result = project(before, after)
  assert.deepEqual(Object.keys(result.nodes), ['R', 'R.group', 'R.group.new', 'R.group.new.child'])
  assert.deepEqual(result.nodes['R.group.new'].own, counts({ added: 1 }))
  assert.deepEqual(result.nodes['R.group.new'].total, counts({ added: 2 }))
  assert.deepEqual(result.nodes['R.group.new.child'].total, counts({ added: 1 }))
  assert.deepEqual(result.nodes['R.group'].own, counts())
  assert.deepEqual(result.nodes['R.group'].total, counts({ added: 2 }))
  assert.deepEqual(result.nodes.R.total, counts({ added: 2 }))
  assert.deepEqual(result.counts, { ...counts({ added: 2 }), relations: relationCounts() })
  assert.deepEqual(result.nodes['R.group.new'].fields, [])
  assert.equal(result.nodes['R.group.new'].from, null)
})

test('own changed fields are distinct from ancestor roll-up badges', () => {
  const before = modelOf([element('R'), element('R.api', { state: 'planned', technology: 'Go' })])
  const after = modelOf([element('R'), element('R.api', { state: 'done', technology: 'Rust' })])
  const result = project(before, after)
  assert.deepEqual(result.nodes['R.api'].own, counts({ changed: 1 }))
  assert.deepEqual(result.nodes['R.api'].fields, ['state', 'technology'])
  assert.deepEqual(result.nodes.R.own, counts())
  assert.deepEqual(result.nodes.R.total, counts({ changed: 1 }))
  assert.deepEqual(result.nodes.R.fields, [])
})

test('an element may carry both a move badge with its old path and changed fields', () => {
  const before = modelOf([element('R'), element('T'), element('R.api', { state: 'planned' })])
  const after = modelOf([element('R'), element('T'), element('T.api', { state: 'done' })])
  const result = project(before, after)
  assert.equal(result.nodes['T.api'].from, 'R.api')
  assert.deepEqual(result.nodes['T.api'].fields, ['state'])
  assert.deepEqual(result.nodes['T.api'].own, counts({ changed: 1, moved: 1 }))
  assert.deepEqual(result.nodes.T.total, counts({ changed: 1, moved: 1 }))
  assert.equal(result.nodes.R, undefined, 'old location is not painted as a removal')
  assert.deepEqual(result.counts, { ...counts({ changed: 1, moved: 1 }), relations: relationCounts() })
  assert.deepEqual(result.removed, [])
})

test('a deletion attaches to the nearest surviving ancestor, then rolls up once', () => {
  const removed = element('R.group.old', { metadata: { why: 'Replaced' } })
  const before = modelOf([element('R'), element('R.group'), removed])
  const after = modelIds('R', 'R.group')
  const result = project(before, after)
  assert.deepEqual(result.nodes['R.group'].own, counts({ removed: 1 }))
  assert.deepEqual(result.nodes['R.group'].total, counts({ removed: 1 }))
  assert.deepEqual(result.nodes.R.own, counts())
  assert.deepEqual(result.nodes.R.total, counts({ removed: 1 }))
  assert.deepEqual(result.nodes.R.removedElements, [removed])
  assert.deepEqual(result.nodes['R.group'].removedElements, [removed])
  assert.equal(Object.hasOwn(result.nodes, removed.id), false)
  assert.deepEqual(result.removed, [removed])
  assert.deepEqual(result.unplaced, [])
})

test('deleting an ancestor and its child falls back without double-counting', () => {
  const before = modelIds('R', 'R.deleted', 'R.deleted.child')
  const after = modelIds('R')
  const result = project(before, after)
  assert.deepEqual(Object.keys(result.nodes), ['R'])
  assert.deepEqual(result.nodes.R.own, counts({ removed: 2 }))
  assert.deepEqual(result.nodes.R.total, counts({ removed: 2 }))
  assert.deepEqual(
    result.nodes.R.removedElements.map((item) => item.id),
    ['R.deleted', 'R.deleted.child'],
  )
  assert.equal(result.counts.removed, 2)
  assert.deepEqual(result.unplaced, [])
})

test('an entirely removed schema and its descendants are globally unplaced', () => {
  const before = modelIds('Deleted', 'Deleted.api', 'Other', 'Other.keep')
  const after = modelIds('Other', 'Other.keep')
  const result = project(before, after)
  assert.deepEqual(result.nodes, {})
  assert.equal(result.counts.removed, 2)
  assert.deepEqual(
    result.unplaced.map((item) => item.id),
    ['Deleted', 'Deleted.api'],
  )
  assert.deepEqual(result.removed, result.unplaced)
})

test('global deletion totals include placed and unplaced records exactly once', () => {
  const before = modelIds('Gone', 'Gone.child', 'Keep', 'Keep.old', 'Keep.nested', 'Keep.nested.old')
  const after = modelIds('Keep', 'Keep.nested')
  const result = project(before, after)
  assert.equal(result.counts.removed, 4)
  assert.equal(result.removed.length, 4)
  assert.equal(result.unplaced.length, 2)
  assert.equal(result.nodes.Keep.own.removed, 1)
  assert.equal(result.nodes.Keep.total.removed, 2)
  assert.equal(result.nodes['Keep.nested'].own.removed, 1)
  assert.equal(result.nodes['Keep.nested'].total.removed, 1)
  assert.deepEqual(
    result.nodes.Keep.removedElements.map((item) => item.id),
    ['Keep.nested.old', 'Keep.old'],
  )
})

test('a moved subtree rolls up once per moved element only at its new location', () => {
  const before = modelIds('R', 'T', 'R.group', 'R.group.child', 'R.group.child.leaf')
  const after = modelIds('R', 'T', 'T.group', 'T.group.child', 'T.group.child.leaf')
  const result = project(before, after)
  assert.equal(result.counts.moved, 3)
  assert.equal(result.counts.added, 0)
  assert.equal(result.counts.removed, 0)
  assert.equal(result.nodes.T.total.moved, 3)
  assert.equal(result.nodes['T.group'].own.moved, 1)
  assert.equal(result.nodes['T.group'].total.moved, 3)
  assert.equal(result.nodes['T.group.child'].own.moved, 1)
  assert.equal(result.nodes['T.group.child'].total.moved, 2)
  assert.equal(result.nodes['T.group.child.leaf'].total.moved, 1)
  assert.equal(result.nodes['T.group.child'].from, 'R.group.child')
  assert.equal(result.nodes.R, undefined)
  assert.deepEqual(result.unplaced, [])
})

test('removed children of a moved group attach to that group at its new path', () => {
  const before = modelIds('R', 'T', 'R.group', 'R.group.keep', 'R.group.deleted', 'R.group.deleted.leaf')
  const after = modelIds('R', 'T', 'T.group', 'T.group.keep')
  const result = project(before, after)
  assert.equal(result.nodes['T.group'].from, 'R.group')
  assert.deepEqual(result.nodes['T.group'].own, counts({ moved: 1, removed: 2 }))
  assert.deepEqual(result.nodes['T.group'].total, counts({ moved: 2, removed: 2 }))
  assert.deepEqual(result.nodes.T.total, counts({ moved: 2, removed: 2 }))
  assert.deepEqual(
    result.nodes['T.group'].removedElements.map((item) => item.id),
    ['R.group.deleted', 'R.group.deleted.leaf'],
  )
  assert.deepEqual(result.unplaced, [])
  assert.equal(result.nodes.R, undefined)
})

test('relation-only changes are exposed without inventing node changes', () => {
  const elements = ['a', 'b', 'c'].map((id) => element(id))
  const before = modelOf(elements, [relation('old', 'a', 'b', 'old label'), relation('removed', 'b', 'c', 'delete')])
  const after = modelOf(elements, [relation('new', 'a', 'b', 'new label', { kind: 'async' }), relation('added', 'a', 'c', 'add')])
  const diff = diffModels(before, after)
  const result = projectChanges(diff, after)
  assert.deepEqual(result.nodes, {})
  assert.deepEqual(result.counts, { ...counts(), relations: relationCounts({ added: 1, changed: 1, removed: 1 }) })
  assert.deepEqual(result.relations, diff.relations)
  assert.equal(result.relations.changed[0].id, 'new')
  assert.equal(result.relations.changed[0].before.id, 'old')
  assert.deepEqual(result.relations.changed[0].fields, ['title', 'kind'])
})

test('parallel added links retain separate ids while duplicate diff entries count once', () => {
  const diff = {
    elements: {
      added: [element('R.new'), element('R.new')],
      changed: [
        { id: 'R.new', fields: ['state', 'state'] },
        { id: 'R.new', fields: ['state'] },
      ],
      moved: [
        { from: 'Old.new', to: 'R.new' },
        { from: 'Old.new', to: 'R.new' },
      ],
      removed: [element('R.old'), element('R.old')],
    },
    relations: {
      added: [relation('one', 'R', 'R.new', 'calls'), relation('one', 'R', 'R.new', 'calls'), relation('two', 'R', 'R.new', 'calls')],
    },
  }
  const result = projectChanges(diff, modelIds('R', 'R.new'))
  assert.deepEqual(result.nodes.R.total, counts({ added: 1, changed: 1, moved: 1, removed: 1 }))
  assert.deepEqual(result.nodes['R.new'].fields, ['state'])
  assert.deepEqual(result.counts, { ...counts({ added: 1, changed: 1, moved: 1, removed: 1 }), relations: relationCounts({ added: 2 }) })
})

test('unknown current ids keep global counts but cannot create synthetic nodes', () => {
  const diff = {
    elements: { added: [element('R.absent')], changed: [{ id: 'R.unknown', fields: ['state'] }], moved: [{ from: 'Old.x', to: 'R.x' }] },
  }
  const result = projectChanges(diff, modelIds('R'))
  assert.deepEqual(result.nodes, {})
  assert.deepEqual(result.counts, { ...counts({ added: 1, changed: 1, moved: 1 }), relations: relationCounts() })
  assert.deepEqual(projectChanges(diff).nodes, {})
})

test('absent model leaves removals unplaced and does not throw', () => {
  const diff = { elements: { removed: [element('R.child'), element('R')] } }
  const result = projectChanges(diff)
  assert.deepEqual(result.nodes, {})
  assert.equal(result.counts.removed, 2)
  assert.deepEqual(
    result.unplaced.map((item) => item.id),
    ['R', 'R.child'],
  )
})

test('removed ancestry uses FQN boundaries, not string prefixes or stale child arrays', () => {
  const diff = { elements: { removed: [element('Bee.child'), element('B.deleted.deep')] } }
  const model = modelOf([element('B', { children: ['Bee.child'], parent: 'Unrelated' })])
  const result = projectChanges(diff, model)
  assert.deepEqual(Object.keys(result.nodes), ['B'])
  assert.equal(result.nodes.B.total.removed, 1)
  assert.deepEqual(
    result.unplaced.map((item) => item.id),
    ['Bee.child'],
  )
})

test('malformed entries and unknown categories are ignored safely', () => {
  assert.deepEqual(
    projectChanges(
      {
        elements: { added: [null, {}, { id: 42 }], changed: 'not an array', moved: [null, { from: 'R' }], removed: [] },
        relations: { added: [undefined], changed: {}, other: [relation('x', 'a', 'b', 'unknown')] },
      },
      modelIds('R'),
    ),
    empty,
  )
  const result = projectChanges({ elements: { changed: [{ id: 'R', fields: null }] } }, modelIds('R'))
  assert.deepEqual(result.nodes.R.fields, [])
})

test('prototype-looking ids remain safe own properties in ordinary result maps', () => {
  const diff = { elements: { added: [element('constructor')], removed: [element('__proto__.old'), element('toString.old')] } }
  const model = modelIds('__proto__', 'constructor')
  const result = projectChanges(diff, model)
  assert.equal(Object.getPrototypeOf(result.nodes), Object.prototype)
  assert.equal(Object.hasOwn(result.nodes, '__proto__'), true)
  assert.equal(result.nodes.__proto__.own.removed, 1)
  assert.equal(result.nodes.constructor.own.added, 1)
  assert.deepEqual(
    result.unplaced.map((item) => item.id),
    ['toString.old'],
  )
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
})

test('projection ordering is deterministic for reordered diff arrays and model keys', () => {
  const diff = {
    elements: {
      added: [element('R.z'), element('R.a')],
      changed: [{ id: 'R', fields: ['technology', 'state', 'state'] }],
      removed: [element('R.zOld'), element('Missing'), element('R.aOld')],
    },
    relations: { added: [relation('z', 'R', 'R.z', 'calls'), relation('a', 'R', 'R.a', 'calls')] },
  }
  const reversed = {
    elements: Object.fromEntries(Object.entries(diff.elements).map(([key, items]) => [key, [...items].reverse()])),
    relations: { added: [...diff.relations.added].reverse() },
  }
  const first = projectChanges(diff, modelIds('R', 'R.z', 'R.a'))
  const second = projectChanges(reversed, modelIds('R.a', 'R.z', 'R'))
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.deepEqual(Object.keys(first.nodes), ['R', 'R.a', 'R.z'])
  assert.deepEqual(first.nodes.R.fields, ['state', 'technology'])
  assert.deepEqual(
    first.nodes.R.removedElements.map((item) => item.id),
    ['R.aOld', 'R.zOld'],
  )
})

test('frozen diff and model inputs are untouched and output data is independent', () => {
  const removed = element('R.old', { metadata: { why: 'Replaced' }, marks: ['removed'] })
  const before = modelOf(
    [element('R'), removed, element('R.api')],
    [relation('oldLink', 'R', 'R.api', 'old', { metadata: { proof: 'Before' } })],
  )
  const after = freeze(
    modelOf(
      [element('R'), element('R.api', { state: 'done' })],
      [relation('newLink', 'R', 'R.api', 'new', { metadata: { proof: 'After' } })],
    ),
  )
  const diff = freeze(diffModels(before, after))
  const snapshot = structuredClone({ diff, after })
  const result = projectChanges(diff, after)
  assert.deepEqual({ diff, after }, snapshot)
  result.nodes.R.removedElements[0].metadata.why = 'Edited output'
  result.removed[0].marks.push('new')
  result.relations.changed[0].before.metadata.proof = 'Edited output'
  result.relations.changed[0].after.metadata.proof = 'Edited output'
  result.relations.changed[0].fields.push('invented')
  result.nodes['R.api'].fields.push('invented')
  assert.deepEqual({ diff, after }, snapshot)
  const fresh = projectChanges(diff, after)
  assert.equal(fresh.nodes.R.removedElements[0].metadata.why, 'Replaced')
  assert.deepEqual(fresh.removed[0].marks, ['removed'])
  assert.equal(fresh.relations.changed[0].after.metadata.proof, 'After')
  assert.deepEqual(fresh.nodes['R.api'].fields, ['state'])
})
