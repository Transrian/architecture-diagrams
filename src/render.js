// Drawing one level of the zoom tree (and, recursively, the group opening
// inside it), plus the layout transition shown when a view is laid out anew
// (a group unfolded or folded back, a diagram update, another direction).
import * as React from 'react'
import { NodeView, GroupView, EdgeView } from './shapes.js'
import { ramp, svgTf, isGroup, frac, geom, childCam, plain } from './zoom.js'

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
 * One view in screen transform T. `inner`: drawn inside its opening box
 * (frame and content only, not interactive). Otherwise its neighbours fade
 * in just after entering, and everything but the opening group fades out
 * while it opens.
 */
export function renderLevel(ctx, entry, T, inner, key) {
  const { tree, size, t, onActivate, onOpen, onFold, selectedId, focusId, cand, morph } = ctx
  const v = !inner && morph && morph.id === entry.id ? morphView(morph.from, entry.view, morph.p) : entry.view
  const scope = entry.frame ? entry.frame.id : null
  const within = (id) => scope === null || id === scope || id.startsWith(scope + '.')
  const dynamic = v._type === 'dynamic'
  let open = null
  if (!inner && cand && tree.entries.get(cand)?.parent === entry.id) {
    const c = tree.entries.get(cand)
    const ct = childCam(geom(tree, cand, size), T, size)
    open = { id: c.box.id, entry: c, T: plain(ct), reveal: ramp(ct.u, 0, 0.25), fade: ramp(ct.u, 0.25, 1) }
  }
  // The opening group: its box (and, unfolded, its content) gives way to its own view.
  const inOpen = (id) => !!open && (id === open.id || id.startsWith(open.id + '.'))
  const beta = open ? 1 - open.fade : 1
  const alpha = inner || !entry.parent ? 1 : (() => {
    const g = geom(tree, entry.id, size)
    return ramp(frac(T.s, entry.frame, size), g.fc, g.fc * 1.15)
  })()
  const opacityOf = (x, id) => (x._o ?? 1) * (inner ? 1 : inOpen(id) ? 1 - open.reveal : beta * (within(id) ? 1 : alpha))
  const nodes = inner ? v.nodes.filter((n) => within(n.id)) : v.nodes
  const edges = inner ? v.edges.filter((e) => within(e.source) && within(e.target) && e.source !== scope && e.target !== scope) : v.edges
  const act = inner ? noop : onActivate
  const openIt = inner ? null : onOpen
  const fold = inner ? null : onFold
  const projection = ctx.traceOf?.(entry.view)
  const nodeWeight = (id) => !projection || Object.hasOwn(projection.nodes, id) || [selectedId, focusId, ctx.containingId].includes(id) ? 1 : 0.6
  const edgeWeight = (id) => !projection || Object.hasOwn(projection.edges, id) ? 1 : 0.6
  const own = []
  for (const n of nodes.filter(isGroup).sort((a, b) => (a.level ?? 0) - (b.level ?? 0))) {
    const o = opacityOf(n, n.id) * nodeWeight(n.id)
    // The opening box is kept even when faded out: it stays the click target of its group.
    if (o >= 0.01 || inOpen(n.id)) own.push(faded(o, (n._ghost ? 'x:' : 'g:') + n.id, h(GroupView, { node: n, t, onActivate: n._ghost ? noop : act, onOpen: n._ghost ? null : openIt, onFold: n._ghost ? null : fold, selected: n.id === selectedId, focused: !inner && !n._ghost && n.id === focusId, containsSelection: !inner && !n._ghost && n.id === ctx.containingId, revealed: !inner && !n._ghost && n.id === ctx.revealed?.id ? ctx.revealed.token : null })))
  }
  edges.forEach((e, i) => {
    const o = (e._o ?? 1) * (inner ? 1 : inOpen(e.source) && inOpen(e.target) ? 1 - open.reveal : beta * (within(e.source) && within(e.target) ? 1 : alpha)) * edgeWeight(e.id)
    if (o >= 0.01) own.push(faded(o, (e._ghost ? 'y:' : 'e:') + e.id, h(EdgeView, { edge: e, index: i, dynamic, t, onSelect: e._ghost ? noop : act })))
  })
  for (const n of nodes) {
    if (isGroup(n)) continue
    const o = opacityOf(n, n.id) * nodeWeight(n.id)
    if (o < 0.01 && !inOpen(n.id)) continue
    // A neighbour drawn around the frame (another branch of the diagram) is not opened from here.
    own.push(faded(o, (n._ghost ? 'x:' : 'n:') + n.id, h(NodeView, { node: n, t, onActivate: n._ghost ? noop : act, onOpen: n._ghost ? null : openIt, selected: n.id === selectedId, focused: !inner && !n._ghost && n.id === focusId, containsSelection: !inner && !n._ghost && n.id === ctx.containingId, revealed: !inner && !n._ghost && n.id === ctx.revealed?.id ? ctx.revealed.token : null, outside: !within(n.id) })))
  }
  const out = [h('g', { key: key + ':own', transform: svgTf(T) }, ...own)]
  if (open && open.reveal > 0) {
    out.push(h('g', { key: key + ':open:' + open.entry.id, opacity: open.reveal >= 0.999 ? undefined : open.reveal, style: { pointerEvents: 'none' } },
      ...renderLevel(ctx, open.entry, open.T, true, key + '>')))
  }
  return out
}
