import { useEffect, useRef } from 'react'
import { focusPan } from './zoom.js'
import { animate, reducedMotion } from './animation.js'
import { ease } from './zoom-path.js'

export function useKeyboardPan(st, stage, view, node, bump) {
  const cleared = useRef(null)
  const flight = useRef(null)
  useEffect(() => {
    const key = node && view ? view.id + '\u0000' + node.id : null
    if (!key) {
      cleared.current = null
      return
    }
    const s = st.current
    // Navigation, reveals and panel clearance own their landing. Focus waits.
    if (cleared.current === key || s.morph || (s.fly && s.fly !== flight.current) || !s.cam || !stage.current) return
    cleared.current = key
    const margin = 9
    const box = {
      l: s.cam.s * node.x + s.cam.tx - margin,
      t: s.cam.s * node.y + s.cam.ty - margin,
      r: s.cam.s * (node.x + node.width) + s.cam.tx + margin,
      b: s.cam.s * (node.y + node.height) + s.cam.ty + margin,
    }
    const area = stage.current.getBoundingClientRect()
    const panel = stage.current.querySelector('.archd-detail')?.getBoundingClientRect()
    const obstruction = panel ? {
      l: panel.left - area.left, t: panel.top - area.top, r: panel.right - area.left, b: panel.bottom - area.top,
    } : null
    const pan = focusPan(box, s.size, obstruction)
    if (!pan) return
    const from = s.cam
    const to = { s: from.s, tx: from.tx + pan.dx, ty: from.ty + pan.dy }
    const token = {}
    s.fly = flight.current = token
    s.fitted = false
    animate(s, token, reducedMotion() ? 0 : 180, (p) => {
      const q = ease(p)
      s.cam = { s: from.s, tx: from.tx + pan.dx * q, ty: from.ty + pan.dy * q }
      bump()
    }, () => {
      s.cam = to
      s.fly = flight.current = null
      bump()
    })
  })
}
