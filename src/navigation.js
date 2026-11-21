// Pure display-only keyboard and model navigation helpers.
import { endpointPath } from './relations.js'

/** Nearest box in a direction, biased toward the same row or column. */
export function directionalNeighbour(nodes, fromId, direction) {
  const axis = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[direction]
  if (!axis || !nodes.length) return null
  const origin = nodes.find((node) => node.id === fromId)
  if (!origin) return nodes[0].id
  const center = (node) => [node.x + node.width / 2, node.y + node.height / 2]
  const [ox, oy] = center(origin)
  let best = null
  let score = Infinity
  for (const node of nodes) {
    if (node.id === fromId) continue
    const [x, y] = center(node)
    const dx = x - ox
    const dy = y - oy
    const forward = dx * axis[0] + dy * axis[1]
    if (forward <= 0) continue
    const across = Math.abs(dx * axis[1] - dy * axis[0])
    const cost = Math.hypot(dx, dy) + across * 2
    if (cost < score || (cost === score && node.id < best)) {
      best = node.id
      score = cost
    }
  }
  return best
}

/** Locale-independent search text, preserving Unicode letters/numbers (including CJK). */
export function normalizeSearch(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Display-only model search. All query terms must match, possibly across fields.
 * Exact title/FQN/id matches lead, followed by prefixes, substrings and details.
 * Equal relevance uses FQN code-point order, independent of model order or locale.
 */
export function searchElements(model, query, limit = 12) {
  const text = normalizeSearch(query)
  const max = Number.isFinite(limit) ? Math.max(0, Math.min(12, Math.floor(limit))) : 12
  if (!text || !max) return []
  const terms = [...new Set(text.split(' '))]
  const matches = []
  for (const element of Object.values(model?.elements ?? {})) {
    const id = element.id
    const title = normalizeSearch(element.title)
    const fqn = normalizeSearch(id)
    const short = normalizeSearch(id.split('.').at(-1))
    const technology = normalizeSearch(element.technology)
    const description = normalizeSearch(element.description)
    const fields = [title, fqn, technology, description]
    if (!terms.every((term) => fields.some((field) => field.includes(term)))) continue
    const ranks = [
      title === text,
      fqn === text,
      short === text,
      title.startsWith(text),
      short.startsWith(text),
      fqn.startsWith(text),
      title.includes(text),
      fqn.includes(text),
      technology.includes(text),
      description.includes(text),
    ]
    const rank = ranks.indexOf(true)
    const termRank = terms.reduce((sum, term) => sum + fields.findIndex((field) => field.includes(term)), 0)
    matches.push({ element, rank: rank < 0 ? ranks.length : rank, termRank })
  }
  matches.sort((a, b) => a.rank - b.rank || a.termRank - b.termRank || (a.element.id < b.element.id ? -1 : a.element.id > b.element.id ? 1 : 0))
  return matches.slice(0, max).map(({ element }) => ({
    id: element.id,
    title: element.title ?? element.id,
    state: element.state,
    path: endpointPath(model, element.id, null),
  }))
}

/** View in which an element can be revealed; root people/externals use the index. */
export function viewForElement(result, id) {
  const element = result?.model?.elements?.[id]
  if (!element) return null
  const own = result.viewOfElement?.[id]
  if (own) return own
  if (element.children?.length) return null
  if (element.parent) return result.viewOfElement?.[element.parent] ?? null
  return element.kind === 'person' || element.kind === 'external' ? 'index' : null
}
