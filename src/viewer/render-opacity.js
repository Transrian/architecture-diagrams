import { ramp, isGroup, childCam, geom, plain } from './zoom.js'
import { ease } from './zoom-path.js'

export function levelOpacity(ctx, entry, T, inner, v, scope, neighbours, glide) {
  const { tree, size, cand, leaving } = ctx
  const within = (id) => scope === null || id === scope || id.startsWith(scope + '.')
  // Groups giving way to their own view: the opening one (still arriving if
  // it was picked already large) and one closing back after it was released.
  const opens = []
  const add = (id, blend) => {
    if (inner || !id || tree.entries.get(id)?.parent !== entry.id) return
    const c = tree.entries.get(id)
    const ct = childCam(geom(tree, id, size), T, size, blend)
    const reveal = ramp(ct.u, 0, 0.25)
    const fade = ramp(ct.u, 0.25, 1)
    // An unfolded box is drawn as a frame with its content: that content glides
    // to its place in the group's view early, the boxes drawn in both views
    // around it glide along with the zoom.
    let glide = null
    if (isGroup(c.box)) {
      const ids = new Set(c.view.nodes.map((n) => n.id))
      const from = new Map()
      for (const n of v.nodes) if (ids.has(n.id) && !n._ghost) from.set(n.id, n)
      const mine = (id) => id === c.box.id || id.startsWith(c.box.id + '.')
      glide = { from, T, p: (id) => ease(mine(id) ? reveal : fade) }
    }
    opens.push({ id: c.box.id, entry: c, T: plain(ct), reveal, fade, glide })
  }
  add(cand, ctx.arriving?.id === cand ? ctx.arriving.blend : 1)
  if (leaving && leaving.id !== cand) add(leaving.id, leaving.blend)
  // The box (and, unfolded, the content) of an open group fades as its view appears.
  const openOf = (id) => opens.find((o) => id === o.id || id.startsWith(o.id + '.'))
  const inOpen = (id) => !!openOf(id)
  // Everything else fades out while a group opens (its view brings its own neighbours in).
  const dim = (except) => opens.reduce((m, o) => (o === except ? m : m * (1 - o.fade)), 1)
  /** Opacity, in this (outer) level, of a box or link belonging to the open group o. */
  const under = (o, id) => {
    if (!o.glide) return 1 - o.reveal
    if (id === undefined) return 1 - ramp(o.reveal, 0, 0.3) // a link: routes cannot glide
    return o.glide.from.has(id) ? 0 : 1 - o.reveal // its view draws it, gliding
  }
  const opacityOf = (x, id) => {
    if (inner) {
      if (glide?.from.has(id)) return x._o ?? 1
      return (x._o ?? 1) * (!within(id) ? neighbours : glide ? glide.p(id) : 1)
    }
    const o = openOf(id)
    if (!o && opens.some((g) => g.glide?.from.has(id))) return 0 // drawn by the gliding view
    return (x._o ?? 1) * (o ? under(o, id) * dim(o) : dim(null))
  }
  const nodes = inner && neighbours < 0.01 ? v.nodes.filter((n) => within(n.id) || glide?.from.has(n.id)) : v.nodes
  const inside = (e) => within(e.source) && within(e.target) && e.source !== scope && e.target !== scope
  const edges = inner && neighbours < 0.01 && !v.inPlace ? v.edges.filter(inside) : v.edges
  const edgeOpacity = (e) => {
    if (inner && v.inPlace && glide) return 1
    if (!inner && opens.some((o) => o.entry.view.inPlace && o.entry.view.edges.includes(e))) return 0
    if (inner) return inside(e) ? (glide ? ramp(glide.p(e.source), 0.6, 1) : 1) : neighbours
    const from = openOf(e.source)
    const both = from && from === openOf(e.target) ? from : null
    return both ? under(both) * dim(both) : dim(null)
  }
  return { opens, inOpen, dim, opacityOf, nodes, edges, edgeOpacity, within }
}
