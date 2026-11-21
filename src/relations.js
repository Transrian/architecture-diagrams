// Exact relation endpoints projected into the currently displayed view.
// Pure helpers: no layout engine, React, or writes to the diagram source.
const within = (id, scope) => !scope || id === scope || id.startsWith(scope + '.')

/** Breadcrumb below the current scope; outside endpoints keep their root. */
export function endpointPath(model, id, view) {
  const elements = model?.elements ?? {}
  if (!elements[id]) return id ?? ''
  const scope = view?.viewOf ?? null
  if (id === scope) return elements[id].title ?? id
  const stop = scope && within(id, scope) ? scope : null
  const path = []
  for (let el = elements[id]; el && el.id !== stop; el = elements[el.parent]) path.unshift(el.title ?? el.id)
  return path.join(' › ')
}

/**
 * Closed ancestors to add to `expand`, parents first, for this generated view
 * only. The endpoint itself need not be opened to reveal a group endpoint.
 * `expanded` also covers ancestors open globally but hidden in this layout.
 */
export function endpointUnfolds(edge, model, view, expanded = []) {
  if (!view?.generated || !model) return []
  const elements = model.elements ?? {}
  const scope = view.viewOf ?? null
  const open = new Set(expanded)
  for (const node of view.nodes ?? []) if (node.expanded || node.children?.length) open.add(node.id)
  const out = new Set()
  for (const relation of edge.relationList ?? []) {
    for (const id of [relation.sourceId, relation.targetId]) {
      if (!id || id === scope || !within(id, scope)) continue
      const path = []
      for (let el = elements[elements[id]?.parent]; el && el.id !== scope; el = elements[el.parent]) {
        if (el.children?.length && !open.has(el.id)) path.unshift(el.id)
      }
      for (const ancestor of path) out.add(ancestor)
    }
  }
  return [...out].sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b))
}
