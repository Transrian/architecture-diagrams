// Pure semantic-zoom maths, exercised on the same invented reference as the UI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compute } from '../skills/architecture-diagrams/assets/engine.mjs'
import { useActivation } from '../src/viewer/activation.js'
import { viewLegend } from '../src/viewer/theme.js'
import { buildTree, pathOf } from '../src/viewer/zoom-tree.js'
import {
  geom,
  phi,
  phiInv,
  parentCam,
  childCam,
  frac,
  fitLocal,
  fitView,
  revealCam,
  avoidRect,
  focusPan,
  FIT_MARGIN,
  FIT_PAD,
  FRAME_MIN,
  resizeCam,
  isGroup,
  wheelZoom,
} from '../src/viewer/zoom.js'
import { zoomPath } from '../src/viewer/zoom-path.js'
import { onOpening, settle, exitScope, blendOf } from '../src/viewer/zoom-scope.js'

const result = await compute(await readFile(new URL('../examples/reference.c4', import.meta.url), 'utf8'))
const sizes = [
  { w: 1300, h: 900 },
  { w: 600, h: 800 },
  { w: 1920, h: 700 },
]
// Full-HD and 1440p browser windows: the stage left below the header and legend.
const largeSizes = [
  { w: 1920, h: 948 },
  { w: 2560, h: 1300 },
]
const close = (a, b, label) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${label}: ${a} ≈ ${b}`)
const vectorClose = (a, b) => a.forEach((value, i) => close(value, b[i], `coordinate ${i}`))
const screen = (T, r) => ({ l: T.s * r.x + T.tx, t: T.s * r.y + T.ty, r: T.s * (r.x + r.width) + T.tx, b: T.s * (r.y + r.height) + T.ty })

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

const expandedScene = () => {
  const box = (id, x, parent, children = [], extra = {}) => ({ id, x, y: 80, width: 100, height: 100, parent, children, ...extra })
  const nodes = [
    box('atlas', 0, null, ['atlas.zone'], { width: 600, height: 300 }),
    box('atlas.zone', 120, 'atlas', ['atlas.zone.left', 'atlas.zone.right'], {
      width: 400,
      height: 240,
      expanded: true,
      unfold: true,
      drill: 'zone',
    }),
    box('atlas.zone.left', 150, 'atlas.zone'),
    box('atlas.zone.right', 380, 'atlas.zone'),
    box('caller', 0, null),
  ]
  const edges = [
    {
      id: 'incoming',
      source: 'caller',
      target: 'atlas.zone.right',
      points: [
        [100, 120],
        [240, 20],
        [380, 120],
      ],
      labelBBox: { x: 200, y: 10, width: 80, height: 24 },
      relations: ['request'],
    },
  ]
  const bounds = { x: 0, y: 0, width: 620, height: 400 }
  return {
    viewOfElement: { atlas: 'overview', 'atlas.zone': 'zone' },
    views: [
      { id: 'overview', generated: true, viewOf: 'atlas', bounds, nodes, edges },
      {
        id: 'zone',
        generated: true,
        viewOf: 'atlas.zone',
        bounds,
        nodes: [
          { ...nodes[1], parent: null, expanded: false, unfold: false, drill: undefined },
          { ...nodes[2], x: 380 },
          { ...nodes[3], x: 150 },
          nodes[4],
        ],
        edges: [
          {
            ...edges[0],
            points: [
              [100, 120],
              [150, 120],
            ],
          },
        ],
      },
    ],
  }
}

test('zoom into an unfolded group preserves displayed boxes and routed links', () => {
  const scene = expandedScene()
  const before = structuredClone(scene)
  const tree = buildTree(scene, 'overview')
  const child = tree.entries.get('zone')
  const parent = tree.root.view
  assert.ok(
    child.view.nodes.find((n) => n.id.endsWith('.left')).x < child.view.nodes.find((n) => n.id.endsWith('.right')).x,
    'visible siblings never exchange places',
  )
  for (const n of child.view.nodes) {
    const old = parent.nodes.find((a) => a.id === n.id)
    for (const key of ['x', 'y', 'width', 'height']) assert.equal(n[key], old[key], `${n.id} ${key}`)
  }
  assert.deepEqual(child.view.edges, parent.edges, 'routes, labels and relation provenance stay paired with the boxes')
  assert.notEqual(child.view.bounds, parent.bounds, 'bounds belong to the scoped scene, not its parent')
  assert.equal(child.view.viewOf, 'atlas.zone')
  assert.equal(child.frame.expanded, false)
  assert.equal(child.frame.unfold, false)
  assert.equal(child.frame.drill, undefined)
  assert.equal(child.frame.parent, null)
  assert.ok(!child.view.nodes.some((n) => n.id === 'atlas'), 'unconnected enclosing frames are not redrawn')
  assert.deepEqual(scene, before, 'cached engine layouts are never mutated')
  for (const size of sizes) {
    const g = geom(tree, child.id, size)
    const cam = fitView(tree, child.parent, size)
    const back = parentCam(g, childCam(g, cam, size), size)
    for (const key of ['s', 'tx', 'ty']) close(back[key], cam[key], key)
  }
})

test('a linked ancestor stays visible, with its endpoint and navigation intact', () => {
  const scene = expandedScene()
  scene.views[0].edges.push({
    id: 'whole',
    source: 'atlas.zone.left',
    target: 'atlas',
    points: [
      [0, 0],
      [10, 10],
    ],
    relations: ['manage'],
  })
  const child = buildTree(scene, 'overview').entries.get('zone')
  const ancestor = child.view.nodes.find((n) => n.id === 'atlas')
  assert.ok(ancestor)
  assert.equal(ancestor.drill, 'overview')
  for (const edge of child.view.edges) for (const id of [edge.source, edge.target]) assert.ok(child.view.nodes.some((n) => n.id === id))
})

test('collapsed groups, authored views and standalone flows keep their own layout', () => {
  for (const mode of ['collapsed', 'authored']) {
    const scene = expandedScene()
    if (mode === 'collapsed') Object.assign(scene.views[0].nodes[1], { children: [], expanded: false })
    else scene.views[1].generated = false
    const tree = buildTree(scene, 'overview')
    assert.equal(tree.entries.get('zone').view, scene.views[1], mode)
  }
  assert.equal(buildTree(expandedScene(), 'overview', true).entries.size, 1)
})

test('nested unfolded reference groups inherit their current context in either direction', async () => {
  const source = await readFile(new URL('../examples/reference.c4', import.meta.url), 'utf8')
  for (const direction of ['TopBottom', 'LeftRight']) {
    const expanded = await compute(source, { direction, expand: ['azure.prod', 'azure.prod.tracking', 'azure.prod.tracking.vnet'] })
    assert.deepEqual(expanded.errors, [])
    const snapshot = structuredClone(expanded.views)
    const tree = buildTree(expanded, 'index')
    let inherited = 0
    for (const entry of tree.entries.values()) {
      if (!entry.box?.expanded) continue
      inherited++
      const parent = tree.entries.get(entry.parent)
      for (const node of entry.view.nodes) {
        const old = parent.view.nodes.find((n) => n.id === node.id)
        for (const key of ['x', 'y', 'width', 'height']) assert.equal(node[key], old[key], `${direction} ${node.id} ${key}`)
      }
      const relevant = (id) => id === entry.frame.id || id.startsWith(entry.frame.id + '.')
      assert.deepEqual(
        entry.view.edges,
        parent.view.edges.filter((e) => relevant(e.source) || relevant(e.target)),
      )
      assert.ok(entry.kids.size > 0, 'deeper semantic zoom remains reachable')
      assert.equal(entry.frame.unfold, false)
      const inside = (id) => id.startsWith(entry.frame.id + '.')
      for (const node of entry.view.nodes.filter((n) => !inside(n.id))) {
        assert.equal(node.unfold, false, 'context boxes cannot be unfolded from another scope')
        assert.equal(node.expanded, false, 'context frames cannot be folded from another scope')
      }
    }
    assert.equal(inherited, 3)
    assert.deepEqual(expanded.views, snapshot)
  }
})

const neighbourSource = `// diagram v1
model {
  shop = system 'Shop' {
    front = system 'Front' {
      web = service 'Web'
      cdn = service 'CDN'
    }
    core = system 'Core' {
      api = service 'API'
      db = data 'DB'
    }
    ops = system 'Ops' { cron = service 'Cron' }
  }
  user = person 'User'
  worker = service 'Worker'
  user -> shop.front.web 'browses'
  shop.front.web -> shop.core.api 'calls'
  shop.front.web -> shop.front.cdn 'loads'
  shop.core.api -> shop.core.db 'reads'
  worker -> shop.ops.cron 'starts'
}
`
const neighbourScenes = await Promise.all(
  ['TopBottom', 'LeftRight'].map((direction) => compute(neighbourSource, { direction, expand: ['shop.front', 'shop.core'] })),
)

test('an inherited scope retains every relevant relation but excludes unrelated context', () => {
  for (const scene of neighbourScenes) {
    assert.deepEqual(scene.errors, [])
    const tree = buildTree(scene, 'index')
    const entry = tree.entries.get(scene.viewOfElement['shop.front'])
    const original = scene.views.find((v) => v.id === entry.id)
    const relations = (view) => new Set(view.edges.flatMap((e) => e.relations))
    assert.deepEqual(relations(entry.view), relations(original), 'dedicated-scope relations are complete')
    assert.ok(
      !entry.view.nodes.some((n) => ['shop.ops', 'worker', 'shop.core.db'].includes(n.id)),
      'unrelated siblings and unrelated children of a linked frame are absent',
    )
    assert.ok(
      entry.view.nodes.some((n) => n.id === 'shop.core'),
      'a visible endpoint keeps its navigable containing frame',
    )
    const ids = new Set(entry.view.nodes.map((n) => n.id))
    for (const node of entry.view.nodes) {
      assert.ok(node.parent === null || ids.has(node.parent), `${node.id} has a visible parent`)
      for (const child of node.children) assert.ok(ids.has(child))
      for (const edge of [...(node.inEdges ?? []), ...(node.outEdges ?? [])])
        assert.ok(
          entry.view.edges.some((e) => e.id === edge),
          'node edge indexes stay scoped',
        )
    }
    for (const edge of entry.view.edges)
      for (const id of [edge.source, edge.target]) assert.ok(ids.has(id), 'routes have both endpoint boxes')
  }
})

test('Fit includes inherited frames, neighbours and routed labels without leaving the scope', () => {
  for (const scene of neighbourScenes)
    for (const size of [...sizes, { w: 420, h: 800 }]) {
      const tree = buildTree(scene, 'index')
      for (const entry of tree.entries.values()) {
        if (!entry.box?.expanded) continue
        const T = fitView(tree, entry.id, size)
        const boxes = [...entry.view.nodes, ...entry.view.edges.map((e) => e.labelBBox).filter(Boolean)]
        for (const box of boxes) {
          const r = screen(T, box)
          assert.ok(
            r.l >= -1e-6 && r.t >= -1e-6 && r.r <= size.w + 1e-6 && r.b <= size.h + 1e-6,
            `${entry.id} ${box.id ?? 'label'} fits at ${size.w}x${size.h}`,
          )
        }
        for (const edge of entry.view.edges)
          for (const [x, y] of edge.points) {
            assert.ok(T.s * x + T.tx >= 0 && T.s * x + T.tx <= size.w)
            assert.ok(T.s * y + T.ty >= 0 && T.s * y + T.ty <= size.h)
          }
        for (const factor of [1, Math.exp(-120 * 0.0015), Math.exp(120 * 0.0015)]) {
          const S = {
            tree,
            size,
            focus: entry.id,
            cand: null,
            cam: { s: T.s * factor, tx: size.w / 2 - (size.w / 2 - T.tx) * factor, ty: size.h / 2 - (size.h / 2 - T.ty) * factor },
          }
          settle(S)
          assert.equal(S.focus, entry.id, 'Fit and a wheel notch either way preserve the scope')
        }
        const g = geom(tree, entry.id, size)
        for (const blend of [0, 0.5, 1]) {
          const camera = { s: g.bc / frac(1, g.N, size), tx: -123, ty: 56 }
          const projected = childCam(g, camera, size, blend)
          for (const key of ['s', 'tx', 'ty']) close(projected[key], camera[key], 'an inherited scene has one coordinate system')
        }
      }
    }
})

test('an expanded outside neighbour keeps fly chips and double-click navigation, never fold', () => {
  for (const scene of neighbourScenes) {
    const tree = buildTree(scene, 'index'),
      focus = scene.viewOfElement['shop.front']
    const entry = tree.entries.get(focus),
      calls = []
    const activation = useActivation(
      { current: { tree, focus } },
      (id) => {
        calls.push(['fly', id])
        return true
      },
      (id) => calls.push(['toggle', id]),
      () => {},
      { current: false },
    )
    const core = entry.view.nodes.find((n) => n.id === 'shop.core')
    assert.ok(core.children.length > 0)
    assert.equal(viewLegend(entry.view).elsewhere, true, 'the legend includes navigation on outside frames')
    assert.equal(activation.chipOf(core), 'fly')
    assert.equal(activation.onOpen(core), true)
    activation.onChip(core)
    assert.deepEqual(calls, [
      ['fly', scene.viewOfElement['shop.core']],
      ['fly', scene.viewOfElement['shop.core']],
    ])
    assert.equal(activation.onOpen(entry.frame), false, 'the current frame still leaves double-click to Fit')
  }
})

test('entering an unfolded scope does not immediately enter a collapsed child', async () => {
  const source = await readFile(new URL('../examples/reference.c4', import.meta.url), 'utf8')
  for (const direction of ['TopBottom', 'LeftRight']) {
    const scene = await compute(source, { direction, expand: ['azure.prod.tracking'] })
    const tree = buildTree(scene, 'index'),
      size = sizes[0]
    const entry = tree.entries.get(scene.viewOfElement['azure.prod.tracking'])
    const g = geom(tree, entry.id, size)
    const child = entry.view.nodes.find((n) => n.id === 'azure.prod.tracking.vnet')
    const cam = { s: (g.bc * 1.02) / frac(1, g.N, size), tx: 0, ty: 0 }
    const S = {
      tree,
      size,
      focus: entry.parent,
      cand: entry.id,
      cam,
      anchor: [cam.s * (child.x + child.width / 2), cam.s * (child.y + child.height / 2)],
    }
    settle(S)
    assert.equal(S.focus, entry.id)
    S.arriving = null
    settle(S)
    assert.equal(S.focus, entry.id, 'the nested view waits for more wheel input')
  }
})

test('a pruned outside frame keeps the canonical collapsed-group summary', async () => {
  const source = neighbourSource
    .replace("api = service 'API'", "api = service 'API' { #doing #assumed }")
    .replace("db = data 'DB'", "db = data 'DB' { #blocked }")
    .replace("shop.front.web -> shop.core.api 'calls'", "shop.front.web -> shop.core 'calls'")
  const scene = await compute(source, { expand: ['shop.front', 'shop.core'] })
  const snapshot = structuredClone(scene.views)
  const entry = buildTree(scene, 'index').entries.get(scene.viewOfElement['shop.front'])
  const card = entry.view.nodes.find((n) => n.id === 'shop.core')
  const expected = scene.views.find((v) => v.id === entry.id).nodes.find((n) => n.id === card.id)
  assert.deepEqual(card.children, [])
  for (const key of ['hidden', 'rollup', 'assumedCount', 'internalLinks', 'externalLinks']) assert.deepEqual(card[key], expected[key], key)
  assert.equal(card.rollup.state, 'blocked')
  assert.equal(card.assumedCount, 1)
  assert.deepEqual(scene.views, snapshot)
})

test('leaving an inherited scope fades in only the newly visible context', () => {
  for (const scene of neighbourScenes) {
    const tree = buildTree(scene, 'index'),
      size = sizes[0]
    const entry = tree.entries.get(scene.viewOfElement['shop.front'])
    const g = geom(tree, entry.id, size)
    const S = { tree, size, focus: entry.id, cand: null, cam: { s: (g.fc * 0.999) / frac(1, entry.frame, size), tx: 0, ty: 0 } }
    settle(S)
    assert.equal(S.focus, entry.parent)
    assert.equal(S.contextFade.id, entry.parent)
    assert.equal(S.contextFade.p, 0)
    assert.ok(S.contextFade.nodes.has('shop.front.web'), 'already visible nodes stay visible')
    assert.ok(!S.contextFade.nodes.has('shop.ops'), 'unrelated parent context starts hidden')
    assert.deepEqual(S.contextFade.edges, new Set(entry.view.edges.map((e) => e.id)))
    const flight = { tree, size, focus: entry.id, cam: { s: 1, tx: 0, ty: 0 } }
    exitScope(flight, entry)
    assert.equal(flight.focus, entry.parent)
    assert.deepEqual(flight.contextFade, S.contextFade, 'scripted exits and wheel exits seed the same fade')
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
      const T = { s: (g.b0 + g.bc) / 2 / frac(1, g.N, size), tx: 12, ty: -40 }
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

test('the wheel enters every group from its parent fit, on any stage', () => {
  for (const size of [...sizes, ...largeSizes]) {
    const tree = buildTree(result, 'index')
    for (const [id, entry] of tree.entries) {
      if (!entry.parent) continue
      const fit = fitView(tree, entry.parent, size)
      const box = entry.box
      const anchor = [fit.s * (box.x + box.width / 2) + fit.tx, fit.s * (box.y + box.height / 2) + fit.ty]
      const S = { tree, size, focus: entry.parent, cand: null, cam: fit, anchor }
      for (let notch = 0; notch < 40 && !pathOf(tree, S.focus).includes(id); notch++) {
        S.cam = wheelZoom(tree, S.focus, S.cam, size, -120, false, anchor)
        settle(S)
        // The stage enters an arriving group once its opening animation ends.
        if (S.arriving) {
          S.arriving = null
          settle(S)
        }
      }
      assert.ok(pathOf(tree, S.focus).includes(id), `${id} entered at ${size.w}x${size.h}`)
    }
  }
})

test('a small group view is enlarged at its fit until its frame covers FRAME_MIN, bounds permitting', () => {
  for (const size of [...sizes, ...largeSizes]) {
    const tree = buildTree(result, 'index')
    for (const [id, entry] of tree.entries) {
      if (!entry.parent) continue
      const b = entry.view.bounds
      const all = Math.min((size.w - 2 * FIT_PAD) / b.width, (size.h - 2 * FIT_PAD) / b.height)
      const wanted = Math.min(all, FRAME_MIN / frac(1, entry.frame, size))
      assert.ok(fitView(tree, id, size).s >= wanted * (1 - 1e-9), `${id} at ${size.w}x${size.h}`)
    }
  }
})

test('zoom paths retain exact endpoints, including same-centre zooms', () => {
  for (const [a, b] of [
    [
      [0, 0, 100],
      [300, -50, 800],
    ],
    [
      [-60, 70, 900],
      [-60, 70, 100],
    ],
    [
      [5, 6, 100],
      [5, 6, 100],
    ],
    [
      [5, 6, 100],
      [5 + 1e-8, 6 - 1e-8, 500],
    ],
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
    for (const [before, after] of [
      [sizes[0], { w: 1300, h: 780 }],
      [sizes[1], { w: 420, h: 800 }],
      [sizes[2], sizes[0]],
    ]) {
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

test('the user-facing fit shows every box and never leaves the current view', () => {
  let floors = 0
  for (const size of [...sizes, ...largeSizes, { w: 420, h: 800 }, { w: 560, h: 780 }]) {
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
        const anchors = [
          [size.w / 2, size.h / 2],
          ...entry.view.nodes
            .filter((n) => entry.kids.has(n.id))
            .map((n) => [T.s * (n.x + n.width / 2) + T.tx, T.s * (n.y + n.height / 2) + T.ty]),
        ]
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

test('a single extreme wheel event cannot skip the root minimum zoom', () => {
  for (const size of sizes) {
    const tree = buildTree(result, 'index')
    const minimum = fitView(tree, tree.root.id, size).s * 0.3
    for (const entry of tree.entries.values()) {
      for (const pinch of [false, true]) {
        const s = { tree, size, focus: entry.id, cam: fitView(tree, entry.id, size), cand: null, anchor: [size.w / 2, size.h / 2] }
        s.cam = wheelZoom(tree, s.focus, s.cam, size, 8000, pinch, s.anchor)
        settle(s)
        if (s.focus === tree.root.id) assert.ok(s.cam.s >= minimum, `${entry.id}/${pinch}: root scale stays above ${minimum}`)
        const bounded = wheelZoom(tree, entry.id, fitView(tree, entry.id, size), size, pinch ? 90 : 600, pinch, s.anchor)
        const huge = wheelZoom(tree, entry.id, fitView(tree, entry.id, size), size, 8000, pinch, s.anchor)
        assert.deepEqual(huge, bounded, 'pixel, line, page and pinch bursts have the same per-event cap')
      }
    }
  }
})

test('focusPan keeps keyboard boxes visible without fighting panel clearance', () => {
  const size = { w: 600, h: 400 }
  assert.equal(focusPan({ l: 20, t: 20, r: 80, b: 80 }, size), null)
  assert.deepEqual(focusPan({ l: -20, t: 350, r: 80, b: 450 }, size), { dx: 32, dy: -62 })
  const panel = { l: 380, t: 10, r: 590, b: 390 }
  assert.deepEqual(focusPan({ l: 600, t: 30, r: 700, b: 130 }, size, panel), { dx: -332, dy: 0 })
  assert.equal(focusPan({ l: 268, t: 30, r: 368, b: 130 }, size, panel), null, 'already-cleared selection does not move')
  assert.equal(focusPan({ l: -100, t: 20, r: 700, b: 80 }, size), null, 'an oversized centred box needs no pan')
})

test('a navigating double-click closes the details opened by its first click before flying', () => {
  const tree = buildTree(result, 'index')
  const entry = [...tree.entries.values()].find((item) => item.parent && item.view.nodes.some((node) => node.drill && node.id !== item.frame?.id))
  const node = entry.view.nodes.find((item) => item.drill && item.id !== entry.frame?.id)
  const calls = []
  let selection = null
  const activation = useActivation({ current: { tree, focus: entry.id } }, () => {
    calls.push(['fly', selection])
    return true
  }, null, (update) => {
    selection = typeof update === 'function' ? update(selection) : update
  }, { current: false })
  activation.onActivate(node, { detail: 1 })
  assert.equal(selection.item.id, node.id)
  activation.onActivate(node, { detail: 2 })
  activation.onOpen(node)
  assert.deepEqual(calls, [['fly', null]], 'clear selection before starting, not cancelling, the navigation')
})
