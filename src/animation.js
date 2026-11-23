// Shared scheduling for camera flights, layout morphs and scoped-context fades.
export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function animate(s, token, durationMs, onFrame, onEnd) {
  const start = performance.now()
  const step = (now) => {
    if (s.fly !== token && s.morph !== token && s.contextFade !== token) return
    const p = durationMs ? Math.min(1, (now - start) / durationMs) : 1
    if (p >= 1) onEnd()
    else {
      onFrame(p)
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}
