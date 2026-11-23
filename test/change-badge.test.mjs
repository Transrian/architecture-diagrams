import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeBadge } from '../src/viewer/changes.js'

test('neutral badges use subtree totals only for folded boxes, without double counting own', () => {
  const change = { own: { added: 0, changed: 1, moved: 0, removed: 1 }, total: { added: 2, changed: 3, moved: 1, removed: 4 } }
  const before = structuredClone(change)
  assert.equal(changeBadge({ hidden: 8 }, change), '+2 Δ3 ↷1 −4')
  assert.equal(changeBadge({ children: ['child'] }, change), 'Δ1 −1')
  assert.equal(changeBadge({}, change), 'Δ1 −1')
  assert.equal(changeBadge({ hidden: 2 }, null), '')
  assert.equal(changeBadge({}, { own: { added: 0, changed: 0, moved: 0, removed: 0 } }), '')
  assert.deepEqual(change, before)
})
