// Drawing one level of the zoom tree (and, recursively, the group opening
// inside it), plus the layout transition shown when a view is laid out anew
// (a group unfolded or folded back, a diagram update, another direction).
import * as React from 'react'
import { NodeView } from './node-view.js'
import { GroupView } from './group-view.js'
import { EdgeView } from './edge-view.js'
import { ramp, svgTf, isGroup } from './zoom.js'

import { levelOpacity } from './render-opacity.js'
import { levelPlacement } from './render-placement.js'

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
  const { t, onActivate, onOpen, onFold, selectedId, focusId, morph } = ctx
  const neighbours = swap.neighbours ?? 1
  const glide = swap.glide ?? null
  const v = !inner && morph && morph.id === entry.id ? morphView(morph.from, entry.view, morph.p) : entry.view
  const scope = entry.frame ? entry.frame.id : null
  const context = !inner && ctx.contextFade?.id === entry.id ? ctx.contextFade : null
  const contextWeight = (ids, id) => (context && !ids.has(id) ? context.p : 1)
  const within = (id) => scope === null || id === scope || id.startsWith(scope + '.')
  const dynamic = v._type === 'dynamic'
  const { opens, inOpen, dim, opacityOf, nodes, edges, edgeOpacity } = levelOpacity(ctx, entry, T, inner, v, scope, neighbours, glide)
  const { reshaped, placed } = levelPlacement(T, inner, scope, glide)
  const act = inner ? noop : onActivate
  const openIt = inner ? null : onOpen
  const fold = inner ? null : onFold
  const projection = ctx.traceOf?.(entry.view)
  const changeOf = (id) => (ctx.changes && Object.hasOwn(ctx.changes.nodes, id) ? ctx.changes.nodes[id] : null)
  const nodeWeight = (id) => {
    if ([selectedId, focusId, ctx.containingId].includes(id)) return 1
    return Math.min(!projection || Object.hasOwn(projection.nodes, id) ? 1 : 0.6, !ctx.changes || changeOf(id) ? 1 : 0.78)
  }
  const edgeWeight = (edge) =>
    Math.min(
      !projection || Object.hasOwn(projection.edges, edge.id) ? 1 : 0.6,
      !ctx.changes || edge.relations?.some((id) => ctx.changedRelations.has(id)) ? 1 : 0.78,
    )
  const own = []
  for (const n0 of nodes.filter(isGroup).sort((a, b) => (a.level ?? 0) - (b.level ?? 0))) {
    const n = reshaped(n0)
    const o = opacityOf(n, n.id) * nodeWeight(n.id) * contextWeight(context?.nodes, n.id)
    // The opening box is kept even when faded out: it stays the click target of its group.
    if (o >= 0.01 || inOpen(n.id))
      own.push(
        faded(
          o,
          (n._ghost ? 'x:' : 'g:') + n.id,
          placed(
            n,
            h(GroupView, nodeProps(ctx, n, inner, act, openIt, fold, changeOf, within)),
          ),
        ),
      )
  }
  edges.forEach((e, i) => {
    const o = (e._o ?? 1) * edgeOpacity(e) * edgeWeight(e) * contextWeight(context?.edges, e.id)
    if (o >= 0.01)
      own.push(faded(o, (e._ghost ? 'y:' : 'e:') + e.id, h(EdgeView, { edge: e, index: i, dynamic, t, onSelect: e._ghost ? noop : act })))
  })
  for (const n of nodes) {
    if (isGroup(n)) continue
    const o = opacityOf(n, n.id) * nodeWeight(n.id) * contextWeight(context?.nodes, n.id)
    if (o < 0.01 && !inOpen(n.id)) continue
    // A neighbour drawn around the frame (another branch of the diagram) is not opened from here.
    own.push(
      faded(
        o,
        (n._ghost ? 'x:' : 'n:') + n.id,
        placed(
          n,
          h(NodeView, nodeProps(ctx, n, inner, act, openIt, fold, changeOf, within)),
        ),
      ),
    )
  }
  const out = [h('g', { key: key + ':own', transform: svgTf(T) }, ...own)]
  for (const open of opens) {
    // A gliding view is shown at once: its boxes start exactly where the parent drew them.
    const o = (open.glide ? 1 : open.reveal) * dim(open)
    if (o < 0.01) continue
    out.push(
      h(
        'g',
        { key: key + ':open:' + open.entry.id, opacity: o >= 0.999 ? undefined : o, style: { pointerEvents: 'none' } },
        ...renderLevel(ctx, open.entry, open.T, true, key + '>' + open.entry.id, { neighbours: open.fade, glide: open.glide }),
      ),
    )
  }
  return out
}

function nodeProps(ctx, n, inner, act, openIt, fold, changeOf, within) {
  return {
    node: n, change: changeOf(n.id), t: ctx.t,
    onActivate: n._ghost ? noop : act,
    onOpen: n._ghost ? null : openIt,
    onFold: n._ghost ? null : fold,
    onChip: n._ghost || inner ? null : ctx.onChip,
    chip: n._ghost || inner ? null : ctx.chipOf?.(n),
    selected: n.id === ctx.selectedId,
    focused: !inner && !n._ghost && n.id === ctx.focusId,
    containsSelection: !inner && !n._ghost && n.id === ctx.containingId,
    revealed: !inner && !n._ghost && n.id === ctx.revealed?.id ? ctx.revealed.token : null,
    outside: !within(n.id),
  }
}
