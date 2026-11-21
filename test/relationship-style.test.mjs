import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relationStyle, viewLegend } from '../src/theme.js'

test('relationship meaning has distinct non-colour channels and mixed remains neutral', () => {
  assert.deepEqual(relationStyle(), { pattern: undefined, width: 2.5, head: 'full' })
  assert.deepEqual(relationStyle('async'), { pattern: '16 8', width: 2.5, head: 'open' })
  assert.deepEqual(relationStyle('data'), { pattern: undefined, width: 4, head: 'double' })
  assert.deepEqual(relationStyle('mixed'), relationStyle())
})

test('local legend contains only states and kinds drawn in the current view in vocabulary order', () => {
  assert.deepEqual(viewLegend(), { states: [], kinds: [] })
  const view = {
    nodes: [{ state: 'done' }, { rollup: { state: 'planned' } }, { state: 'frozen' }],
    edges: [{ state: 'blocked', kind: 'data' }, { kind: 'async' }, { kind: 'mixed' }, {}, { kind: 'data' }],
  }
  assert.deepEqual(viewLegend(view), { states: ['blocked', 'planned', 'done', 'frozen'], kinds: ['call', 'async', 'data', 'mixed'] })
  assert.deepEqual(viewLegend({ nodes: [{ state: 'done' }], edges: [] }), { states: ['done'], kinds: [] })
})
