import { useRef, useReducer, useCallback, useEffect } from 'react'
import { animate, reducedMotion } from './animation.js'
import { fitView, resizeCam } from './zoom.js'
import { zoomPath, toU, fromU, ease } from './zoom-path.js'

const MORPH_MS = 480
// Cache hits and fresh layouts can have a different property insertion order.
const viewKey = (view) => JSON.stringify(view, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
    : value,
)
export function useStageCamera(stage, tree, start) {
  const st = useRef({
    tree: null,
    cam: null,
    focus: null,
    cand: null,
    leaving: null,
    arriving: null,
    released: null,
    anchor: null,
    fly: null,
    morph: null,
    contextFade: null,
    size: { w: 0, h: 0 },
    raf: 0,
    reported: null,
    fitted: false,
  })
  const [, bump] = useReducer((x) => x + 1, 0)
  const schedule = useCallback(() => {
    const s = st.current
    if (s.raf) return
    s.raf = requestAnimationFrame(() => {
      s.raf = 0
      bump()
    })
  }, [])

  const startRef = useRef(start)
  startRef.current = start
  const reset = useCallback(() => {
    const s = st.current
    if (!s.tree || !s.size.w || !s.size.h) return
    if (!s.focus || !s.tree.entries.has(s.focus)) s.focus = s.tree.entries.has(startRef.current) ? startRef.current : s.tree.root.id
    s.cam = fitView(s.tree, s.focus, s.size)
    s.fitted = true // the camera shows the view at its fit (a resize then refits it)
    s.cand = null
    s.leaving = null
    s.arriving = null
    s.released = null
    s.fly = null
    s.contextFade = null
  }, [])

  /** A layout transition in progress ends at once (user input takes over). */
  const endMorph = useCallback(() => {
    const s = st.current
    if (!s.morph) return
    s.cam = fitView(s.tree, s.focus, s.size)
    s.morph = null
  }, [])

  useTreeMorph(st, tree, reset, bump)
  useStageMeasure(st, stage, reset, bump)
  return { st, bump, schedule, endMorph }
}

function useTreeMorph(st, tree, reset, bump) {
  // A new layout (group unfolded, diagram update, version, direction): stay in
  // the same group if it still exists, and glide from the old layout to the new.
  useEffect(() => {
    const s = st.current
    const before = s.tree && s.focus ? s.tree.entries.get(s.focus) : null
    const camFrom = s.cam
    const from = s.morph ? null : before?.view
    s.tree = tree
    const after = tree.entries.get(s.focus)
    // A flow-only direction change leaves the cached schema layout untouched.
    if (before && after && viewKey(before.view) === viewKey(after.view)) {
      bump()
      return
    }
    s.morph = null
    reset()
    const reduce = reducedMotion()
    if (from && camFrom && s.cam && tree.entries.get(s.focus)?.id === before.id && from !== tree.entries.get(s.focus).view && !reduce) {
      const to = s.cam
      const path = zoomPath(toU(camFrom, s.size), toU(to, s.size))
      const token = { id: s.focus, from, p: 0 }
      s.morph = token
      s.cam = camFrom
      animate(
        s,
        token,
        MORPH_MS,
        (p) => {
          token.p = ease(p)
          s.cam = fromU(path(token.p), s.size)
          bump()
        },
        () => {
          s.cam = fitView(s.tree, s.focus, s.size)
          s.morph = null
          bump()
        },
      )
    }
    bump()
  }, [tree])

}

function useStageMeasure(st, stage, reset, bump) {
  useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const measure = () => {
      const s = st.current
      if (!el.clientWidth || !el.clientHeight) return
      const first = !s.size.w
      const before = s.size
      const size = { w: el.clientWidth, h: el.clientHeight }
      if (!first && size.w === before.w && size.h === before.h) return
      s.size = size
      if (first || !s.cam) reset()
      else if (!s.fly && !s.morph && s.tree?.entries.has(s.focus)) {
        // Keep the picture: refit a fitted view, else keep its centre and scale.
        s.cam = resizeCam(s.tree, s.focus, s.cam, before, size, s.fitted)
      }
      bump()
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => {
      ro.disconnect()
      const s = st.current
      s.fly = null
      s.morph = null
      s.contextFade = null
      if (s.raf) cancelAnimationFrame(s.raf)
      s.raf = 0
    }
  }, [])

}
