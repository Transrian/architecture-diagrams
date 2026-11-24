import { useState, useRef, useEffect } from 'react'
import { geom, holds, wheelZoom } from './zoom.js'
import { onOpening, settle } from './zoom-scope.js'
export function useStageGestures({
  stage,
  st,
  endMorph,
  cancelFly,
  release,
  fadeContext,
  arrive,
  schedule,
  setSelected,
  setKeyboardActive,
}) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  const suppressClick = useRef(false)
  useStageWheel({ stage, st, endMorph, release, fadeContext, arrive, schedule })
  const onPointerDown = (e) => {
    const s = st.current
    if (e.button !== 0 || !s.cam) return
    if (e.target.closest && e.target.closest('.archd-detail')) return
    stage.current?.focus({ preventScroll: true })
    setKeyboardActive(false) // pointer selection is not the keyboard halo
    cancelFly()
    s.released = null
    endMorph()
    drag.current = { x: e.clientX, y: e.clientY, cam: s.cam, moved: false, id: e.pointerId }
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    if (!d.moved) e.currentTarget.setPointerCapture?.(d.id)
    d.moved = true
    setDragging(true)
    const s = st.current
    s.cam = { s: d.cam.s, tx: d.cam.tx + dx, ty: d.cam.ty + dy }
    s.fitted = false
    d.cam = s.cam
    d.x = e.clientX
    d.y = e.clientY
    settle(s)
    fadeContext()
    arrive()
    schedule()
  }
  const onPointerUp = (e) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (d?.moved) e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (d && !d.moved && !(e.target.closest && e.target.closest('.archd-node, .archd-edge, .archd-detail'))) setSelected(null)
    if (d?.moved) suppressClick.current = true
  }
  return { dragging, suppressClick, onPointerDown, onPointerMove, onPointerUp }
}

function useStageWheel({ stage, st, endMorph, release, fadeContext, arrive, schedule }) {
  // Wheel: zoom around the pointer; the group under it opens.
  useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      const s = st.current
      if (!s.tree || !s.cam) return
      // Wheel input takes over opening progress; its direction and anchor
      // decide whether to continue, close, or release the group below.
      s.fly = null
      endMorph()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      s.anchor = [px, py]
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1)
      // Zooming in beside the opening group zooms there instead: the group
      // closes back into its box rather than being entered anyway.
      // Released by zooming beside it, a group drifting towards the centre would
      // otherwise reopen under the pointer at the next notch, and blink.
      if (
        s.released &&
        (dy > 0 || s.tree.entries.get(s.released)?.parent !== s.focus || !holds(s.cam, geom(s.tree, s.released, s.size).N, s.anchor))
      )
        s.released = null
      if (dy < 0 && s.cand && !onOpening(s, s.anchor)) {
        s.released = s.cand
        release(s.cand)
      }
      s.cam = wheelZoom(s.tree, s.focus, s.cam, s.size, dy, e.ctrlKey, s.anchor)
      s.fitted = false
      settle(s)
      fadeContext()
      arrive()
      schedule()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

}
