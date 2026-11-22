// Pure semantic-zoom maths, exercised on the same invented reference as the UI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compute } from '../lib/likec4.mjs'
import { buildTree, pathOf, geom, phi, phiInv, parentCam, childCam, frac, fitLocal, fitView, revealCam, avoidRect, FIT_MARGIN, zoomPath, onOpening, settle, blendOf, resizeCam, isGroup } from '../src/zoom.js'

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

test('a released group folds continuously back into its box', () => {
  for (const size of sizes) {
    const tree = buildTree(result, 'index')
    for (const [id, entry] of tree.entries) {
      if (!entry.parent) continue
      const g = geom(tree, id, size)
      const T = { s: ((g.b0 + g.bc) / 2) / frac(1, g.N, size), tx: 12, ty: -40 }
      const open = childCam(g, T, size)
      const same = childCam(g, T, size, 1)
      for (const key of ['s', 'tx', 'ty', 'u']) close(same[key], open[key], `${id} blend 1 ${key}`)
      const shut = childCam(g, T, size, 0)
      assert.equal(shut.u, 0, `${id} closed`)
      // Closed: the group's view sits in its box, centred on it.
      close(frac(shut.s, g.F, size), g.rho * frac(T.s, g.N, size), `${id} fitted`)
      close(shut.s * (g.F.x + g.F.width / 2) + shut.tx, T.s * (g.N.x + g.N.width / 2) + T.tx, `${id} centred`)
    }
  }
})

test('only points on the opening group count as zooming into it', () => {
  const size = sizes[0]
  const tree = buildTree(result, 'index')
  const [id, entry] = [...tree.entries].find(([, e]) => e.parent)
  const g = geom(tree, id, size)
  const S = { tree, size, cand: id, focus: entry.parent, cam: { s: (g.b0 * 1.05) / frac(1, g.N, size), tx: 0, ty: 0 } }
  const box = [S.cam.s * (g.N.x + g.N.width / 2) + S.cam.tx, S.cam.s * (g.N.y + g.N.height / 2) + S.cam.ty]
  assert.ok(onOpening(S, box))
  assert.ok(!onOpening(S, [S.cam.s * (g.N.x + g.N.width) + S.cam.tx + 50, box[1]]))
  assert.ok(!onOpening({ ...S, cand: null }, box))
})

test('a group picked already open arrives instead of being entered at once', () => {
  const size = sizes[0]
  const tree = buildTree(result, 'index')
  const [id, entry] = [...tree.entries].find(([, e]) => e.parent === 'index')
  const g = geom(tree, id, size)
  // Zoomed well past the point where the group is entered, pointer on its box.
  const s = (g.bc * 1.2) / frac(1, g.N, size)
  const cam = { s, tx: size.w / 2 - s * (g.N.x + g.N.width / 2), ty: size.h / 2 - s * (g.N.y + g.N.height / 2) }
  const S = { tree, size, focus: entry.parent, cand: null, cam, anchor: [size.w / 2, size.h / 2] }
  settle(S)
  assert.equal(S.focus, entry.parent, 'not entered while arriving')
  assert.equal(S.cand, id)
  assert.deepEqual({ ...S.arriving }, { id, blend: 0, fresh: true })
  assert.equal(blendOf(S, id), 0)
  // Once its drawing has caught up, the next settle enters it.
  S.arriving = null
  settle(S)
  assert.equal(S.focus, id)
  // A group released beside the pointer is not picked again right away.
  const R = { tree, size, focus: entry.parent, cand: null, cam, anchor: [size.w / 2, size.h / 2], leaving: { id, blend: 1 } }
  settle(R)
  assert.equal(R.cand, null)
  assert.equal(R.focus, entry.parent)
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

test('a stage resize refits a fitted view and keeps the centre point of any other camera', () => {
  const tree = buildTree(result, 'index')
  const centre = (cam, size) => [(size.w / 2 - cam.tx) / cam.s, (size.h / 2 - cam.ty) / cam.s]
  for (const [id] of tree.entries) {
    for (const [before, after] of [[sizes[0], { w: 1300, h: 780 }], [sizes[1], { w: 420, h: 800 }], [sizes[2], sizes[0]]]) {
      const fit = fitView(tree, id, before)
      const fitted = resizeCam(tree, id, fit, before, after, true)
      for (const key of ['s', 'tx', 'ty']) close(fitted[key], fitView(tree, id, after)[key], `${id} refit ${key}`)
      // Opening then closing a panel restores the very same picture.
      const back = resizeCam(tree, id, fitted, after, before, true)
      for (const key of ['s', 'tx', 'ty']) close(back[key], fit[key], `${id} restored ${key}`)
      const zoomed = { s: fit.s * 1.7, tx: 40, ty: -25 }
      const kept = resizeCam(tree, id, zoomed, before, after, false)
      close(kept.s, zoomed.s, `${id} scale`)
      vectorClose(centre(kept, after), centre(zoomed, before))
      const restored = resizeCam(tree, id, kept, after, before, false)
      for (const key of ['s', 'tx', 'ty']) close(restored[key], zoomed[key], `${id} kept restored ${key}`)
    }
  }
})

const screen = (T, r) => ({ l: T.s * r.x + T.tx, t: T.s * r.y + T.ty, r: T.s * (r.x + r.width) + T.tx, b: T.s * (r.y + r.height) + T.ty })

test('the user-facing fit shows every box and never leaves the current view', () => {
  let floors = 0
  for (const size of [...sizes, { w: 420, h: 800 }, { w: 560, h: 780 }]) {
    const tree = buildTree(result, 'index')
    for (const [id, entry] of tree.entries) {
      const T = fitView(tree, id, size)
      const inside = entry.view.nodes.every((node) => {
        const r = screen(T, node)
        return r.l >= -1e-6 && r.t >= -1e-6 && r.r <= size.w + 1e-6 && r.b <= size.h + 1e-6
      })
      if (!inside) floors++
      if (entry.parent) {
        const g = geom(tree, id, size)
        assert.ok(frac(T.s, entry.frame, size) >= g.fc * FIT_MARGIN * (1 - 1e-9), `${id} frame stays clear of leaving`)
      }
      // At the fit, and one wheel notch out or in (anywhere), the camera stays in this view.
      for (const factor of [1, Math.exp(-120 * 0.0015), Math.exp(120 * 0.0015)]) {
        const anchors = [[size.w / 2, size.h / 2], ...entry.view.nodes.filter((n) => entry.kids.has(n.id)).map((n) => [T.s * (n.x + n.width / 2) + T.tx, T.s * (n.y + n.height / 2) + T.ty])]
        for (const [px, py] of anchors) {
          const cam = { s: T.s * factor, tx: px - (px - T.tx) * factor, ty: py - (py - T.ty) * factor }
          const S = { tree, size, focus: id, cand: null, cam, anchor: [px, py] }
          settle(S)
          assert.equal(S.focus, id, `${id} at ${size.w}x${size.h}, factor ${factor.toFixed(3)}`)
        }
      }
    }
  }
  // Only a frame tiny among far neighbours may keep the floor; none in the reference at these sizes.
  assert.equal(floors, 0, 'every box inside the stage at the fit')
})

test('a reveal frames the element at the view fit, never closer, and keeps it in view', () => {
  for (const size of sizes) {
    const tree = buildTree(result, 'index')
    for (const [id, entry] of tree.entries) {
      const fit = fitView(tree, id, size)
      for (const node of entry.view.nodes) {
        if (isGroup(node) && node.id === entry.frame?.id) continue
        const T = revealCam(tree, id, node, size)
        assert.ok(T.s <= fit.s + 1e-9, `${id} ${node.id} scale`)
        const r = screen(T, node)
        assert.ok(r.l >= -1e-6 && r.t >= -1e-6 && r.r <= size.w + 1e-6 && r.b <= size.h + 1e-6, `${id} ${node.id} visible`)
      }
    }
  }
})

test('avoidRect pans the smallest way clear of a panel, or not at all', () => {
  const size = { w: 1300, h: 900 }
  const panel = { l: 930, t: 700, r: 1290, b: 890 }
  assert.equal(avoidRect({ l: 100, t: 100, r: 300, b: 200 }, panel, size), null, 'no overlap')
  assert.deepEqual(avoidRect({ l: 900, t: 760, r: 1100, b: 860 }, panel, size), { dx: 0, dy: -172 })
  assert.deepEqual(avoidRect({ l: 880, t: 600, r: 960, b: 720 }, panel, size), { dx: 0, dy: -32 })
  assert.equal(avoidRect({ l: 0, t: 0, r: 1300, b: 900 }, panel, size), null, 'a box larger than the room is left alone')
  const sheet = { l: 0, t: 500, r: 420, b: 800 }
  assert.deepEqual(avoidRect({ l: 100, t: 450, r: 300, b: 600 }, sheet, { w: 420, h: 800 }), { dx: 0, dy: -112 })
})
