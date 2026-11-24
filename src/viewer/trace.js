// @ts-check
/**
 * @typedef {import('../core/types.js').Model} Model
 * @typedef {import('../core/types.js').Trace} Trace
 * @typedef {import('../core/types.js').View} View
 * @typedef {import('../core/types.js').TraceProjection} TraceProjection
 */
// Pure graph queries on the detailed model; view aggregation is display-only.
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0
const depthObject = (depths) => Object.fromEntries([...depths].sort(([a], [b]) => compareIds(a, b)))
const keepMin = (depths, id, depth) => {
  if (!depths.has(id) || depth < depths.get(id)) depths.set(id, depth)
}

/**
 * Trace the original model.elements / model.relations dictionaries, never view
 * edges. Returns { elements: { [id]: depth }, relations: { [id]: depth } }.
 * These are ordinary, JSON-serializable objects, with keys inserted in lexical
 * order (integer-like keys follow JavaScript's ordinary enumeration order).
 * Dictionary keys, not a record's optional `id` property, identify each entry.
 *
 * The seed is included at depth 0. Element depth is the shortest hop count.
 * Relation depth is 1 + the shortest depth of its traversal-side endpoint:
 * source for downstream, target for upstream, either seed endpoint for
 * neighbours. All traversable links are included, even back/cycle links whose
 * other endpoint was already reached; relation depth need not equal that
 * endpoint's depth. Parallel relations retain their separate original ids.
 *
 * neighbours (the default) takes exactly one hop in both directions; upstream
 * and downstream follow their direction transitively. Group endpoints are
 * ordinary vertices: neither parents nor children are implicitly visited.
 * Missing seeds yield empty maps; dangling relations are ignored. An unknown
 * mode throws RangeError. Nothing in the model is mutated or retained.
 */
/** @param {Model} model
 * @param {string} id
 * @returns {Trace} */
export function trace(model, id, mode = 'neighbours') {
  if (!['neighbours', 'upstream', 'downstream'].includes(mode)) throw new RangeError(`Unknown trace mode: ${mode}`)
  const elements = model?.elements ?? {}
  const elementDepths = new Map()
  const relationDepths = new Map()
  if (typeof id !== 'string' || !Object.hasOwn(elements, id)) return { elements: {}, relations: {} }

  const adjacent = new Map()
  const add = (from, to, relation) => {
    if (!adjacent.has(from)) adjacent.set(from, [])
    adjacent.get(from).push({ to, relation })
  }
  for (const [relation, link] of Object.entries(model?.relations ?? {})) {
    if (!link || typeof link.source !== 'string' || typeof link.target !== 'string') continue
    if (!Object.hasOwn(elements, link.source) || !Object.hasOwn(elements, link.target)) continue
    if (mode !== 'upstream') add(link.source, link.target, relation)
    if (mode !== 'downstream') add(link.target, link.source, relation)
  }

  const queue = [id]
  elementDepths.set(id, 0)
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]
    const depth = elementDepths.get(from)
    if (mode === 'neighbours' && depth > 0) continue
    for (const { to, relation } of adjacent.get(from) ?? []) {
      keepMin(relationDepths, relation, depth + 1)
      if (elementDepths.has(to)) continue
      elementDepths.set(to, depth + 1)
      queue.push(to)
    }
  }
  return { elements: depthObject(elementDepths), relations: depthObject(relationDepths) }
}

/**
 * Project an existing trace onto a layout view without extending the trace.
 * Returns { nodes: { [viewNodeId]: depth }, edges: { [viewEdgeId]: depth },
 * hidden: [detailedElementId, ...] }, using the minimum represented depth.
 * A node represents itself and its FQN descendants (a dot is the boundary);
 * a reached group does NOT highlight its children. Containment is used only
 * here for display, never to create paths in trace().
 *
 * An edge represents only its original `relations` ids, never its aggregated
 * source/target endpoints. `hidden` lists reached elements with no node of
 * their own in this view, including elements inside a visible folded group.
 * Maps and hidden ids have deterministic lexical ordering as above. Both
 * inputs may be absent and are never mutated; no layout/engine dependency.
 */
/** @param {Trace} result
 * @param {View} view
 * @returns {TraceProjection} */
export function projectTrace(result, view) {
  const reached = result?.elements ?? {}
  const relations = result?.relations ?? {}
  const visible = new Set((view?.nodes ?? []).map((node) => node.id))
  const nodes = new Map()
  const edges = new Map()
  const hidden = []
  for (const [id, depth] of Object.entries(reached)) {
    if (!visible.has(id)) hidden.push(id)
    let ancestor = id
    while (true) {
      if (visible.has(ancestor)) keepMin(nodes, ancestor, depth)
      const dot = ancestor.lastIndexOf('.')
      if (dot < 0) break
      ancestor = ancestor.slice(0, dot)
    }
  }
  for (const edge of view?.edges ?? []) {
    for (const id of edge.relations ?? []) {
      if (Object.hasOwn(relations, id)) keepMin(edges, edge.id, relations[id])
    }
  }
  return { nodes: depthObject(nodes), edges: depthObject(edges), hidden: hidden.sort(compareIds) }
}
