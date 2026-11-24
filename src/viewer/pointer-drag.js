// @ts-check
/** @typedef {{x: number, y: number}} Point */
/** @typedef {{pointerId: number, pointerType: string, clientX: number, clientY: number}} Pointer */
/** @typedef {{points: Map<number, Point>, touch: boolean, moved: boolean, at: Point & {distance: number}}} Drag */

/** @param {Drag | null} drag @param {Pointer} event @returns {Drag | null} */
export function addPointer(drag, event) {
  const touch = event.pointerType === 'touch'
  if (drag && (!touch || !drag.touch || drag.points.size >= 2)) return null
  const d = drag ?? { points: new Map(), touch, moved: false, at: { x: 0, y: 0, distance: 0 } }
  d.points.set(event.pointerId, { x: event.clientX, y: event.clientY })
  d.at = midpoint(d.points)
  if (d.points.size > 1) d.moved = true
  return d
}

/** @param {Drag} drag @param {Pointer} event */
export function movePointer(drag, event) {
  if (!drag.points.has(event.pointerId)) return null
  drag.points.set(event.pointerId, { x: event.clientX, y: event.clientY })
  const next = midpoint(drag.points)
  const dx = next.x - drag.at.x, dy = next.y - drag.at.y
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return null
  const ratio = drag.at.distance > 0 && next.distance > 0 ? next.distance / drag.at.distance : 1
  drag.at = next
  drag.moved = true
  return { ...next, dx, dy, ratio }
}

/** @param {Drag} drag @param {number} id */
export function removePointer(drag, id) {
  if (!drag.points.delete(id)) return false
  if (drag.points.size) drag.at = midpoint(drag.points)
  return true
}

/** @param {Map<number, Point>} points */
function midpoint(points) {
  const [a, b] = [...points.values()]
  return b
    ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
    : { ...a, distance: 0 }
}
