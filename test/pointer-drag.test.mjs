import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addPointer, movePointer, removePointer } from '../src/viewer/pointer-drag.js'

const pointer = (pointerId, clientX, clientY, pointerType = 'touch') => ({ pointerId, clientX, clientY, pointerType })

test('pointer drag tracks the midpoint and distance, then rebases the remaining finger', () => {
  const drag = addPointer(null, pointer(1, 100, 200))
  addPointer(drag, pointer(2, 300, 200))
  assert.equal(addPointer(drag, pointer(3, 400, 200)), null, 'a third pointer cannot join the gesture')
  assert.deepEqual(movePointer(drag, pointer(2, 340, 200)), { x: 220, y: 200, distance: 240, dx: 20, dy: 0, ratio: 1.2 })
  assert.equal(movePointer(drag, pointer(999, 900, 900)), null)
  assert.equal(removePointer(drag, 999), false)
  assert.equal(drag.points.size, 2)
  assert.equal(removePointer(drag, 2), true)
  assert.deepEqual(movePointer(drag, pointer(1, 125, 215)), { x: 125, y: 215, distance: 0, dx: 25, dy: 15, ratio: 1 })
})

test('mouse drag ignores other pointers and accumulates motion up to its threshold', () => {
  const drag = addPointer(null, pointer(1, 100, 200, 'mouse'))
  assert.equal(addPointer(drag, pointer(2, 100, 200, 'mouse')), null)
  assert.equal(addPointer(drag, pointer(2, 100, 200)), null)
  assert.equal(movePointer(drag, pointer(2, 300, 400, 'mouse')), null)
  assert.equal(movePointer(drag, pointer(1, 101, 201, 'mouse')), null)
  assert.deepEqual(movePointer(drag, pointer(1, 103, 202, 'mouse')),
    { x: 103, y: 202, distance: 0, dx: 3, dy: 2, ratio: 1 })
})
