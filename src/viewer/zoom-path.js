// @ts-check
/**
 * @typedef {import('../core/types.js').Cam} Cam
 * @typedef {import('../core/types.js').Size} Size
 */
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
