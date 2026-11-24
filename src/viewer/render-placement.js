import * as React from 'react'
const h = React.createElement
const mix = (a, b, p) => a + (b - a) * p

export function levelPlacement(T, inner, scope, glide) {
  /** Inner level: the frame of the view reshapes from the unfolded frame it was in the parent. */
  const reshaped = (n) => {
    const a = inner && n.id === scope ? glide?.from.get(n.id) : null
    const q = a ? glide.p(n.id) : 1
    if (q >= 1) return n
    const P = glide.T
    const ax = (P.s * a.x + P.tx - T.tx) / T.s
    const ay = (P.s * a.y + P.ty - T.ty) / T.s
    return {
      ...n,
      x: mix(ax, n.x, q),
      y: mix(ay, n.y, q),
      width: mix((P.s * a.width) / T.s, n.width, q),
      height: mix((P.s * a.height) / T.s, n.height, q),
    }
  }
  /** Inner level: a box moving from its rect in the parent (screen) to its own rect, text included. */
  const placed = (n, el) => {
    if (n.id === scope) return el
    const a = glide?.from.get(n.id)
    const q = a ? glide.p(n.id) : 1
    if (q >= 1) return el
    const P = glide.T
    const ax = (P.s * a.x + P.tx - T.tx) / T.s
    const ay = (P.s * a.y + P.ty - T.ty) / T.s
    const aw = (P.s * a.width) / T.s
    const k = mix(aw / Math.max(n.width, 1), 1, q)
    const x = mix(ax, n.x, q)
    const y = mix(ay, n.y, q)
    return h('g', { transform: `translate(${x - k * n.x},${y - k * n.y}) scale(${k})` }, el)
  }
  return { reshaped, placed }
}
