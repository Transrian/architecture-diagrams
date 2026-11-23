// Drawing one level of the zoom tree (and, recursively, the group opening
// inside it), plus the layout transition shown when a view is laid out anew
// (a group unfolded or folded back, a diagram update, another direction).
import * as React from 'react'
import { NodeView, GroupView, EdgeView } from './shapes.js'
import { ramp, svgTf, isGroup, geom, childCam, plain, ease } from './zoom.js'

const h = React.createElement
const faded = (o, key, el) => h('g', { key, opacity: o >= 0.999 ? undefined : o }, el)
const noop = () => {}
const mix = (a, b, p) => a + (b - a) * p

/**
 * The view `to` on its way from the layout `from`, at progress p (0..1).
 * Boxes present in both glide to their new place and size; new ones fade
 * in at their place, gone ones fade out at theirs; links fade out early and
 * back in late, since their routes cannot be interpolated.
 */
export function morphView(from, to, p) {
  const old = new Map(from.nodes.map((n) => [n.id, n]))
  const ids = new Set(to.nodes.map((n) => n.id))
  const nodes = to.nodes.map((n) => {
    const a = old.get(n.id)
    if (!a) return { ...n, _o: ramp(p, 0.45, 1) }
    return { ...n, x: mix(a.x, n.x, p), y: mix(a.y, n.y, p), width: mix(a.width, n.width, p), height: mix(a.height, n.height, p) }
  })
  const ghosts = from.nodes.filter((n) => !ids.has(n.id)).map((n) => ({ ...n, _o: 1 - ramp(p, 0, 0.4), _ghost: true }))
  const edges = [
    ...from.edges.map((e) => ({ ...e, _o: 1 - ramp(p, 0, 0.3), _ghost: true })),
    ...to.edges.map((e) => ({ ...e, _o: ramp(p, 0.6, 1) })),
  ]
  return { ...to, nodes: [...ghosts, ...nodes], edges }
}

/**
 * One view in screen transform T. `inner`: drawn inside its opening box (not
 * interactive). `swap` (inner only): `neighbours` (0..1) brings in the boxes
 * drawn around its frame while the parent's own surroundings fade out, so the
 * surroundings dissolve from their old place to their new one instead of
 * blinking out and back in on entering; `glide` moves the content of a group
 * that was unfolded in place from its place in the parent to its place in its
 * own view, so it never fades out or doubles. Generated unfolded scopes keep
 * their coordinates; the glide still handles authored layouts and reshaping.
 */
export function renderLevel(ctx, entry, T, inner, key, swap = {}) {
  const { tree, size, t, onActivate, onOpen, onFold, selectedId, focusId, cand, leaving, morph } = ctx
  const neighbours = swap.neighbours ?? 1
  const glide = swap.glide ?? null
  const v = !inner && morph && morph.id === entry.id ? morphView(morph.from, entry.view, morph.p) : entry.view
  const scope = entry.frame ? entry.frame.id : null
  const context = !inner && ctx.contextFade?.id === entry.id ? ctx.contextFade : null
  const contextWeight = (ids, id) => context && !ids.has(id) ? context.p : 1
  const within = (id) => scope === null || id === scope || id.startsWith(scope + '.')
  const dynamic = v._type === 'dynamic'
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
  /** Inner level: the frame of the view reshapes from the unfolded frame it was in the parent. */
  const reshaped = (n) => {
    const a = inner && n.id === scope ? glide?.from.get(n.id) : null
    const q = a ? glide.p(n.id) : 1
    if (q >= 1) return n
    const P = glide.T
    const ax = (P.s * a.x + P.tx - T.tx) / T.s
    const ay = (P.s * a.y + P.ty - T.ty) / T.s
    return { ...n, x: mix(ax, n.x, q), y: mix(ay, n.y, q), width: mix((P.s * a.width) / T.s, n.width, q), height: mix((P.s * a.height) / T.s, n.height, q) }
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
  const act = inner ? noop : onActivate
  const openIt = inner ? null : onOpen
  const fold = inner ? null : onFold
  const projection = ctx.traceOf?.(entry.view)
  const changeOf = (id) => ctx.changes && Object.hasOwn(ctx.changes.nodes, id) ? ctx.changes.nodes[id] : null
  const nodeWeight = (id) => {
    if ([selectedId, focusId, ctx.containingId].includes(id)) return 1
    return Math.min(!projection || Object.hasOwn(projection.nodes, id) ? 1 : 0.6, !ctx.changes || changeOf(id) ? 1 : 0.78)
  }
  const edgeWeight = (edge) => Math.min(!projection || Object.hasOwn(projection.edges, edge.id) ? 1 : 0.6,
    !ctx.changes || edge.relations?.some((id) => ctx.changedRelations.has(id)) ? 1 : 0.78)
  const own = []
  for (const n0 of nodes.filter(isGroup).sort((a, b) => (a.level ?? 0) - (b.level ?? 0))) {
    const n = reshaped(n0)
    const o = opacityOf(n, n.id) * nodeWeight(n.id) * contextWeight(context?.nodes, n.id)
    // The opening box is kept even when faded out: it stays the click target of its group.
    if (o >= 0.01 || inOpen(n.id)) own.push(faded(o, (n._ghost ? 'x:' : 'g:') + n.id, placed(n, h(GroupView, { node: n, change: changeOf(n.id), t, onActivate: n._ghost ? noop : act, onOpen: n._ghost ? null : openIt, onFold: n._ghost ? null : fold, onChip: n._ghost || inner ? null : ctx.onChip, chip: n._ghost || inner ? null : ctx.chipOf?.(n), selected: n.id === selectedId, focused: !inner && !n._ghost && n.id === focusId, containsSelection: !inner && !n._ghost && n.id === ctx.containingId, revealed: !inner && !n._ghost && n.id === ctx.revealed?.id ? ctx.revealed.token : null }))))
  }
  edges.forEach((e, i) => {
    const o = (e._o ?? 1) * edgeOpacity(e) * edgeWeight(e) * contextWeight(context?.edges, e.id)
    if (o >= 0.01) own.push(faded(o, (e._ghost ? 'y:' : 'e:') + e.id, h(EdgeView, { edge: e, index: i, dynamic, t, onSelect: e._ghost ? noop : act })))
  })
  for (const n of nodes) {
    if (isGroup(n)) continue
    const o = opacityOf(n, n.id) * nodeWeight(n.id) * contextWeight(context?.nodes, n.id)
    if (o < 0.01 && !inOpen(n.id)) continue
    // A neighbour drawn around the frame (another branch of the diagram) is not opened from here.
    own.push(faded(o, (n._ghost ? 'x:' : 'n:') + n.id, placed(n, h(NodeView, { node: n, change: changeOf(n.id), t, onActivate: n._ghost ? noop : act, onOpen: n._ghost ? null : openIt, onChip: n._ghost || inner ? null : ctx.onChip, chip: n._ghost || inner ? null : ctx.chipOf?.(n), selected: n.id === selectedId, focused: !inner && !n._ghost && n.id === focusId, containsSelection: !inner && !n._ghost && n.id === ctx.containingId, revealed: !inner && !n._ghost && n.id === ctx.revealed?.id ? ctx.revealed.token : null, outside: !within(n.id) }))))
  }
  const out = [h('g', { key: key + ':own', transform: svgTf(T) }, ...own)]
  for (const open of opens) {
    // A gliding view is shown at once: its boxes start exactly where the parent drew them.
    const o = (open.glide ? 1 : open.reveal) * dim(open)
    if (o < 0.01) continue
    out.push(h('g', { key: key + ':open:' + open.entry.id, opacity: o >= 0.999 ? undefined : o, style: { pointerEvents: 'none' } },
      ...renderLevel(ctx, open.entry, open.T, true, key + '>' + open.entry.id, { neighbours: open.fade, glide: open.glide })))
  }
  return out
}
