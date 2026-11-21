import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wrap, edgePath, safeId, bySnapshotIndex, stepLabel } from '../src/shared.js'
import { groupByShard, iconsOf, shardOf } from '../src/iconrules.js'

test('dynamic step labels preserve concurrent stages and fall back for unknown ids', () => {
  assert.equal(stepLabel('step-02', 8), '2')
  assert.equal(stepLabel('step-02:par.01', 8), '2a')
  assert.equal(stepLabel('step-02:par.02', 9), '2b')
  assert.equal(stepLabel('step-10:par.26', 0), '10z')
  assert.equal(stepLabel('step-10:par.27', 0), '10aa')
  for (const id of ['unknown', undefined, 'step-00', 'step-01:par.00', 'step-02:other']) assert.equal(stepLabel(id, 3), '4')
})

test('titles wrap between Chinese characters, and Latin titles at spaces', () => {
  assert.deepEqual(wrap('Payment gateway and order service', 14, 2), ['Payment', 'gateway an…'])
  assert.deepEqual(wrap('订单服务和支付网关', 10, 2), ['订单服务和', '支付网关'])
  assert.deepEqual(wrap('使用React组件渲染', 10, 2), ['使用React', '组件渲染'])
  for (const line of wrap('订单服务，支付网关。数据库，缓存。', 6, 4)) assert.doesNotMatch(line, /^[，。]/, 'no line starts with closing punctuation')
})

test('edge paths handle empty points, cubic splines and trailing lines', () => {
  assert.equal(edgePath(), '')
  assert.equal(edgePath([]), '')
  assert.equal(edgePath([[1, 2]]), 'M1,2')
  assert.equal(edgePath([[1, 2], [3, 4], [5, 6], [7, 8]]), 'M1,2 C3,4 5,6 7,8')
  assert.equal(edgePath([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]]), 'M1,2 C3,4 5,6 7,8 L9,10 L11,12')
})

test('safe Session ids agree for all file consumers', () => {
  assert.equal(safeId('a/b'), 'a_b')
  assert.equal(safeId('r:1'), 'r_1')
  assert.equal(safeId('UUID-12_.34'), 'UUID-12_.34')
  assert.equal(safeId('é a\\b?#'), '__a_b__')
  assert.equal(safeId(42), '42')
})

test('snapshots sort by numeric index, then name', () => {
  assert.deepEqual(['10000-y.c4', '9999-x.c4'].sort(bySnapshotIndex), ['9999-x.c4', '10000-y.c4'])
  assert.deepEqual(['2-z.c4', '0002-a.c4', '1-x.c4'].sort(bySnapshotIndex), ['1-x.c4', '0002-a.c4', '2-z.c4'])
  assert.deepEqual(['h/10000-y.c4', 'h/9999-x.c4'].sort(bySnapshotIndex), ['h/9999-x.c4', 'h/10000-y.c4'])
})

test('icon collection prefers the whole model and shard grouping deduplicates', () => {
  const ids = iconsOf({ model: { icons: { a: { icon: 'tech:react' }, b: { icon: null }, c: { icon: 'tech:react' }, d: { icon: 'tech:redis' } } }, views: [{ nodes: [{ icon: 'not:used' }] }] })
  assert.deepEqual(ids, new Set(['tech:react', 'tech:redis']))
  assert.deepEqual(iconsOf({ views: [{ nodes: [{ icon: 'tech:react' }, {}, { icon: 'tech:react' }] }] }), new Set(['tech:react']))
  assert.deepEqual(iconsOf(), new Set())
  const groups = groupByShard([...ids, 'tech:react', null])
  assert.deepEqual(new Set([...groups.values()].flatMap((set) => [...set])), ids)
  for (const [n, set] of groups) for (const id of set) assert.equal(shardOf(id), n)
})
