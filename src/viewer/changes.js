// @ts-check
/**
 * @typedef {import('../core/types.js').Model} Model
 * @typedef {import('../core/types.js').ModelDiff} ModelDiff
 * @typedef {import('../core/types.js').ViewNode} ViewNode
 * @typedef {import('../core/types.js').Change} Change
 * @typedef {import('../core/types.js').Changes} Changes
 */
// Display-only projection of diffModels() results onto the current model.
/** Neutral observed-change badge: folded boxes summarize; open frames show own. */
/** @param {ViewNode} node
 * @param {Change} change */
export function changeBadge(node, change) {
  const counts = node?.hidden > 0 ? change?.total : change?.own
  return [
    ['added', '+'],
    ['changed', 'Δ'],
    ['moved', '↷'],
    ['removed', '−'],
  ]
    .filter(([key]) => counts?.[key] > 0)
    .map(([key, glyph]) => glyph + counts[key])
    .join(' ')
}

const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const parentOf = (id) => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null)
const zeroCounts = () => ({ added: 0, changed: 0, moved: 0, removed: 0 })
const copy = (value) =>
  Array.isArray(value)
    ? value.map(copy)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
      : value

// diffModels emits unique ids. Defensively ignore malformed records and count
// duplicate ids only once within a category; parallel relations have distinct ids.
function entries(items, key = 'id') {
  const byId = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item?.[key] === 'string' && !byId.has(item[key])) byId.set(item[key], item)
  }
  return [...byId].sort(([a], [b]) => compareIds(a, b)).map(([, item]) => item)
}

/**
 * Project a semantic diff onto the AFTER model, without layout or dependencies.
 * Returns:
 * {
 *   nodes: { [currentElementId]: {
 *     own: { added, changed, moved, removed },
 *     total: { added, changed, moved, removed },
 *     fields: [changedField, ...], from: oldFqn | null,
 *     removedElements: [removedSummary, ...]
 *   } },
 *   counts: { added, changed, moved, removed,
 *             relations: { added, changed, removed } },
 *   removed: [allRemovedSummaries, ...], unplaced: [removedSummary, ...],
 *   relations: { added: [...], changed: [...], removed: [...] }
 * }
 *
 * nodes is sparse: only affected current elements and their current surviving
 * FQN ancestors appear. own.added/changed/moved are 0 or 1, for + / Δ / ↷ badges;
 * fields and from describe ONLY that element's own change. own.removed counts
 * deletions attributed directly to this element, not removal of the element.
 * total includes own once plus descendant contributions, suitable for folded
 * groups. Never add own to total again. A moved-and-edited element contributes
 * once to EACH category; a moved subtree contributes once per moved element,
 * only at the new location, never as synthetic additions/removals at the old.
 *
 * A deleted element is attributed to its nearest surviving OLD FQN ancestor,
 * walking from its parent upward. Explicit moved ancestors count as surviving
 * at their new ids. With no surviving ancestor it is unplaced (e.g. a removed
 * schema). Each deletion enters exactly one own.removed bucket, then rolls up
 * once per current ancestor. removedElements lists ALL deletions attributed in
 * that node's current subtree (the same scope as total.removed), sorted by id.
 * Removed elements never get synthetic nodes or layouts.
 *
 * counts describes the whole diff, including unplaced removals and unknown
 * current ids (which cannot get node badges). Relations retain diffModels'
 * added/removed summaries and changed {id,before,after,fields} records, so a
 * links-only diff remains visible without inventing element changes.
 * Absent/unknown diff categories are empty. Duplicate ids within a category
 * count once. Maps and record lists are sorted by id; node fields are sorted.
 * Inputs are not mutated and all returned data is independent plain data.
 */
/** @param {ModelDiff} diff
 * @param {Model} model
 * @returns {Changes} */
export function projectChanges(diff, model) {
  const current = model?.elements ?? {}
  const added = entries(diff?.elements?.added)
  const changed = entries(diff?.elements?.changed)
  const moved = entries(diff?.elements?.moved, 'to')
  const removed = entries(diff?.elements?.removed)
  const movedTo = new Map(moved.filter((item) => typeof item.from === 'string').map((item) => [item.from, item.to]))
  const nodes = new Map()
  const unplaced = []
  const ensure = (id) => {
    if (!nodes.has(id)) nodes.set(id, { own: zeroCounts(), total: zeroCounts(), fields: [], from: null, removedElements: [] })
    return nodes.get(id)
  }
  const rollUp = (id, category, removedElement) => {
    for (let ancestor = id; ancestor !== null; ancestor = parentOf(ancestor)) {
      if (!Object.hasOwn(current, ancestor)) continue
      const node = ensure(ancestor)
      node.total[category]++
      if (removedElement) node.removedElements.push(copy(removedElement))
    }
  }
  const mark = (id, category) => {
    if (!Object.hasOwn(current, id)) return null
    const node = ensure(id)
    node.own[category] = 1
    rollUp(id, category)
    return node
  }
  for (const item of added) mark(item.id, 'added')
  for (const item of changed) {
    const node = mark(item.id, 'changed')
    if (node)
      node.fields = [...new Set((Array.isArray(item.fields) ? item.fields : []).filter((field) => typeof field === 'string'))].sort(
        compareIds,
      )
  }
  for (const item of moved) {
    const node = mark(item.to, 'moved')
    if (node) node.from = typeof item.from === 'string' ? item.from : null
  }
  for (const item of removed) {
    let target = null
    for (let ancestor = parentOf(item.id); ancestor !== null; ancestor = parentOf(ancestor)) {
      const movedAncestor = movedTo.get(ancestor)
      if (movedAncestor !== undefined && Object.hasOwn(current, movedAncestor)) target = movedAncestor
      else if (Object.hasOwn(current, ancestor)) target = ancestor
      if (target !== null) break
    }
    if (target === null) unplaced.push(copy(item))
    else {
      ensure(target).own.removed++
      rollUp(target, 'removed', item)
    }
  }

  const relations = {
    added: entries(diff?.relations?.added).map(copy),
    changed: entries(diff?.relations?.changed).map(copy),
    removed: entries(diff?.relations?.removed).map(copy),
  }
  return {
    nodes: Object.fromEntries([...nodes].sort(([a], [b]) => compareIds(a, b))),
    counts: {
      added: added.length,
      changed: changed.length,
      moved: moved.length,
      removed: removed.length,
      relations: { added: relations.added.length, changed: relations.changed.length, removed: relations.removed.length },
    },
    removed: removed.map(copy),
    unplaced,
    relations,
  }
}
