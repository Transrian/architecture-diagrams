import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFlight } from '../src/viewer/flight-plan.js'

function tree() {
  const parents = { root: null, left: 'root', leaf: 'left', right: 'root' }
  return { entries: new Map(Object.entries(parents).map(([id, parent]) => [id, { id, parent }])) }
}

const fit = (id) => ({ kind: 'fit', id })
const enter = (id) => ({ kind: 'enter', id })
const exit = (id) => ({ kind: 'exit', id })

test('planFlight fits the current view without changing scopes', () => {
  assert.deepEqual(planFlight(tree(), 'left', 'left'), [fit('left')])
})

test('planFlight exits each level to an ancestor', () => {
  assert.deepEqual(planFlight(tree(), 'leaf', 'root'), [exit('leaf'), exit('left'), fit('root')])
})

test('planFlight descends each level without a redundant ancestor fit', () => {
  assert.deepEqual(planFlight(tree(), 'root', 'leaf'), [enter('left'), enter('leaf'), fit('leaf')])
})

test('planFlight crosses siblings via their common ancestor', () => {
  assert.deepEqual(planFlight(tree(), 'leaf', 'right'), [
    exit('leaf'), exit('left'), fit('root'), enter('right'), fit('right'),
  ])
})

test('planFlight closes a different opening candidate before descent', () => {
  assert.deepEqual(planFlight(tree(), 'root', 'left', 'right'), [fit('root'), enter('left'), fit('left')])
  assert.deepEqual(planFlight(tree(), 'root', 'left', 'left'), [enter('left'), fit('left')])
})

test('planFlight ends with a reveal descriptor and never mutates the tree', () => {
  const input = tree()
  const before = structuredClone(input)
  assert.deepEqual(planFlight(input, 'left', 'left', null, 'atlas.worker'), [
    { kind: 'reveal', id: 'left', elementId: 'atlas.worker' },
  ])
  assert.deepEqual(input, before)
})
