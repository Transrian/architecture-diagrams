import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directionalNeighbour } from '../src/navigation.js'
import { STATE_GLYPH } from '../src/theme.js'
import { STATES } from '../src/vocab.js'

test('every state has a unique monochrome-safe glyph', () => {
  assert.deepEqual(Object.keys(STATE_GLYPH).sort(), [...STATES].sort())
  assert.equal(new Set(Object.values(STATE_GLYPH)).size, STATES.length)
  for (const glyph of Object.values(STATE_GLYPH)) assert.ok(glyph.length > 0)
})

const box = (id, x, y) => ({ id, x, y, width: 100, height: 50 })
test('directional keyboard focus follows spatial boxes, not model order', () => {
  const nodes = [box('origin', 0, 0), box('far', 400, 0), box('right', 150, 0), box('down', 0, 100), box('left', -150, 0), box('up', 0, -100)]
  assert.equal(directionalNeighbour(nodes, 'origin', 'ArrowRight'), 'right')
  assert.equal(directionalNeighbour(nodes, 'origin', 'ArrowDown'), 'down')
  assert.equal(directionalNeighbour(nodes, 'origin', 'ArrowLeft'), 'left')
  assert.equal(directionalNeighbour(nodes, 'origin', 'ArrowUp'), 'up')
  assert.equal(directionalNeighbour(nodes, 'left', 'ArrowLeft'), null)
  assert.equal(directionalNeighbour(nodes, 'missing', 'ArrowRight'), 'origin')
  assert.equal(directionalNeighbour([], null, 'ArrowRight'), null)
  assert.equal(directionalNeighbour(nodes, 'origin', 'Enter'), null)
})

test('spatial focus favours aligned boxes and breaks ties deterministically', () => {
  const nodes = [box('origin', 0, 0), box('diagonal', 20, 100), box('aligned', 150, 0)]
  assert.equal(directionalNeighbour(nodes, 'origin', 'ArrowRight'), 'aligned')
  assert.equal(directionalNeighbour([box('o', 0, 0), box('z', 100, 0), box('a', 100, 0)], 'o', 'ArrowRight'), 'a')
})
