// Shared scheduling for camera flights, layout morphs and scoped-context fades.
export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A queued frame's timestamp can predate an input handler's performance.now().
export const frameProgress = (start, now, durationMs) => durationMs ? Math.max(0, Math.min(1, (now - start) / durationMs)) : 1

export function animate(s, token, durationMs, onFrame, onEnd) {
  const start = performance.now()
  const step = (now) => {
    if (s.fly !== token && s.morph !== token && s.contextFade !== token) return
    const p = frameProgress(start, now, durationMs)
    if (p >= 1) onEnd()
    else {
      onFrame(p)
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}
