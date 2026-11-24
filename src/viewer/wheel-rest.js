import { animate, reducedMotion } from './animation.js'
import { wheelRestCam, settle } from './zoom-scope.js'
import { zoomPath, toU, fromU, ease } from './zoom-path.js'

export function cancelWheelRest(s) {
  if (!s.wheelRest) return
  clearTimeout(s.wheelRest.timer)
  if (s.fly === s.wheelRest) s.fly = null
  s.wheelRest = null
}

export function pauseWheel(s, bump, fadeContext) {
  cancelWheelRest(s)
  const token = { timer: null }
  s.wheelRest = token
  const begin = () => {
    if (s.wheelRest !== token) return
    // Let an already-started arrival catch up before settling its geometry.
    if (s.arriving) { token.timer = setTimeout(begin, 32); return }
    const to = wheelRestCam(s)
    if (!to) { s.wheelRest = null; return }
    const path = zoomPath(toU(s.cam, s.size), toU(to, s.size))
    s.fly = token
    animate(s, token, reducedMotion() ? 0 : 180, (p) => {
      s.cam = fromU(path(ease(p)), s.size)
      bump()
    }, () => {
      s.cam = to
      s.fly = null
      s.wheelRest = null
      settle(s)
      fadeContext()
      bump()
    })
  }
  token.timer = setTimeout(begin, 160)
}
