// @ts-check
/**
 * @typedef {import('../core/types.js').Tree} Tree
 * @typedef {import('../core/types.js').Result} Result
 */
import { groupSummary } from '../core/shared.js'
import { isGroup } from './zoom.js'

/**
 * Generated drill-downs have independent Graphviz layouts. Once a group is
 * unfolded, entering it must keep its coordinates and routes or siblings can
 * exchange places. Outside context is restricted to endpoints and their frames.
 */
function inPlaceView(parent, target, scope, viewOfElement, model) {
  const within = (id) => id === scope || id.startsWith(scope + '.')
  const edges = parent.edges.filter((e) => within(e.source) || within(e.target))
  const byId = new Map(parent.nodes.map((n) => [n.id, n]))
  const ids = new Set(parent.nodes.filter((n) => within(n.id)).map((n) => n.id))
  for (const edge of edges)
    for (const id of [edge.source, edge.target]) {
      ids.add(id)
      for (let n = byId.get(id); n; n = byId.get(n.parent)) {
        if (!scope.startsWith(n.id + '.')) ids.add(n.id)
      }
    }
  const edgeIds = new Set(edges.map((e) => e.id))
  const nodes = parent.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const inside = n.id.startsWith(scope + '.')
      const children = (n.children ?? []).filter((id) => ids.has(id))
      const summary = isGroup(n) && !children.length ? groupSummary(model, n.id) : null
      return {
        ...n,
        ...summary,
        parent: ids.has(n.parent) ? n.parent : null,
        children,
        inEdges: n.inEdges?.filter((id) => edgeIds.has(id)),
        outEdges: n.outEdges?.filter((id) => edgeIds.has(id)),
        drill: n.id === scope ? undefined : (n.drill ?? viewOfElement?.[n.id]),
        unfold: inside && !!n.unfold,
        expanded: inside && !!n.expanded,
      }
    })
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity
  const include = (r) => {
    x = Math.min(x, r.x)
    y = Math.min(y, r.y)
    right = Math.max(right, r.x + r.width)
    bottom = Math.max(bottom, r.y + r.height)
  }
  nodes.forEach(include)
  for (const edge of edges) {
    if (edge.labelBBox) include(edge.labelBBox)
    for (const [px, py] of edge.points) include({ x: px, y: py, width: 0, height: 0 })
  }
  return { ...target, nodes, edges, bounds: { x, y, width: right - x, height: bottom - y }, inPlace: true }
}

/**
 * Zoom tree: the root view (overview, the only schema, or a flow) and the
 * view of every group drawn inside a view's frame, collapsed or unfolded
 * in place (zooming into an unfolded group enters its own view). Neighbours
 * drawn around a frame are not children: they belong to another branch.
 */
/** @param {Result} result */
export function buildTree(result, rootId, standalone) {
  const byId = new Map(result.views.map((v) => [v.id, v]))
  const rootView = byId.get(rootId)
  if (!rootView) return null
  const frameOf = (v) => (v.viewOf ? (v.nodes.find((n) => n.id === v.viewOf && isGroup(n)) ?? null) : null)
  const root = { id: rootId, view: rootView, parent: null, frame: frameOf(rootView), box: null, kids: new Map() }
  const entries = new Map([[rootId, root]])
  const queue = standalone ? [] : [root]
  while (queue.length) {
    const e = queue.shift()
    const scope = e.frame ? e.frame.id : null
    for (const n of e.view.nodes) {
      if (!n.drill || (n.parent ?? null) !== scope || entries.has(n.drill)) continue
      const w = byId.get(n.drill)
      if (!w || w._type === 'dynamic') continue
      const frame = w.nodes.find((m) => m.id === n.id && isGroup(m))
      if (!frame) continue
      const view = n.expanded && w.generated ? inPlaceView(e.view, w, n.id, result.viewOfElement, result.model) : w
      const child = {
        id: w.id,
        view,
        parent: e.id,
        frame: view === w ? frame : view.nodes.find((m) => m.id === n.id),
        box: n,
        kids: new Map(),
      }
      entries.set(w.id, child)
      e.kids.set(n.id, w.id)
      queue.push(child)
    }
  }
  return { root, entries, geoms: new Map() }
}

/** @param {Tree} tree */
export function pathOf(tree, id) {
  const out = []
  for (let e = tree.entries.get(id); e; e = e.parent ? tree.entries.get(e.parent) : null) out.unshift(e.id)
  return out
}
