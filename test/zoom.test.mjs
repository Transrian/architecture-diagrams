// Pure semantic-zoom maths, exercised on the same invented reference as the UI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compute } from '../lib/likec4.mjs'
import { buildTree, pathOf, geom, phi, phiInv, parentCam, childCam, frac, fitLocal, zoomPath } from '../src/zoom.js'

const result = await compute(await readFile(new URL('../examples/reference.c4', import.meta.url), 'utf8'))
const sizes = [{ w: 1300, h: 900 }, { w: 600, h: 800 }, { w: 1920, h: 700 }]
const close = (a, b, label) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${label}: ${a} ≈ ${b}`)
const vectorClose = (a, b) => a.forEach((value, i) => close(value, b[i], `coordinate ${i}`))

test('zoom tree has complete parent chains starting at index', () => {
  const tree = buildTree(result, 'index')
  assert.ok(tree.entries.size > 10)
  assert.equal(tree.root.parent, null)
  for (const [id, entry] of tree.entries) {
    if (entry.parent) assert.ok(tree.entries.has(entry.parent), `parent of ${id}`)
    const path = pathOf(tree, id)
    assert.equal(path[0], 'index')
    assert.equal(path.at(-1), id)
  }
})

test('opening curve and camera transforms are invertible in all three regimes', () => {
  for (const size of sizes) {
    const tree = buildTree(result, 'index')
    for (const [id, entry] of tree.entries) {
      if (!entry.parent) continue
      const g = geom(tree, id, size)
      const values = [g.b0 * 0.1, g.b0 * 0.99, g.b0, (g.b0 + g.bc) / 2, g.bc, g.bc * 3]
      for (const b of values) {
        close(phiInv(g, phi(g, b)), b, `${id} curve`)
        const T = { s: b / frac(1, g.N, size), tx: -237.5, ty: 641.3 }
        const back = parentCam(g, childCam(g, T, size), size)
        for (const key of ['s', 'tx', 'ty']) close(back[key], T[key], `${id} ${key}`)
      }
    }
  }
})

test('zoom paths retain exact endpoints, including same-centre zooms', () => {
  for (const [a, b] of [
    [[0, 0, 100], [300, -50, 800]],
    [[-60, 70, 900], [-60, 70, 100]],
    [[5, 6, 100], [5, 6, 100]],
    [[5, 6, 100], [5 + 1e-8, 6 - 1e-8, 500]],
  ]) {
    const path = zoomPath(a, b)
    vectorClose(path(0), a)
    vectorClose(path(1), b)
    assert.ok(Number.isFinite(path.duration))
    for (const p of [0, 0.25, 0.5, 0.75, 1]) assert.ok(path(p).every(Number.isFinite) && path(p)[2] > 0)
  }
})

test('fitLocal keeps its framed bounds inside the viewport padding', () => {
  for (const size of sizes) {
    const tree = buildTree(result, 'index')
    for (const entry of tree.entries.values()) {
      const T = fitLocal(entry, size)
      // A nested frame may be deliberately enlarged to 56% to keep it readable.
      // Its own frame, rather than off-branch neighbours, is the fitting contract.
      const b = entry.frame ?? entry.view.bounds
      assert.ok(b.width * T.s <= size.w - 48 + 1e-6, entry.id + ' width')
      assert.ok(b.height * T.s <= size.h - 48 + 1e-6, entry.id + ' height')
      assert.ok(T.s * b.x + T.tx >= 24 - 1e-6, entry.id + ' left')
      assert.ok(T.s * b.y + T.ty >= 24 - 1e-6, entry.id + ' top')
    }
  }
})
