import { cancelWheelRest } from './wheel-rest.js'
import { useCallback } from 'react'
import { animate, reducedMotion, frameProgress } from './animation.js'
import { geom, childCam } from './zoom.js'
import { blendOf, settle } from './zoom-scope.js'
import { ease } from './zoom-path.js'

const LEAVE_MS = 260
const ARRIVE_MS = 300
export function useStageTransitions(st, bump) {
  /** Let go of the opening group: it folds back over LEAVE_MS at the current zoom. */
  const release = useCallback((id) => releaseGroup(st.current, bump, id), [])

  const fadeContext = useCallback(() => fadeContextGroup(st.current, bump), [])

  /**
   * A group picked under the pointer when it is already partly open (the
   * zoom went past its opening start elsewhere) opens over ARRIVE_MS from its
   * closed box instead of jumping; it is entered only once it has caught up.
   */
  const arrive = useCallback(() => arriveGroup(st.current, bump, fadeContext), [])

  const cancelFly = useCallback(() => {
    const s = st.current
    cancelWheelRest(s)
    if (!s.fly) return
    s.fly = null
    if (s.cand) release(s.cand)
    else s.leaving = null
    s.arriving = null
  }, [])

  return { release, fadeContext, arrive, cancelFly }
}

function releaseGroup(s, bump, id) {
    const g = geom(s.tree, id, s.size)
    const from = blendOf(s, id) // it may not have finished arriving
    const u = childCam(g, s.cam, s.size, from, s.pullOffset).u
    s.cand = null
    if (s.arriving?.id === id) s.arriving = null
    if (u <= 0) {
      s.leaving = null
      s.pullOffset = [0, 0]
      return
    }
    // Even without motion the token lives until the next frame, so the rest of
    // this wheel event cannot pick the same group again under the pointer.
    const ms = reducedMotion() ? 0 : LEAVE_MS
    const token = { id, blend: ms ? from : 0 }
    s.leaving = token
    const start = performance.now()
    const step = (now) => {
      if (s.leaving !== token) return
      const p = frameProgress(start, now, ms)
      token.blend = from * (1 - ease(p))
      if (p >= 1) {
        s.leaving = null
        if (!s.cand) s.pullOffset = [0, 0]
      }
      else requestAnimationFrame(step)
      bump()
    }
    requestAnimationFrame(step)
}

function fadeContextGroup(s, bump) {
    const token = s.contextFade
    if (!token?.fresh) return
    token.fresh = false
    if (reducedMotion()) { s.contextFade = null; return }
    animate(s, token, LEAVE_MS, (p) => {
      token.p = ease(p)
      bump()
    }, () => {
      s.contextFade = null
      bump()
    })
}

function arriveGroup(s, bump, fadeContext) {
    const token = s.arriving
    if (!token?.fresh) return
    token.fresh = false
    const ms = reducedMotion() ? 0 : ARRIVE_MS
    const done = () => {
      s.arriving = null
      settle(s)
      fadeContext()
      bump()
    }
    if (!ms) return done()
    const start = performance.now()
    const step = (now) => {
      if (s.arriving !== token) return
      const p = frameProgress(start, now, ms)
      token.blend = ease(p)
      if (p >= 1) done()
      else {
        requestAnimationFrame(step)
        bump()
      }
    }
    requestAnimationFrame(step)
}
