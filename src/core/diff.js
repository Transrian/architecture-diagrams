// @ts-check
/**
 * @typedef {import('./types.js').Model} Model
 * @typedef {import('./types.js').ModelDiff} ModelDiff
 */
/** Semantic comparison of serializable model summaries; no engine or layout dependency. */

const ELEMENT_FIELDS = ['title', 'description', 'technology', 'kind', 'metadata', 'state', 'marks']
const RELATION_FIELDS = ['title', 'description', 'technology', 'kind', 'metadata', 'state', 'marks', 'tags']

// Metadata key order and tag/mark order are not semantic changes.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  return value
}
function fieldValue(item, field) {
  const value = item[field]
  if (field === 'marks' || field === 'tags') return [...new Set(value ?? [])].sort()
  if (field === 'metadata') return value ?? {}
  return value ?? ''
}
function changedFields(before, after, fields) {
  return fields.filter(
    (field) => JSON.stringify(canonical(fieldValue(before, field))) !== JSON.stringify(canonical(fieldValue(after, field))),
  )
}
function buckets(items, keyOf) {
  const out = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(item)
  }
  return out
}
const moveKey = (element) => JSON.stringify([element.kind, element.title, element.id.split('.').at(-1)])

/**
 * Elements use FQN identity. Only unique kind/title/short-id matches are moves.
 * Relations match remapped endpoints + title, then endpoints (a label edit).
 * Engine-generated relation ids and element child arrays are deliberately ignored.
 * Added/removed entries are summaries; changed/moved entries retain before/after.
 */
/** @param {Model} before
 * @param {Model} after
 * @returns {ModelDiff} */
export function diffModels(before, after) {
  const oldElements = before?.elements ?? {}
  const newElements = after?.elements ?? {}
  const elements = { added: [], removed: [], moved: [], changed: [] }
  const relations = { added: [], removed: [], changed: [] }
  const renamed = new Map()
  const movedTargets = new Set()
  const removed = Object.values(oldElements).filter((element) => !Object.hasOwn(newElements, element.id))
  const added = Object.values(newElements).filter((element) => !Object.hasOwn(oldElements, element.id))
  const oldMoves = buckets(removed, moveKey)
  const newMoves = buckets(added, moveKey)
  const compareElement = (a, b) => {
    const fields = changedFields(a, b, ELEMENT_FIELDS)
    if (fields.length) elements.changed.push({ id: b.id, before: a, after: b, fields })
  }
  for (const [id, element] of Object.entries(oldElements)) {
    if (Object.hasOwn(newElements, id)) compareElement(element, newElements[id])
  }
  for (const element of removed) {
    const key = moveKey(element)
    const matches = newMoves.get(key)
    if (oldMoves.get(key).length === 1 && matches?.length === 1) {
      const next = matches[0]
      renamed.set(element.id, next.id)
      movedTargets.add(next.id)
      elements.moved.push({ from: element.id, to: next.id, before: element, after: next })
      compareElement(element, next)
    } else elements.removed.push(element)
  }
  elements.added = added.filter((element) => !movedTargets.has(element.id))

  const oldRelations = Object.values(before?.relations ?? {})
  const newRelations = Object.values(after?.relations ?? {})
  const endpointKey = (relation, remap = false) =>
    JSON.stringify([
      remap ? (renamed.get(relation.source) ?? relation.source) : relation.source,
      remap ? (renamed.get(relation.target) ?? relation.target) : relation.target,
    ])
  const matched = new Set()
  const pending = []
  const pair = (a, b) => {
    matched.add(b)
    const fields = changedFields(a, b, RELATION_FIELDS)
    if (fields.length) relations.changed.push({ id: b.id, before: a, after: b, fields })
  }
  // Generated ids and declaration order are not identity. Reserve the complete
  // unchanged semantic multiset first, including same-title parallel links, so
  // an edited record cannot steal a later record's unchanged counterpart.
  const semanticKey = (relation, remap = false) =>
    JSON.stringify([endpointKey(relation, remap), ...RELATION_FIELDS.map((field) => canonical(fieldValue(relation, field)))])
  const semantic = buckets(newRelations, (relation) => semanticKey(relation))
  for (const relation of oldRelations) {
    const next = semantic.get(semanticKey(relation, true))?.shift()
    if (next) pair(relation, next)
    else pending.push(relation)
  }
  // Then match every remaining exact label before any endpoint-only relabel.
  const exact = buckets(
    newRelations.filter((relation) => !matched.has(relation)),
    (relation) => JSON.stringify([endpointKey(relation), relation.title ?? '']),
  )
  const relabels = []
  for (const relation of pending) {
    const next = exact.get(JSON.stringify([endpointKey(relation, true), relation.title ?? '']))?.shift()
    if (next) pair(relation, next)
    else relabels.push(relation)
  }
  const endpoints = buckets(
    newRelations.filter((relation) => !matched.has(relation)),
    (relation) => endpointKey(relation),
  )
  for (const relation of relabels) {
    const next = endpoints.get(endpointKey(relation, true))?.shift()
    if (next) pair(relation, next)
    else relations.removed.push(relation)
  }
  relations.added = newRelations.filter((relation) => !matched.has(relation))
  return { beforeCount: Object.keys(oldElements).length, afterCount: Object.keys(newElements).length, elements, relations }
}
