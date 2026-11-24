// @ts-check
import { parentCam, geom, childCam, holds, frac, progress, ARRIVE_FROM, plain } from './zoom.js'

// Wheel and scripted exits must restore the same parent context.
export function exitScope(S, entry) {
  const pending = S.contextFade?.id === entry.id ? S.contextFade : null
  S.contextFade = entry.view.inPlace
    ? {
        id: entry.parent,
        nodes: pending?.nodes ?? new Set(entry.view.nodes.map((n) => n.id)),
        edges: pending?.edges ?? new Set(entry.view.edges.map((edge) => edge.id)),
        p: 0,
        fresh: true,
      }
    : null
  S.cam = parentCam(geom(S.tree, entry.id, S.size), S.cam, S.size)
  S.focus = entry.parent
  S.cand = entry.id
  if (S.arriving?.id === entry.id) S.arriving = null
}

/** How far the drawing of an opening group has caught up with the zoom (1: fully). */
export const blendOf = (S, id) => (S.arriving?.id === id ? S.arriving.blend : 1)

/**
 * Whether a stage point is on the opening group (`S.cand`): its box (where the
 * zoom is aimed), or its own view drifting out of it.
 */
export function onOpening(S, point) {
  if (!S.cand) return false
  const g = geom(S.tree, S.cand, S.size)
  const ct = childCam(g, S.cam, S.size, blendOf(S, S.cand))
  // Zooming keeps the aimed point under the pointer, so the box stays a valid
  // target even once its view has drifted towards the centre without it.
  return holds(S.cam, g.N, point) || holds(ct, g.F, point)
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
    exitScope(S, e)
  }
  for (let guard = 0; guard < 16; guard++) {
    const e = tree.entries.get(S.focus)
    if (S.cand && tree.entries.get(S.cand)?.parent !== S.focus) S.cand = null
    if (!S.cand && enter) {
      const anchor = S.anchor ?? [S.size.w / 2, S.size.h / 2]
      for (const cid of e.kids.values()) {
        // A group just released by zooming beside it does not reopen under the pointer.
        if (cid === S.leaving?.id) continue
        // Nor does one released earlier in this gesture, until the pointer leaves its box.
        if (cid === S.released) continue
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
    S.contextFade = null
    S.cand = null
  }
}

/** Camera at the nearest end of an opening; free zoom outside it is unchanged. */
export function wheelRestCam(S) {
  if (!S.cand) return null
  const g = geom(S.tree, S.cand, S.size)
  const u = progress(g, frac(S.cam.s, g.N, S.size))
  if (u <= 0 || u >= 1) return null
  const k = (u < 0.5 ? g.b0 * (1 - 1e-9) : g.bc * (1 + 1e-9)) / frac(1, g.N, S.size)
  const [x, y] = S.anchor ?? [S.size.w / 2, S.size.h / 2]
  const ratio = k / S.cam.s
  return { s: k, tx: x - (x - S.cam.tx) * ratio, ty: y - (y - S.cam.ty) * ratio }
}
