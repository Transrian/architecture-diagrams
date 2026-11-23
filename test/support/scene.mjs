import assert from 'node:assert/strict'
import { fitView, settle, NOTCH } from '../../src/viewer/zoom.js'

export const viewports = [{ w: 420, h: 800 }, { w: 1300, h: 900 }, { w: 1920, h: 700 }]
const relations = view => new Set(view.edges.flatMap(edge => edge.relations))

export function assertSceneContracts(tree, scene, sizes = viewports) {
  let checked = 0
  for (const entry of tree.entries.values()) {
    if (!entry.view.inPlace) continue
    checked++
    const view = entry.view, parent = tree.entries.get(entry.parent).view
    const original = scene.views.find(view => view.id === entry.id)
    const within = id => id === entry.frame.id || id.startsWith(entry.frame.id + '.')
    const nodes = new Map(view.nodes.map(node => [node.id, node]))
    const edges = new Map(view.edges.map(edge => [edge.id, edge]))
    const endpoints = new Set(view.edges.flatMap(edge => [edge.source, edge.target]))
    assert.equal(nodes.size, view.nodes.length, 'unique node IDs')
    assert.equal(edges.size, view.edges.length, 'unique edge IDs')
    for (const relation of relations(original)) assert.ok(relations(view).has(relation), `missing relation ${relation} in ${entry.id}`)
    for (const node of view.nodes) {
      const old = parent.nodes.find(other => other.id === node.id)
      assert.ok(old, `missing parent-layout node ${node.id}`)
      for (const key of ['x', 'y', 'width', 'height']) assert.equal(node[key], old[key], `${node.id} ${key} moved`)
      assert.ok(within(node.id) || endpoints.has(node.id) || [...endpoints].some(id => id.startsWith(node.id + '.')), `unrelated context ${node.id}`)
      assert.ok(node.parent === null || nodes.has(node.parent), `dangling parent ${node.id}`)
      for (const child of node.children) assert.equal(nodes.get(child)?.parent, node.id, `inconsistent child ${child}`)
      // Frame indexes also contain routes attached to their descendants.
      const indexed = endpoint => endpoint === node.id || endpoint?.startsWith(node.id + '.')
      for (const id of node.inEdges ?? []) assert.ok(indexed(edges.get(id)?.target), `dangling incoming edge ${id}`)
      for (const id of node.outEdges ?? []) assert.ok(indexed(edges.get(id)?.source), `dangling outgoing edge ${id}`)
    }
    for (const edge of view.edges) {
      assert.ok(nodes.has(edge.source) && nodes.has(edge.target), `dangling endpoint ${edge.id}`)
      for (const id of edge.relations) assert.ok(scene.model.relations[id], `unknown relation ${id}`)
      const old = parent.edges.find(other => other.id === edge.id)
      assert.deepEqual(edge, old, `route or provenance changed ${edge.id}`)
    }
    const points = [
      ...view.nodes.flatMap(box => [[box.x, box.y], [box.x + box.width, box.y + box.height]]),
      ...view.edges.flatMap(edge => [...edge.points, ...(edge.labelBBox ? [[edge.labelBBox.x, edge.labelBBox.y], [edge.labelBBox.x + edge.labelBBox.width, edge.labelBBox.y + edge.labelBBox.height]] : [])]),
    ]
    for (const size of sizes) {
      const cam = fitView(tree, entry.id, size)
      for (const [x, y] of points) {
        const px = cam.s * x + cam.tx, py = cam.s * y + cam.ty
        assert.ok(Number.isFinite(px) && Number.isFinite(py) && px >= -1e-6 && py >= -1e-6 && px <= size.w + 1e-6 && py <= size.h + 1e-6, `${entry.id} clipped at ${size.w}x${size.h}`)
      }
      for (const factor of [1, NOTCH, 1 / NOTCH]) {
        const state = { tree, size, focus: entry.id, cand: null, cam: { s: cam.s * factor, tx: size.w / 2 - (size.w / 2 - cam.tx) * factor, ty: size.h / 2 - (size.h / 2 - cam.ty) * factor } }
        settle(state, false)
        assert.equal(state.focus, entry.id, 'Fit and one notch preserve scope')
      }
      const camParent = fitView(tree, entry.parent, size), box = entry.box
      const state = { tree, size, focus: entry.parent, cand: null, cam: camParent, anchor: [camParent.s * (box.x + box.width / 2) + camParent.tx, camParent.s * (box.y + box.height / 2) + camParent.ty] }
      settle(state)
      state.arriving = null
      settle(state)
      assert.equal(state.focus, entry.parent, 'parent Fit does not enter a child')
    }
  }
  return checked
}
