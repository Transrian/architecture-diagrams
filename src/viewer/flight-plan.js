// Flight plans contain scope operations, not callbacks or mutable camera state.
import { pathOf } from './zoom-tree.js'

/**
 * @typedef {{kind: 'exit'|'enter'|'fit'|'reveal', id: string, elementId?: string}} FlightSegment
 */

/**
 * Plan an ascent to the common ancestor, then a descent and final framing.
 * End cameras are resolved by the executor at each segment, after scope changes.
 * @returns {FlightSegment[]}
 */
export function planFlight(tree, fromId, target, candidate, elementId) {
  const from = pathOf(tree, fromId)
  const to = pathOf(tree, target)
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) common++
  const segments = []
  for (let i = from.length - 1; i >= common; i--) {
    segments.push({ kind: 'exit', id: from[i] })
  }
  const downs = to.slice(common)
  if (downs.length && (segments.length || (candidate && candidate !== downs[0]))) {
    segments.push({ kind: 'fit', id: to[common - 1] })
  }
  for (const id of downs) segments.push({ kind: 'enter', id })
  segments.push(elementId ? { kind: 'reveal', id: target, elementId } : { kind: 'fit', id: target })
  return segments
}
