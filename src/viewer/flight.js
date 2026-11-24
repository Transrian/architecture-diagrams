// Execute a plan one segment at a time; each segment owns its scope changes.
import { cancelWheelRest } from './wheel-rest.js'
import { animate, reducedMotion } from './animation.js'
import { geom, centered, frac, fitView, revealCam, plain, childCam } from './zoom.js'
import { exitScope } from './zoom-scope.js'
import { zoomPath, toU, fromU, ease } from './zoom-path.js'
import { planFlight } from './flight-plan.js'

function segmentEnd(s, segment) {
  const entry = s.tree.entries.get(segment.id)
  if (segment.kind === 'exit') {
    return centered((geom(s.tree, segment.id, s.size).fc * 0.99) / frac(1, entry.frame, s.size), entry.frame, s.size)
  }
  if (segment.kind === 'enter') {
    const g = geom(s.tree, segment.id, s.size)
    return centered((g.bc * 1.01) / frac(1, g.N, s.size), g.N, s.size)
  }
  const node = segment.elementId && entry.view.nodes.find((item) => item.id === segment.elementId)
  return !node || node.id === entry.frame?.id
    ? fitView(s.tree, segment.id, s.size)
    : revealCam(s.tree, segment.id, node, s.size)
}

function finishSegment(s, segment, fadeContext, final) {
  if (segment.kind === 'exit') {
    exitScope(s, s.tree.entries.get(segment.id))
    fadeContext()
  } else if (segment.kind === 'enter') {
    s.cam = plain(childCam(geom(s.tree, segment.id, s.size), s.cam, s.size, 1, s.pullOffset))
    s.pullOffset = [0, 0]
    s.focus = segment.id
    s.cand = null
  } else if (final) { s.cand = null; s.pullOffset = [0, 0] }
}

export function executeFlight(s, segments, { bump, fadeContext, onComplete }) {
  const reduce = reducedMotion()
  const token = {}
  s.fly = token
  let i = -1
  const next = () => {
    if (++i >= segments.length) {
      const last = segments.at(-1)
      const entry = s.tree.entries.get(last.id)
      const node = last.elementId && entry.view.nodes.find((item) => item.id === last.elementId)
      s.fly = null
      s.fitted = !node || node.id === entry.frame?.id
      onComplete?.()
      return
    }
    const segment = segments[i]
    if (segment.kind === 'enter') s.cand = segment.id
    const to = segmentEnd(s, segment)
    const path = zoomPath(toU(s.cam, s.size), toU(to, s.size))
    const ms = reduce ? 0 : Math.max(160, Math.min(650, path.duration * 0.45))
    // Wheel settling must not remap an ascent twice or leave an ancestor
    // before its Fit segment finishes.
    animate(s, token, ms, (p) => {
      s.cam = fromU(path(ease(p)), s.size)
      bump()
    }, () => {
      s.cam = segmentEnd(s, segment) // the stage may have resized during this segment
      finishSegment(s, segment, fadeContext, i === segments.length - 1)
      next()
      bump()
    })
  }
  next()
}

export function startFlight(s, target, { endMorph, bump, fadeContext, onComplete, elementId }) {
  if (!s.tree || !s.cam || !s.size.w || !s.tree.entries.has(target)) return false
  s.wheelReturn = null
  cancelWheelRest(s)
  endMorph()
  s.leaving = null
  s.released = null
  s.arriving = null
  s.fitted = false
  const segments = planFlight(s.tree, s.focus, target, s.cand, elementId)
  executeFlight(s, segments, { bump, fadeContext, onComplete })
  bump()
  return true
}
