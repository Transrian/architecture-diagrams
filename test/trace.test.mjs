import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trace, projectTrace } from '../src/trace.js'

// Invented detailed summaries, with hierarchy present to catch accidental walks.
function modelOf(ids, links = []) {
  const elements = Object.fromEntries(ids.map((id) => [id, {
    id,
    parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null,
    children: [],
  }]))
  for (const element of Object.values(elements)) {
    if (element.parent && Object.hasOwn(elements, element.parent)) elements[element.parent].children.push(element.id)
  }
  const relations = Object.fromEntries(links.map(([id, source, target]) => [id, { id, source, target }]))
  return { elements, relations, order: ids }
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const empty = { elements: {}, relations: {} }

test('neighbours is exactly one hop in both directions and is the default', () => {
  const model = modelOf(['x', 'a', 'b', 'c', 'z'], [
    ['xa', 'x', 'a'], ['ab', 'a', 'b'], ['bc', 'b', 'c'],
  ])
  const expected = { elements: { a: 0, b: 1, x: 1 }, relations: { ab: 1, xa: 1 } }
  assert.deepEqual(trace(model, 'a', 'neighbours'), expected)
  assert.deepEqual(trace(model, 'a'), expected)
  assert.deepEqual(trace(model, 'z'), { elements: { z: 0 }, relations: {} })
})

test('downstream and upstream follow only their directed detailed relations', () => {
  const model = modelOf(['x', 'a', 'b', 'c', 'z'], [
    ['xa', 'x', 'a'], ['ab', 'a', 'b'], ['bc', 'b', 'c'], ['zb', 'z', 'b'],
  ])
  assert.deepEqual(trace(model, 'a', 'downstream'), {
    elements: { a: 0, b: 1, c: 2 }, relations: { ab: 1, bc: 2 },
  })
  assert.deepEqual(trace(model, 'b', 'upstream'), {
    elements: { a: 1, b: 0, x: 2, z: 1 }, relations: { ab: 1, xa: 2, zb: 1 },
  })
})

test('breadth-first depths use shortest paths and retain non-tree relation depths', () => {
  const model = modelOf(['a', 'b', 'c', 'd', 'e'], [
    ['ab', 'a', 'b'], ['bc', 'b', 'c'], ['cd', 'c', 'd'],
    ['ad', 'a', 'd'], ['de', 'd', 'e'], ['ce', 'c', 'e'],
  ])
  assert.deepEqual(trace(model, 'a', 'downstream'), {
    elements: { a: 0, b: 1, c: 2, d: 1, e: 2 },
    relations: { ab: 1, ad: 1, bc: 2, cd: 3, ce: 3, de: 2 },
  })
  assert.deepEqual(trace(model, 'e', 'upstream'), {
    elements: { a: 2, b: 2, c: 1, d: 1, e: 0 },
    relations: { ab: 3, ad: 2, bc: 2, cd: 2, ce: 1, de: 1 },
  })
})

test('cycles terminate, preserve the seed depth and retain cycle and self links', () => {
  const model = modelOf(['a', 'b', 'c'], [
    ['ab', 'a', 'b'], ['bc', 'b', 'c'], ['ca', 'c', 'a'], ['aa', 'a', 'a'],
  ])
  assert.deepEqual(trace(model, 'a', 'downstream'), {
    elements: { a: 0, b: 1, c: 2 }, relations: { aa: 1, ab: 1, bc: 2, ca: 3 },
  })
  assert.deepEqual(trace(model, 'a', 'upstream'), {
    elements: { a: 0, b: 2, c: 1 }, relations: { aa: 1, ab: 3, bc: 2, ca: 1 },
  })
  assert.deepEqual(trace(model, 'a', 'neighbours'), {
    elements: { a: 0, b: 1, c: 1 }, relations: { aa: 1, ab: 1, ca: 1 },
  })
})

test('parallel and reciprocal relations keep their individual ids and depths', () => {
  const model = modelOf(['a', 'b'], [
    ['ab1', 'a', 'b'], ['ab2', 'a', 'b'], ['ba', 'b', 'a'],
  ])
  assert.deepEqual(trace(model, 'a', 'downstream'), {
    elements: { a: 0, b: 1 }, relations: { ab1: 1, ab2: 1, ba: 2 },
  })
  assert.deepEqual(trace(model, 'a', 'neighbours'), {
    elements: { a: 0, b: 1 }, relations: { ab1: 1, ab2: 1, ba: 1 },
  })
})

test('group-attached links neither descend to children nor ascend from children', () => {
  const model = modelOf(['a', 'B', 'B.b1', 'B.b2', 'c', 'd'], [
    ['enter', 'a', 'B'], ['exit', 'B', 'c'],
    ['inside', 'B.b1', 'B.b2'], ['childExit', 'B.b2', 'd'],
  ])
  assert.deepEqual(trace(model, 'a', 'downstream'), {
    elements: { B: 1, a: 0, c: 2 }, relations: { enter: 1, exit: 2 },
  })
  assert.deepEqual(trace(model, 'c', 'upstream'), {
    elements: { B: 1, a: 2, c: 0 }, relations: { enter: 2, exit: 1 },
  })
  assert.deepEqual(trace(model, 'B.b1', 'downstream'), {
    elements: { 'B.b1': 0, 'B.b2': 1, d: 2 }, relations: { childExit: 2, inside: 1 },
  })
  assert.deepEqual(trace(model, 'B.b2', 'upstream'), {
    elements: { 'B.b1': 1, 'B.b2': 0 }, relations: { inside: 1 },
  })
  assert.deepEqual(trace(model, 'B', 'neighbours'), {
    elements: { B: 0, a: 1, c: 1 }, relations: { enter: 1, exit: 1 },
  })
})

test('counterexample: a → B.b1 and B.b2 → c does not imply a path a → c', () => {
  const model = modelOf(['a', 'B', 'B.b1', 'B.b2', 'c'], [
    ['first', 'a', 'B.b1'], ['second', 'B.b2', 'c'],
  ])
  // A view looks connected after aggregation, but must never drive traversal.
  model.views = [{ nodes: [{ id: 'a' }, { id: 'B' }, { id: 'c' }], edges: [
    { id: 'aB', source: 'a', target: 'B', relations: ['first'] },
    { id: 'Bc', source: 'B', target: 'c', relations: ['second'] },
  ] }]
  const result = trace(model, 'a', 'downstream')
  assert.deepEqual(result, { elements: { a: 0, 'B.b1': 1 }, relations: { first: 1 } })
  assert.deepEqual(trace(model, 'c', 'upstream'), {
    elements: { 'B.b2': 1, c: 0 }, relations: { second: 1 },
  })
  assert.deepEqual(projectTrace(result, model.views[0]), {
    nodes: { B: 1, a: 0 }, edges: { aB: 1 }, hidden: ['B.b1'],
  })
})

test('only an explicit detailed link can bridge the two children of a group', () => {
  const model = modelOf(['a', 'B', 'B.b1', 'B.b2', 'c'], [
    ['first', 'a', 'B.b1'], ['bridge', 'B.b1', 'B.b2'], ['second', 'B.b2', 'c'],
  ])
  assert.deepEqual(trace(model, 'a', 'downstream'), {
    elements: { a: 0, 'B.b1': 1, 'B.b2': 2, c: 3 },
    relations: { bridge: 2, first: 1, second: 3 },
  })
})

test('missing ids and absent models return empty maps, without phantom vertices', () => {
  for (const model of [undefined, null, {}, { elements: {} }, modelOf(['a'])]) {
    for (const id of ['missing', undefined, null, 'toString']) assert.deepEqual(trace(model, id), empty)
  }
  assert.deepEqual(trace({ elements: { a: {} } }, 'a'), { elements: { a: 0 }, relations: {} })
})

test('dangling or malformed relations are ignored even when they touch the seed', () => {
  const model = modelOf(['a', 'b'], [
    ['good', 'a', 'b'], ['missingTarget', 'a', 'missing'],
    ['missingSource', 'missing', 'a'], ['inherited', 'a', 'toString'],
  ])
  model.relations.nullLink = null
  model.relations.noEnds = {}
  model.relations.partial = { source: 'a' }
  for (const mode of ['downstream', 'neighbours']) {
    assert.deepEqual(trace(model, 'a', mode), { elements: { a: 0, b: 1 }, relations: { good: 1 } })
  }
})

test('unknown modes throw rather than silently choosing a direction', () => {
  for (const mode of ['both', '', null, 0]) assert.throws(() => trace({}, 'missing', mode), RangeError)
})

test('dictionary keys identify records, not optional embedded ids', () => {
  const model = { elements: { a: { id: 'wrong' }, b: {} }, relations: { ab: { id: 'wrong', source: 'a', target: 'b' } } }
  assert.deepEqual(trace(model, 'a', 'downstream'), {
    elements: { a: 0, b: 1 }, relations: { ab: 1 },
  })
})

test('result ordering is deterministic despite model insertion order', () => {
  const model = modelOf(['z', 'a', 'm'], [['zLink', 'z', 'm'], ['aLink', 'z', 'a']])
  const reversed = {
    elements: Object.fromEntries(Object.entries(model.elements).reverse()),
    relations: Object.fromEntries(Object.entries(model.relations).reverse()),
  }
  const result = trace(model, 'z', 'downstream')
  assert.equal(JSON.stringify(result), JSON.stringify(trace(reversed, 'z', 'downstream')))
  assert.deepEqual(Object.keys(result.elements), ['a', 'm', 'z'])
  assert.deepEqual(Object.keys(result.relations), ['aLink', 'zLink'])
  assert.equal(Object.getPrototypeOf(result.elements), Object.prototype)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
})

test('prototype-looking ids are safe own keys in ordinary output maps', () => {
  const model = modelOf(['__proto__', 'constructor', 'toString'], [
    ['__proto__', 'constructor', '__proto__'], ['toString', '__proto__', 'toString'],
  ])
  const result = trace(model, 'constructor', 'downstream')
  assert.equal(Object.getPrototypeOf(result.elements), Object.prototype)
  assert.equal(Object.getPrototypeOf(result.relations), Object.prototype)
  assert.equal(Object.hasOwn(result.elements, '__proto__'), true)
  assert.equal(result.elements.__proto__, 1)
  assert.equal(result.elements.constructor, 0)
  assert.equal(result.elements.toString, 2)
  assert.equal(result.relations.__proto__, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
})

test('long cycles use an iterative traversal rather than recursive call depth', () => {
  const ids = Array.from({ length: 3000 }, (_, i) => `n${i}`)
  const links = ids.map((id, i) => [`r${i}`, id, ids[(i + 1) % ids.length]])
  const result = trace(modelOf(ids, links), 'n0', 'downstream')
  assert.equal(Object.keys(result.elements).length, ids.length)
  assert.equal(Object.keys(result.relations).length, ids.length)
  assert.equal(result.elements.n2999, 2999)
  assert.equal(result.relations.r2999, 3000)
  assert.equal(result.elements.n0, 0)
})

test('projection highlights exact nodes and FQN containers at minimum depth', () => {
  const result = { elements: { 'B.b1': 3, 'B.b1.deep': 1, 'B.b2': 2, 'Bee.x': 4, outside: 5 }, relations: {} }
  const view = { nodes: [{ id: 'B' }, { id: 'B.b1' }, { id: 'Bee' }, { id: 'unrelated' }], edges: [] }
  assert.deepEqual(projectTrace(result, view), {
    nodes: { B: 1, 'B.b1': 1, Bee: 4 }, edges: {}, hidden: ['B.b1.deep', 'B.b2', 'Bee.x', 'outside'],
  })
  assert.deepEqual(projectTrace({ elements: { B: 0 }, relations: {} }, view), {
    nodes: { B: 0 }, edges: {}, hidden: [],
  }, 'a reached group does not make its own children reached')
})

test('projection respects dot boundaries rather than arbitrary id prefixes', () => {
  assert.deepEqual(projectTrace({ elements: { 'BB.x': 1, 'B.other': 2 }, relations: {} }, {
    nodes: [{ id: 'B' }, { id: 'B.o' }, { id: 'BB' }],
  }), { nodes: { B: 2, BB: 1 }, edges: {}, hidden: ['B.other', 'BB.x'] })
})

test('projection maps aggregated edges only by original relation ids', () => {
  const result = { elements: { a: 0, b: 1 }, relations: { first: 3, second: 1 } }
  const view = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [
    { id: 'merged', source: 'a', target: 'b', relations: ['absent', 'first', 'second'] },
    { id: 'endpointsOnly', source: 'a', target: 'b' },
    { id: 'unreached', source: 'a', target: 'b', relations: ['absent'] },
  ] }
  assert.deepEqual(projectTrace(result, view), {
    nodes: { a: 0, b: 1 }, edges: { merged: 1 }, hidden: [],
  })
})

test('projection handles absent views, empty traces and missing edge relation ids', () => {
  assert.deepEqual(projectTrace(), { nodes: {}, edges: {}, hidden: [] })
  assert.deepEqual(projectTrace({ elements: { z: 1, a: 0 }, relations: {} }), {
    nodes: {}, edges: {}, hidden: ['a', 'z'],
  })
  assert.deepEqual(projectTrace(undefined, { nodes: [{ id: 'a' }], edges: [{ id: 'e', relations: ['toString'] }] }), {
    nodes: {}, edges: {}, hidden: [],
  })
})

test('tracing and projection neither mutate frozen inputs nor share mutable outputs', () => {
  const model = freeze(modelOf(['a', 'B', 'B.b'], [['ab', 'a', 'B.b']]))
  const before = JSON.stringify(model)
  const result = freeze(trace(model, 'a', 'downstream'))
  const view = freeze({ nodes: [{ id: 'a' }, { id: 'B' }], edges: [{ id: 'edge', relations: ['ab'] }] })
  const projection = projectTrace(result, view)
  assert.equal(JSON.stringify(model), before)
  assert.deepEqual(projection, { nodes: { B: 1, a: 0 }, edges: { edge: 1 }, hidden: ['B.b'] })
  projection.nodes.a = 99
  projection.hidden.push('invented')
  assert.deepEqual(projectTrace(result, view), { nodes: { B: 1, a: 0 }, edges: { edge: 1 }, hidden: ['B.b'] })
  const fresh = trace(model, 'a', 'downstream')
  fresh.elements.a = 99
  assert.equal(trace(model, 'a', 'downstream').elements.a, 0)
})
