// Semantic zoom geometry: the zoom tree, the opening curve of a group, the
// camera transforms between a view and the view of a group drawn inside it,
// and smooth camera flights.
// The whole diagram is one zoomable canvas. Zooming on a collapsed group makes
// it grow faster than the rest and drift to the centre while its own view
// fades in and the rest of the diagram fades out; once it fills the stage the
// camera is inside the group's view. Leaving is the exact inverse, so both
// directions are continuous. A transform is {s, tx, ty}: p ↦ s·p + t.

export const PULL = 0.6 // how far an opening group drifts towards the stage centre
export const ARRIVE_FROM = 0.02 // progress above which a newly picked group animates open
export const ramp = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)))
export const svgTf = (m) => `translate(${m.tx},${m.ty}) scale(${m.s})`
export const isGroup = (n) => n.children && n.children.length > 0
/** Fraction of the stage a rect covers at scale k (max of the width and height ratios). */
export const frac = (k, r, size) => Math.max((r.width * k) / size.w, (r.height * k) / size.h)
export const centerOf = (r) => [r.x + r.width / 2, r.y + r.height / 2]
export function holds(T, r, [px, py]) {
  const x = T.s * r.x + T.tx
  const y = T.s * r.y + T.ty
  return px >= x && px <= x + r.width * T.s && py >= y && py <= y + r.height * T.s
}
export const centered = (k, r, size) => {
  const [cx, cy] = centerOf(r)
  return { s: k, tx: size.w / 2 - k * cx, ty: size.h / 2 - k * cy }
}

/**
 * Zoom tree: the root view (overview, the only schema, or a flow) and the
 * view of every group drawn inside a view's frame, collapsed or unfolded
 * in place (zooming into an unfolded group enters its own view). Neighbours
 * drawn around a frame are not children: they belong to another branch.
 */
export function buildTree(result, rootId, standalone) {
  const byId = new Map(result.views.map((v) => [v.id, v]))
  const rootView = byId.get(rootId)
  if (!rootView) return null
  const frameOf = (v) => (v.viewOf ? v.nodes.find((n) => n.id === v.viewOf && isGroup(n)) ?? null : null)
  const root = { id: rootId, view: rootView, parent: null, frame: frameOf(rootView), box: null, kids: new Map() }
  const entries = new Map([[rootId, root]])
  const queue = standalone ? [] : [root]
  while (queue.length) {
    const e = queue.shift()
    const scope = e.frame ? e.frame.id : null
    for (const n of e.view.nodes) {
      if (!n.drill || (n.parent ?? null) !== scope || entries.has(n.drill)) continue
      const w = byId.get(n.drill)
      if (!w || w._type === 'dynamic') continue
      const frame = w.nodes.find((m) => m.id === n.id && isGroup(m))
      if (!frame) continue
      const child = { id: w.id, view: w, parent: e.id, frame, box: n, kids: new Map() }
      entries.set(w.id, child)
      e.kids.set(n.id, w.id)
      queue.push(child)
    }
  }
  return { root, entries, geoms: new Map() }
}

export function pathOf(tree, id) {
  const out = []
  for (let e = tree.entries.get(id); e; e = e.parent ? tree.entries.get(e.parent) : null) out.unshift(e.id)
  return out
}

/** Transform that frames a view; inside a group, the frame covers at least 56 % of the stage. */
export function fitLocal(e, size) {
  const b = e.view.bounds
  const pad = 24
  const k = Math.min((size.w - pad * 2) / Math.max(b.width, 1), (size.h - pad * 2) / Math.max(b.height, 1), 1.2)
  if (e.parent && e.frame && frac(k, e.frame, size) < 0.56) return centered((k * 0.56) / frac(k, e.frame, size), e.frame, size)
  return centered(k, b, size)
}

/**
 * Camera after the stage changed from size `before` to `after` (a panel
 * opened above it, the sidebar was resized). The point at the centre stays
 * at the centre; a view shown at its fit (`fitted`) takes the fit scale of
 * the new size, anything else keeps its scale. Keeping the centre even when
 * refitting avoids a sideways jump where fitLocal switches between framing
 * the bounds and the frame, and makes opening then closing a panel restore
 * the same picture.
 */
export function resizeCam(e, cam, before, after, fitted) {
  const k = fitted ? fitLocal(e, after).s : cam.s
  const cx = (before.w / 2 - cam.tx) / cam.s
  const cy = (before.h / 2 - cam.ty) / cam.s
  return { s: k, tx: after.w / 2 - k * cx, ty: after.h / 2 - k * cy }
}

/**
 * Opening curve of one group, in stage fractions: b = size of its box in
 * the parent view, f = size of its frame in its own view. Up to b0 (just
 * past the parent's fit; an unfolded group: once it nearly fills the stage) f = rho·b, the group's view fitted in its box;
 * between b0 and bc it grows geometrically up to fc, about two thirds of
 * its own fit, where the camera enters it.
 */
export function geom(tree, cid, size) {
  const key = cid + '@' + size.w + 'x' + size.h
  let g = tree.geoms.get(key)
  if (g) return g
  const c = tree.entries.get(cid)
  const N = c.box
  const F = c.frame
  const bFit = frac(fitLocal(tree.entries.get(c.parent), size).s, N, size)
  const pad = Math.min(N.width, N.height) * 0.08
  const sIn = Math.min((N.width - 2 * pad) / Math.max(F.width, 1), (N.height - 2 * pad) / Math.max(F.height, 1))
  const rho = frac(sIn, F, size) / frac(1, N, size)
  // An unfolded group is read in place first: it only starts opening once it
  // nearly fills the stage, so zooming to read it keeps its surroundings.
  const b0 = isGroup(N) ? Math.max(bFit * 1.08, 0.85) : bFit * 1.08
  const bc = isGroup(N) ? b0 * 1.6 : bFit * 1.9
  const f0 = rho * b0
  const fc = Math.max(0.68 * frac(fitLocal(c, size).s, F, size), f0 * 1.3)
  g = { N, F, b0, bc, f0, fc, rho }
  tree.geoms.set(key, g)
  return g
}
export const progress = (g, b) => (b <= g.b0 ? 0 : b >= g.bc ? 1 : Math.log(b / g.b0) / Math.log(g.bc / g.b0))
export function phi(g, b) {
  if (b <= g.b0) return g.rho * b
  if (b >= g.bc) return (g.fc * b) / g.bc
  return g.f0 * Math.pow(g.fc / g.f0, progress(g, b))
}
export function phiInv(g, f) {
  if (f <= g.f0) return f / g.rho
  if (f >= g.fc) return (g.bc * f) / g.fc
  return g.b0 * Math.pow(g.bc / g.b0, Math.log(f / g.f0) / Math.log(g.fc / g.f0))
}
/**
 * Parent transform → transform of the opening group's view (+ its progress u).
 * `blend` < 1 draws a released group on its way back into its box: 0 is the
 * view fitted in the box, closed, whatever the zoom.
 */
export function childCam(g, T, size, blend = 1) {
  const b = frac(T.s, g.N, size)
  const u = progress(g, b) * blend
  const w = PULL * u
  const [bx, by] = centerOf(g.N)
  const X = (1 - w) * (T.s * bx + T.tx) + (w * size.w) / 2
  const Y = (1 - w) * (T.s * by + T.ty) + (w * size.h) / 2
  const f = blend >= 1 ? phi(g, b) : g.rho * b * Math.pow(phi(g, b) / (g.rho * b), blend)
  const k = f / frac(1, g.F, size)
  const [fx, fy] = centerOf(g.F)
  return { s: k, tx: X - k * fx, ty: Y - k * fy, u }
}
/** Exact inverse of childCam. */
export function parentCam(g, T, size) {
  const b = phiInv(g, frac(T.s, g.F, size))
  const w = PULL * progress(g, b)
  const [fx, fy] = centerOf(g.F)
  const X = (T.s * fx + T.tx - (w * size.w) / 2) / (1 - w)
  const Y = (T.s * fy + T.ty - (w * size.h) / 2) / (1 - w)
  const k = b / frac(1, g.N, size)
  const [bx, by] = centerOf(g.N)
  return { s: k, tx: X - k * bx, ty: Y - k * by }
}
export const plain = (T) => ({ s: T.s, tx: T.tx, ty: T.ty })

/** How far the drawing of an opening group has caught up with the zoom (1: fully). */
export const blendOf = (S, id) => (S.arriving?.id === id ? S.arriving.blend : 1)

/**
 * Whether a stage point is on the opening group (`S.cand`) as drawn: its box
 * while it still shows, or its own view drifting out of it.
 */
export function onOpening(S, point) {
  if (!S.cand) return false
  const g = geom(S.tree, S.cand, S.size)
  const ct = childCam(g, S.cam, S.size, blendOf(S, S.cand))
  return (ct.u < 0.25 && holds(S.cam, g.N, point)) || holds(ct, g.F, point)
}

/**
 * After the camera moved: leave groups whose frame got too small, follow
 * the opening group (`cand`, the one under the zoom anchor), enter it when
 * it is fully open. A group picked when it is already partly open would
 * jump open: it is marked `arriving` (blend 0, `fresh`) for the caller to
 * animate, and is not entered before its drawing has caught up.
 */
export function settle(S, enter = true) {
  const { tree, size } = S
  for (let guard = 0; guard < 16; guard++) {
    const e = tree.entries.get(S.focus)
    if (!e.parent) break
    const g = geom(tree, e.id, size)
    if (frac(S.cam.s, e.frame, size) >= g.fc) break
    S.cam = parentCam(g, S.cam, size)
    S.cand = e.id
    if (S.arriving?.id === e.id) S.arriving = null
    S.focus = e.parent
  }
  for (let guard = 0; guard < 16; guard++) {
    const e = tree.entries.get(S.focus)
    if (S.cand && tree.entries.get(S.cand)?.parent !== S.focus) S.cand = null
    if (!S.cand && enter) {
      const anchor = S.anchor ?? [S.size.w / 2, S.size.h / 2]
      for (const cid of e.kids.values()) {
        // A group just released by zooming beside it does not reopen under the pointer.
        if (cid === S.leaving?.id) continue
        const g = geom(tree, cid, size)
        const b = frac(S.cam.s, g.N, size)
        if (b > g.b0 && holds(S.cam, g.N, anchor)) {
          S.cand = cid
          S.arriving = progress(g, b) > ARRIVE_FROM ? { id: cid, blend: 0, fresh: true } : null
          break
        }
      }
    }
    if (!S.cand) break
    const g = geom(tree, S.cand, size)
    const b = frac(S.cam.s, g.N, size)
    if (b <= g.b0) {
      S.cand = null
      break
    }
    if (b < g.bc || !enter || blendOf(S, S.cand) < 1) break
    S.cam = plain(childCam(g, S.cam, size))
    S.focus = S.cand
    S.cand = null
  }
}

// Smooth zoom-and-pan path (van Wijk & Nuij 2003, as in d3-interpolate),
// on [centre x, centre y, visible width].
export const toU = (cam, size) => [(size.w / 2 - cam.tx) / cam.s, (size.h / 2 - cam.ty) / cam.s, size.w / cam.s]
export function fromU([ux, uy, w], size) {
  const s = size.w / w
  return { s, tx: size.w / 2 - s * ux, ty: size.h / 2 - s * uy }
}
export function zoomPath([ux0, uy0, w0], [ux1, uy1, w1]) {
  const rho = Math.SQRT2
  const dx = ux1 - ux0
  const dy = uy1 - uy0
  const d1 = Math.hypot(dx, dy)
  if (d1 < 1e-6 * Math.min(w0, w1)) {
    const S = Math.log(w1 / w0) / rho
    const f = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)]
    f.duration = Math.abs(S) * 1000
    return f
  }
  const b0 = (w1 * w1 - w0 * w0 + 4 * d1 * d1) / (4 * w0 * d1)
  const b1 = (w1 * w1 - w0 * w0 - 4 * d1 * d1) / (4 * w1 * d1)
  const r0 = -Math.asinh(b0)
  const r1 = -Math.asinh(b1)
  const S = (r1 - r0) / rho
  const f = (t) => {
    const s = t * S
    const u = (w0 / (2 * d1)) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0))
    return [ux0 + u * dx, uy0 + u * dy, (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0)]
  }
  f.duration = Math.abs(S) * 1000
  return f
}
export const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
