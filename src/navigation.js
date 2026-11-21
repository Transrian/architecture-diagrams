// Pure display-only keyboard and model navigation helpers.

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
