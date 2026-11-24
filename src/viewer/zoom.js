// @ts-check
/**
 * @typedef {import('../core/types.js').Tree} Tree
 * @typedef {import('../core/types.js').Entry} Entry
 * @typedef {import('../core/types.js').Cam} Cam
 * @typedef {import('../core/types.js').Size} Size
 * @typedef {import('../core/types.js').Result} Result
 * @typedef {import('../core/types.js').Rect} Rect
 */
// Semantic zoom geometry: the zoom tree, the opening curve of a group, the
// camera transforms between a view and the view of a group drawn inside it,
// and smooth camera flights.
// The whole diagram is one zoomable canvas. Zooming on a collapsed group makes
// it grow faster than the rest and drift to the centre while its own view
// fades in and the rest of the diagram fades out; once it fills the stage the
// camera is inside the group's view. Collapsed groups reverse that motion
// on leaving. Unfolded generated scopes share coordinates;
// their additional parent context fades back in on exit.
// A transform is {s, tx, ty}: p ↦ s·p + t.

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

export const FIT_PAD = 24
/** Share of the stage a group's frame covers at least when its view is framed. */
export const FRAME_MIN = 0.56
/** Scale at which all of a view's bounds (frame and neighbours) fit the stage. */
const allBounds = (e, size) => {
  const b = e.view.bounds
  return Math.min((size.w - FIT_PAD * 2) / Math.max(b.width, 1), (size.h - FIT_PAD * 2) / Math.max(b.height, 1))
}
/** `allBounds`, boxes drawn at most at 120 %. */
export const boundsScale = (e, size) => Math.min(allBounds(e, size), 1.2)
/**
 * Scale of the user-facing fit before its leaving floor. Inside a group whose
 * frame would cover less than FRAME_MIN at `boundsScale` (a single box), the
 * view grows past 120 % until it does, as far as its bounds still fit:
 * otherwise it is entered as a small island in an empty stage.
 */
function fitScale(e, size) {
  const k = boundsScale(e, size)
  if (!e.parent || !e.frame) return k
  return Math.max(k, Math.min(allBounds(e, size), FRAME_MIN / frac(1, e.frame, size)))
}

/**
 * Internal framing of a view for the opening geometry: inside a group, the
 * frame covers at least 56 % of the stage. It only anchors where a group
 * starts opening in its parent (`geom`); what the user sees as "fit" is
 * `fitView`, which shows every box.
 */
/** @param {Entry} e
 * @param {Size} size */
export function fitLocal(e, size) {
  const b = e.view.bounds
  const k = boundsScale(e, size)
  if (e.parent && e.frame && frac(k, e.frame, size) < FRAME_MIN) return centered((k * FRAME_MIN) / frac(k, e.frame, size), e.frame, size)
  return centered(k, b, size)
}

/** One wheel notch (the stage zooms by exp(0.0015 · 120) per 120-px notch). */
export const NOTCH = Math.exp(0.0015 * 120)
/**
 * How far above its leaving threshold a view's frame must sit at the
 * user-facing fit: a little more than one wheel notch, so zooming out once
 * right after a fit stays in the view.
 */
export const FIT_MARGIN = NOTCH * 1.003

/**
 * The user-facing fit (Fit, f, double-click on empty space, landing in a
 * view): all the view's bounds, frame and neighbours, centred. Inside a
 * group, the frame keeps FIT_MARGIN above the size where the camera would
 * leave the group (`geom.fc`), so fitting never changes the current view and
 * a zoom-out notch right after it stays in place. Only where the frame is
 * very small among its neighbours does that floor win over the bounds; the
 * camera then frames the frame and the farthest neighbours may be cut.
 */
/** @param {Tree} tree
 * @param {string} id
 * @param {Size} size */
export function fitView(tree, id, size) {
  const e = tree.entries.get(id)
  const k = fitScale(e, size)
  if (e.parent && e.frame) {
    const kMin = (geom(tree, id, size).fc * FIT_MARGIN) / frac(1, e.frame, size)
    if (k < kMin * (1 - 1e-9)) return centered(kMin, e.frame, size)
  }
  return centered(k, e.view.bounds, size)
}

/**
 * Camera that reveals `node` in view `id`: never closer than the view's fit
 * (no close-ups), the node centred as far as possible while the view stays
 * framed: on an axis where the bounds fit, they stay entirely in view; where
 * they do not, the stage stays covered by them.
 */
/** @param {Tree} tree
 * @param {string} id
 * @param {Rect} node
 * @param {Size} size */
export function revealCam(tree, id, node, size) {
  const fit = fitView(tree, id, size)
  const k = fit.s
  const b = tree.entries.get(id).view.bounds
  const axis = (length, start, extent, centre) => {
    const want = length / 2 - k * centre
    const lo = length - FIT_PAD - k * (start + extent)
    const hi = FIT_PAD - k * start
    return lo <= hi ? Math.min(hi, Math.max(lo, want)) : Math.min(lo, Math.max(hi, want))
  }
  return { s: k, tx: axis(size.w, b.x, b.width, node.x + node.width / 2), ty: axis(size.h, b.y, b.height, node.y + node.height / 2) }
}

/**
 * Smallest pan {dx, dy} that moves a screen rect `box` clear of the panel
 * rect `panel` (both {l, t, r, b}), keeping it inside the stage; null when
 * they do not intersect or no single-axis pan can clear it.
 */
export function avoidRect(box, panel, size, gap = 12, context = null) {
  if (box.r <= panel.l || box.l >= panel.r || box.b <= panel.t || box.t >= panel.b) return null
  const options = [
    { dx: panel.l - gap - box.r, dy: 0, ok: (d) => box.l + d >= gap },
    { dx: panel.r + gap - box.l, dy: 0, ok: (d) => box.r + d <= size.w - gap },
    { dx: 0, dy: panel.t - gap - box.b, ok: (d) => box.t + d >= gap },
    { dx: 0, dy: panel.b + gap - box.t, ok: (d) => box.b + d <= size.h - gap },
  ].filter((o) => o.ok(o.dx || o.dy) && (!context || (
    (context.l < 0 || context.r > size.w || (context.l + o.dx >= 0 && context.r + o.dx <= size.w)) &&
    (context.t < 0 || context.b > size.h || (context.t + o.dy >= 0 && context.b + o.dy <= size.h))
  )))
  if (!options.length) return null
  options.sort((a, b) => Math.abs(a.dx || a.dy) - Math.abs(b.dx || b.dy))
  return { dx: options[0].dx, dy: options[0].dy }
}

/** Smallest pan to show a keyboard box; oversized boxes are centred, never scaled. */
export function focusPan(box, size, panel = null, gap = 12) {
  const shift = (low, high, limit) => high - low > limit - 2 * gap
    ? (limit - low - high) / 2
    : low < gap ? gap - low : high > limit - gap ? limit - gap - high : 0
  let dx = shift(box.l, box.r, size.w), dy = shift(box.t, box.b, size.h)
  if (panel) {
    const shifted = { l: box.l + dx, r: box.r + dx, t: box.t + dy, b: box.b + dy }
    const clear = avoidRect(shifted, panel, size, gap)
    dx += clear?.dx ?? 0
    dy += clear?.dy ?? 0
  }
  return dx || dy ? { dx, dy } : null
}

/**
 * Camera after the stage changed from size `before` to `after` (a panel
 * opened above it, the window was resized). A view shown at its fit
 * (`fitted`) takes the user-facing fit of the new size: fitView depends on
 * the size only, so opening then closing a panel restores the very same
 * picture. Anything else keeps its scale and the point at the centre.
 */
export function resizeCam(tree, id, cam, before, after, fitted) {
  if (fitted) return fitView(tree, id, after)
  const k = cam.s
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
/** @param {Tree} tree
 * @param {string} cid
 * @param {Size} size */
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
  const inPlace = !!c.view.inPlace
  const rho = inPlace ? 1 : frac(sIn, F, size) / frac(1, N, size)
  // An unfolded group is read in place first: it only starts opening once it
  // nearly fills the stage, so zooming to read it keeps its surroundings.
  const b0 = isGroup(N) ? Math.max(bFit * 1.08, 0.85) : bFit * 1.08
  // An inherited frame does not shrink into a separate layout on entry.
  // Delaying it as long as a remapped frame would already zoom past its kids.
  const bc = inPlace ? Math.max(b0 * 1.1, frac(fitView(tree, c.parent, size).s, N, size) * FIT_MARGIN) : isGroup(N) ? b0 * 1.6 : bFit * 1.9
  const f0 = rho * b0
  // Entered (and left) at about two thirds of the size the frame has at the
  // view's fit, so the user-facing fit (fitView) stays inside.
  const fitted = 0.68 * frac(fitScale(c, size), F, size)
  // Inherited scenes share coordinates with their parent: switching scope
  // needs no camera remapping. A separate exit threshold lets Fit include
  // distant neighbours without immediately backing out of the group.
  const fc = inPlace ? fitted : Math.max(fitted, f0 * 1.15)
  g = { N, F, b0, bc, f0, fc, rho, inPlace }
  tree.geoms.set(key, g)
  return g
}
export const progress = (g, b) => (b <= g.b0 ? 0 : b >= g.bc ? 1 : Math.log(b / g.b0) / Math.log(g.bc / g.b0))
export function phi(g, b) {
  if (g.inPlace) return b
  if (b <= g.b0) return g.rho * b
  if (b >= g.bc) return (g.fc * b) / g.bc
  return g.f0 * Math.pow(g.fc / g.f0, progress(g, b))
}
export function phiInv(g, f) {
  if (g.inPlace) return f
  if (f <= g.f0) return f / g.rho
  if (f >= g.fc) return (g.bc * f) / g.fc
  return g.b0 * Math.pow(g.bc / g.b0, Math.log(f / g.f0) / Math.log(g.fc / g.f0))
}
/**
 * Parent transform → transform of the opening group's view (+ its progress u).
 * `blend` < 1 draws a released group on its way back into its box: 0 is the
 * view fitted in the box, closed, whatever the zoom.
 */
export function childCam(g, T, size, blend = 1, pullOffset = [0, 0]) {
  const b = frac(T.s, g.N, size)
  const u = progress(g, b) * blend
  const w = g.inPlace ? 0 : PULL * u
  const [bx, by] = centerOf(g.N)
  const X = (1 - w) * (T.s * bx + T.tx) + w * (size.w / 2 + pullOffset[0])
  const Y = (1 - w) * (T.s * by + T.ty) + w * (size.h / 2 + pullOffset[1])
  const f = blend >= 1 ? phi(g, b) : g.rho * b * Math.pow(phi(g, b) / (g.rho * b), blend)
  const k = f / frac(1, g.F, size)
  const [fx, fy] = centerOf(g.F)
  return { s: k, tx: X - k * fx, ty: Y - k * fy, u }
}
/** Exact inverse of childCam. */
export function parentCam(g, T, size, pullOffset = [0, 0]) {
  const b = phiInv(g, frac(T.s, g.F, size))
  const w = g.inPlace ? 0 : PULL * progress(g, b)
  const [fx, fy] = centerOf(g.F)
  const X = (T.s * fx + T.tx - w * (size.w / 2 + pullOffset[0])) / (1 - w)
  const Y = (T.s * fy + T.ty - w * (size.h / 2 + pullOffset[1])) / (1 - w)
  const k = b / frac(1, g.N, size)
  const [bx, by] = centerOf(g.N)
  return { s: k, tx: X - k * bx, ty: Y - k * by }
}
export const plain = (T) => ({ s: T.s, tx: T.tx, ty: T.ty })

/**
 * Largest wheel zoom in view `id`: ×4, or two notches past the zoom that
 * enters its last group, which grows with the stage and exceeds ×4 for a
 * group alone in a small frame on a large screen.
 */
export function maxZoom(tree, id, size) {
  let k = 4
  for (const cid of tree.entries.get(id).kids.values()) {
    const g = geom(tree, cid, size)
    k = Math.max(k, (g.bc / frac(1, g.N, size)) * NOTCH * NOTCH)
  }
  return k
}

/** Camera of view `id` after a wheel step of `dy` pixels around the stage point [px, py]. */
export function wheelZoom(tree, id, cam, size, dy, pinch, [px, py]) {
  const minK = tree.entries.get(id).parent ? 0 : fitView(tree, id, size).s * 0.3
  // Free-spin wheels and page-mode bursts must not skip several scope thresholds at once.
  const step = Math.max(-0.9, Math.min(0.9, dy * (pinch ? 0.01 : 0.0015)))
  const k = Math.min(maxZoom(tree, id, size), Math.max(minK, cam.s * Math.exp(-step)))
  const ratio = k / cam.s
  return { s: k, tx: px - (px - cam.tx) * ratio, ty: py - (py - cam.ty) * ratio }
}
