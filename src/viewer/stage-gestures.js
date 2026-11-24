import { useState, useRef, useEffect } from 'react'
import { addPointer, movePointer, removePointer } from './pointer-drag.js'
import { geom, holds, wheelZoom } from './zoom.js'
import { pauseWheel, cancelWheelRest } from './wheel-rest.js'
import { onOpening, settle, rememberWheelFit, panOpening } from './zoom-scope.js'
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
    const next = addPointer(drag.current, e)
    if (!next) return
    drag.current = next
    if (next.touch) e.currentTarget.setPointerCapture?.(e.pointerId)
    stage.current?.focus({ preventScroll: true })
    setKeyboardActive(false) // pointer selection is not the keyboard halo
    cancelFly()
    s.wheelReturn = null
    s.released = null
    endMorph()
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const delta = movePointer(d, e)
    if (!delta) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragging(true)
    const s = st.current
    const rect = stage.current.getBoundingClientRect()
    const anchor = [delta.x - rect.left, delta.y - rect.top]
    panOpening(s, delta.dx, delta.dy)
    const panned = { ...s.cam, tx: s.cam.tx + delta.dx, ty: s.cam.ty + delta.dy }
    s.cam = delta.ratio === 1 ? panned
      : wheelZoom(s.tree, s.focus, panned, s.size, -Math.log(delta.ratio) / 0.01, true, anchor)
    s.fitted = false
    s.anchor = anchor
    settle(s)
    fadeContext()
    arrive()
    schedule()
  }
  const onPointerUp = (e) => {
    const d = drag.current
    if (!d || !removePointer(d, e.pointerId)) return
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.moved) suppressClick.current = true
    if (d.points.size) return
    drag.current = null
    setDragging(false)
    if (!d.moved && !(e.target.closest && e.target.closest('.archd-node, .archd-edge, .archd-detail'))) setSelected(null)
  }

  return { dragging, suppressClick, onPointerDown, onPointerMove, onPointerUp }
}

function useStageWheel({ stage, st, endMorph, release, fadeContext, arrive, schedule }) {
  // Wheel: zoom around the pointer; the group under it opens.
  useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const onWheel = (e) => {
      if (e.target.closest?.('.archd-detail')) return
      e.preventDefault()
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1)
      if (dy === 0) return
      const s = st.current
      if (!s.tree || !s.cam) return
      // Wheel input takes over opening progress; its direction and anchor
      // decide whether to continue, close, or release the group below.
      rememberWheelFit(s)
      cancelWheelRest(s)
      s.fly = null
      endMorph()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      s.anchor = [px, py]
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
      pauseWheel(s, schedule, fadeContext)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      cancelWheelRest(st.current)
    }
  }, [])

}
