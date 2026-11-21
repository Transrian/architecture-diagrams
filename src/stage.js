// The zoomable canvas: camera, wheel / drag / click, flights between views,
// and the transition to a new layout.
import * as React from 'react'
import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import { Markers } from './shapes.js'
import { NodeDetail, EdgeDetail } from './details.js'
import { renderLevel } from './render.js'
import { useIconVersion } from './iconpack.js'
import { isGroup, frac, centered, pathOf, fitLocal, geom, childCam, parentCam, plain, settle, toU, fromU, zoomPath, ease } from './zoom.js'

const h = React.createElement
const MORPH_MS = 480
const DBL_MS = 250 // how long a click waits for a second one

export function ZoomStage({ tree, start, t, ctl, onFocus, onToggle }) {
  const stage = useRef(null)
  const st = useRef({ tree: null, cam: null, focus: null, cand: null, anchor: null, fly: null, morph: null, size: { w: 0, h: 0 }, raf: 0, reported: null })
  const [, bump] = useReducer((x) => x + 1, 0)
  const [selected, setSelected] = useState(null) // {type:'node'|'edge', item}
  useIconVersion() // redraw when icon shards arrive
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  const suppressClick = useRef(false)

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
    s.cam = fitLocal(s.tree.entries.get(s.focus), s.size)
    s.cand = null
    s.fly = null
  }, [])

  /** A layout transition in progress ends at once (user input takes over). */
  const endMorph = useCallback(() => {
    const s = st.current
    if (!s.morph) return
    s.cam = s.morph.to
    s.morph = null
  }, [])

  // A new layout (group unfolded, diagram update, version, direction): stay in
  // the same group if it still exists, and glide from the old layout to the new.
  useEffect(() => {
    const s = st.current
    const before = s.tree && s.focus ? s.tree.entries.get(s.focus) : null
    const camFrom = s.cam
    const from = s.morph ? null : before?.view
    s.morph = null
    s.tree = tree
    reset()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (from && camFrom && s.cam && tree.entries.get(s.focus)?.id === before.id && from !== tree.entries.get(s.focus).view && !reduce) {
      const to = s.cam
      const path = zoomPath(toU(camFrom, s.size), toU(to, s.size))
      const token = { id: s.focus, from, to, p: 0 }
      s.morph = token
      s.cam = camFrom
      const t0 = performance.now()
      const step = (now) => {
        if (s.morph !== token) return
        const p = Math.min(1, (now - t0) / MORPH_MS)
        token.p = ease(p)
        s.cam = fromU(path(token.p), s.size)
        if (p >= 1) {
          s.cam = to
          s.morph = null
        } else requestAnimationFrame(step)
        bump()
      }
      requestAnimationFrame(step)
    }
    bump()
  }, [tree])

  useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const measure = () => {
      const s = st.current
      if (!el.clientWidth || !el.clientHeight) return
      const first = !s.size.w
      s.size = { w: el.clientWidth, h: el.clientHeight }
      if (first || !s.cam) reset()
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
      if (s.raf) cancelAnimationFrame(s.raf)
      s.raf = 0
    }
  }, [])

  /**
   * Animated move to any view of the tree: up to the common ancestor one
   * level at a time, close what is open there, then open each group on
   * the way down, and frame the target.
   */
  const flyTo = useCallback((target) => {
    const s = st.current
    if (!s.tree || !s.cam || !s.size.w || !s.tree.entries.has(target)) return false
    endMorph()
    const E = (id) => s.tree.entries.get(id)
    const G = (id) => geom(s.tree, id, s.size)
    const from = pathOf(s.tree, s.focus)
    const to = pathOf(s.tree, target)
    let common = 0
    while (common < from.length && common < to.length && from[common] === to[common]) common++
    const segs = []
    for (let i = from.length - 1; i >= common; i--) {
      const id = from[i]
      segs.push({
        end: () => centered((G(id).fc * 0.99) / frac(1, E(id).frame, s.size), E(id).frame, s.size),
        after: () => {
          s.cam = parentCam(G(id), s.cam, s.size)
          s.focus = E(id).parent
          s.cand = id
        },
      })
    }
    const downs = to.slice(common)
    if (downs.length && (segs.length || (s.cand && s.cand !== downs[0]))) {
      const at = to[common - 1]
      segs.push({ end: () => fitLocal(E(at), s.size) })
    }
    for (const id of downs) {
      segs.push({
        keep: true,
        before: () => { s.cand = id },
        end: () => centered((G(id).bc * 1.01) / frac(1, G(id).N, s.size), G(id).N, s.size),
        after: () => {
          s.cam = plain(childCam(G(id), s.cam, s.size))
          s.focus = id
          s.cand = null
        },
      })
    }
    segs.push({ end: () => fitLocal(E(target), s.size) })
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const token = {}
    s.fly = token
    let i = -1
    let seg = null
    const next = () => {
      if (++i >= segs.length) {
        s.fly = null
        return false
      }
      seg = segs[i]
      seg.before?.()
      seg.to = seg.end()
      seg.path = zoomPath(toU(s.cam, s.size), toU(seg.to, s.size))
      seg.ms = reduce ? 0 : Math.max(160, Math.min(650, seg.path.duration * 0.45))
      seg.t0 = performance.now()
      return true
    }
    const step = (now) => {
      if (s.fly !== token) return
      const p = seg.ms ? Math.min(1, (now - seg.t0) / seg.ms) : 1
      if (p >= 1) {
        s.cam = seg.to
        seg.after?.()
        if (!seg.keep) settle(s, false)
        const more = next()
        bump()
        if (more) requestAnimationFrame(step)
        return
      }
      s.cam = fromU(seg.path(ease(p)), s.size)
      if (!seg.keep) settle(s, false)
      bump()
      requestAnimationFrame(step)
    }
    if (next()) requestAnimationFrame(step)
    return true
  }, [])
  ctl.current = {
    flyTo,
    fit: () => flyTo(st.current.focus),
    has: (id) => !!st.current.tree?.entries.has(id),
  }

  // Wheel: zoom around the pointer; the group under it opens.
  useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      const s = st.current
      if (!s.tree || !s.cam) return
      s.fly = null
      endMorph()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      s.anchor = [px, py]
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1)
      const focus = s.tree.entries.get(s.focus)
      const minK = focus.parent ? 0 : fitLocal(focus, s.size).s * 0.3
      const k = Math.min(4, Math.max(minK, s.cam.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))))
      const ratio = k / s.cam.s
      s.cam = { s: k, tx: px - (px - s.cam.tx) * ratio, ty: py - (py - s.cam.ty) * ratio }
      settle(s)
      schedule()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Report the current group (breadcrumb, buttons); a selection belongs to its view.
  useEffect(() => {
    const s = st.current
    if (s.focus && s.focus !== s.reported) {
      s.reported = s.focus
      onFocus(s.focus)
      setSelected(null)
    }
  })

  const onPointerDown = (e) => {
    const s = st.current
    if (e.button !== 0 || !s.cam) return
    if (e.target.closest && e.target.closest('.dshd-detail')) return
    s.fly = null
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
    d.cam = s.cam
    d.x = e.clientX
    d.y = e.clientY
    settle(s)
    schedule()
  }
  const onPointerUp = (e) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (d?.moved) e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (d && !d.moved && !(e.target.closest && e.target.closest('.dshd-node, .dshd-edge, .dshd-detail'))) setSelected(null)
    if (d?.moved) suppressClick.current = true
  }
  const guard = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return false
    }
    return true
  }
  // Click: the details of a box or a link. Double-click opens: a collapsed
  // group unfolds in place (or, in a view the agent wrote and for a
  // neighbour from another branch, the camera flies to its view); the empty
  // space of an unfolded group folds it back, that of the group the camera
  // zoomed into leaves it for the parent view.
  const pending = useRef(0) // a click waiting to know whether a double-click follows
  useEffect(() => () => clearTimeout(pending.current), [])
  const canFly = (x) => !!x.drill && !!st.current.tree?.entries.has(x.drill)
  const outsideView = (id) => {
    const scope = st.current.tree?.entries.get(st.current.focus)?.frame?.id
    return !!scope && id !== scope && !id.startsWith(scope + '.')
  }
  /** The frame of the zoomed-into group, when there is a parent view to go back to. */
  const leaves = (x) => {
    const here = st.current.tree?.entries.get(st.current.focus)
    return !!here?.parent && here.frame?.id === x.id
  }
  const opens = (x) => (isGroup(x) ? !!x.expanded || leaves(x) : !!x.unfold || canFly(x))
  const select = (x) => setSelected((cur) => (cur && cur.type === 'node' && cur.item.id === x.id ? null : { type: 'node', item: x }))
  const onActivate = (x, e) => {
    if (!guard()) return
    if (x && x.points) {
      setSelected((cur) => (cur && cur.type === 'edge' && cur.item.id === x.id ? null : { type: 'edge', item: x }))
      return
    }
    if (e && e.detail > 1) return // second click of a double-click
    clearTimeout(pending.current)
    // Wait for a possible double-click only where one does something, so the panel does not flash.
    if (opens(x)) pending.current = setTimeout(() => select(x), DBL_MS)
    else select(x)
  }
  /** Double-click on a box or a frame; false: not handled (the stage fits the view). */
  const onOpen = (x) => {
    clearTimeout(pending.current)
    if (isGroup(x)) {
      if (x.expanded) {
        setSelected(null)
        onToggle(x.id)
        return true
      }
      // The frame of the group the camera zoomed into: back up to its parent.
      if (leaves(x) && flyTo(st.current.tree.entries.get(st.current.focus).parent)) {
        setSelected(null)
        return true
      }
      return false
    }
    if (x.unfold) {
      setSelected(null)
      onToggle(x.id)
    } else if (canFly(x) && flyTo(x.drill)) setSelected(null)
    return true
  }
  const onFold = (x) => {
    if (!guard()) return
    clearTimeout(pending.current)
    setSelected(null)
    onToggle(x.id)
  }

  const s = st.current
  let svg = null
  if (s.tree && s.cam && s.size.w) {
    const entry = s.tree.entries.get(s.focus) ?? s.tree.root
    const ctx = { tree: s.tree, size: s.size, t, onActivate, onOpen, onFold, selectedId: selected?.type === 'node' ? selected.item.id : null, cand: s.cand, morph: s.morph }
    svg = h('svg', { role: 'img', 'aria-label': entry.view.title ?? entry.id },
      h(Markers),
      ...renderLevel(ctx, entry, s.cam, false, entry.id))
  }

  return h('div', {
    ref: stage,
    className: 'dshd-stage' + (dragging ? ' dshd-drag' : ''),
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
    onClickCapture: () => { setTimeout(() => { suppressClick.current = false }, 0) },
    // Boxes and unfolded frames stop the double-clicks they handle; the rest (empty space, other frames) fits the view.
    onDoubleClick: (e) => { if (!(e.target.closest && e.target.closest('.dshd-detail'))) flyTo(st.current.focus) },
  },
  svg,
  selected?.type === 'node' ? h(NodeDetail, {
    node: selected.item, t,
    onClose: () => setSelected(null),
    onEnter: canFly(selected.item) ? () => flyTo(selected.item.drill) : null,
    // A neighbour drawn around the frame: its view is in another branch.
    elsewhere: outsideView(selected.item.id),
    onUnfold: !isGroup(selected.item) && selected.item.unfold ? () => onOpen(selected.item) : null,
    onFold: selected.item.expanded ? () => onFold(selected.item) : null,
  }) : null,
  selected?.type === 'edge' ? h(EdgeDetail, { edge: selected.item, t, onClose: () => setSelected(null) }) : null)
}
