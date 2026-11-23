// The zoomable canvas: camera, wheel / drag / click, flights between views,
// and the transition to a new layout.
import * as React from 'react'
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useReducer, useId, useMemo } from 'react'
import { Markers } from './shapes.js'
import { NodeDetail, EdgeDetail } from './details.js'
import { renderLevel } from './render.js'
import { useIconVersion } from './iconpack.js'
import { animate, reducedMotion } from './animation.js'
import { useActivation } from './activation.js'
import { endpointUnfolds } from './relations.js'
import { directionalNeighbour, viewForElement, selectionContainer, selectionItem } from './navigation.js'
import { projectTrace } from './trace.js'
import { isGroup, holds, frac, centered, pathOf, fitView, revealCam, avoidRect, geom, childCam, plain, settle, exitScope, onOpening, blendOf, toU, fromU, zoomPath, ease, resizeCam } from './zoom.js'

const h = React.createElement
const MORPH_MS = 480
const LEAVE_MS = 260
const ARRIVE_MS = 300

export function ZoomStage({ tree, result, model = result?.model, expanded = [], start, t, ctl, onFocus, onToggle, onSearch,
  selectedId, onSelect, onReveal, traceResult, onTrace, onClearTrace, traceActive, traceMode, changes,
}) {
  const stage = useRef(null)
  const st = useRef({ tree: null, cam: null, focus: null, cand: null, leaving: null, arriving: null, released: null, anchor: null, fly: null, morph: null, contextFade: null, size: { w: 0, h: 0 }, raf: 0, reported: null, fitted: false })
  const [, bump] = useReducer((x) => x + 1, 0)
  const [selectedEdge, setSelectedEdge] = useState(null) // only ephemeral edge identity
  const activeReveal = useRef(null)
  useEffect(() => {
    if (selectedId) setSelectedEdge(null)
    if (activeReveal.current && activeReveal.current.id !== selectedId) {
      activeReveal.current = null
      cancelFly()
      setRequestedReveal(null)
    }
  }, [selectedId])
  const selectionRef = useRef(null)
  const traceCache = useMemo(() => new WeakMap(), [traceResult])
  const changedRelations = useMemo(() => new Set([
    ...(changes?.relations.added ?? []).map((relation) => relation.id),
    ...(changes?.relations.changed ?? []).map((relation) => relation.after.id),
  ]), [changes])
  const setSelected = (update) => {
    // Explicit selection/close takes over from an unfinished reveal. Otherwise
    // its completion callback could reopen a panel the user just dismissed.
    cancelFly()
    activeReveal.current = null
    setRequestedReveal(null)
    const next = typeof update === 'function' ? update(selectionRef.current) : update
    selectionRef.current = next
    if (next?.type === 'node') {
      setSelectedEdge(null)
      onSelect?.(next.item.id)
    } else {
      onSelect?.(null)
      setSelectedEdge(next?.type === 'edge' ? { view: st.current.focus, id: next.item.id } : null)
    }
  }
  // Virtual keyboard focus is independent of the clicked/selected detail.
  const [keyboardFocus, setKeyboardFocus] = useState(null) // {view, id}
  const [keyboardActive, setKeyboardActive] = useState(false)
  const [requestedReveal, setRequestedReveal] = useState(null)
  const [revealed, setRevealed] = useState(null)
  const revealSequence = useRef(0)
  useEffect(() => {
    if (!revealed) return undefined
    const timer = setTimeout(() => setRevealed(null), 2500)
    return () => clearTimeout(timer)
  }, [revealed])
  const accessibilityId = useId()
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
    s.cam = fitView(s.tree, s.focus, s.size)
    s.fitted = true // the camera shows the view at its fit (a resize then refits it)
    s.cand = null
    s.leaving = null
    s.arriving = null
    s.released = null
    s.fly = null
    s.contextFade = null
  }, [])

  const cancelFly = useCallback(() => {
    const s = st.current
    if (!s.fly) return
    s.fly = null
    if (s.cand) release(s.cand)
    else s.leaving = null
    s.arriving = null
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
    const reduce = reducedMotion()
    if (from && camFrom && s.cam && tree.entries.get(s.focus)?.id === before.id && from !== tree.entries.get(s.focus).view && !reduce) {
      const to = s.cam
      const path = zoomPath(toU(camFrom, s.size), toU(to, s.size))
      const token = { id: s.focus, from, to, p: 0 }
      s.morph = token
      s.cam = camFrom
      animate(s, token, MORPH_MS, (p) => {
        token.p = ease(p)
        s.cam = fromU(path(token.p), s.size)
        bump()
      }, () => {
        s.cam = to
        s.morph = null
        bump()
      })
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

  /**
   * Animated move to any view of the tree: up to the common ancestor one
   * level at a time, close what is open there, then open each group on
   * the way down, and frame the target.
   */
  const flyTo = useCallback((target, onComplete, elementId) => {
    const s = st.current
    if (!s.tree || !s.cam || !s.size.w || !s.tree.entries.has(target)) return false
    endMorph()
    s.leaving = null
    s.released = null
    s.arriving = null
    s.fitted = false
    let fits = false
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
          exitScope(s, E(id))
          fadeContext()
        },
      })
    }
    const downs = to.slice(common)
    if (downs.length && (segs.length || (s.cand && s.cand !== downs[0]))) {
      const at = to[common - 1]
      segs.push({ end: () => fitView(s.tree, at, s.size) })
    }
    for (const id of downs) {
      segs.push({
        before: () => { s.cand = id },
        end: () => centered((G(id).bc * 1.01) / frac(1, G(id).N, s.size), G(id).N, s.size),
        after: () => {
          s.cam = plain(childCam(G(id), s.cam, s.size))
          s.focus = id
          s.cand = null
        },
      })
    }
    segs.push({ end: () => {
      const entry = E(target)
      const node = elementId && entry.view.nodes.find((item) => item.id === elementId)
      fits = !node || node.id === entry.frame?.id
      // A revealed element is framed at the view's fit, never closer, so its surroundings stay readable.
      return fits ? fitView(s.tree, target, s.size) : revealCam(s.tree, target, node, s.size)
    }, after: () => { s.cand = null } })
    const reduce = reducedMotion()
    const token = {}
    s.fly = token
    let i = -1
    const next = () => {
      if (++i >= segs.length) {
        s.fly = null
        s.fitted = fits
        onComplete?.()
        return
      }
      const seg = segs[i]
      seg.before?.()
      const to = seg.end()
      const path = zoomPath(toU(s.cam, s.size), toU(to, s.size))
      const ms = reduce ? 0 : Math.max(160, Math.min(650, path.duration * 0.45))
      // Flight segments own scope changes. Wheel settling could remap an
      // ascent twice or leave an ancestor before its Fit segment finishes.
      animate(s, token, ms, (p) => {
        s.cam = fromU(path(ease(p)), s.size)
        bump()
      }, () => {
        s.cam = to
        seg.after?.()
        next()
        bump()
      })
    }
    next()
    return true
  }, [])
  ctl.current = {
    flyTo,
    fit: () => flyTo(st.current.focus),
    has: (id) => !!st.current.tree?.entries.has(id),
    focus: () => stage.current?.focus({ preventScroll: true }),
    reveal: (id) => {
      const target = viewForElement(result, id)
      if (!target || !st.current.tree?.entries.has(target)) return false
      const request = { id, target }
      activeReveal.current = request
      setRequestedReveal(request)
      return true
    },
  }
  // Queueing also covers an outline being closed before its hidden canvas has
  // been measured. ResizeObserver supplies a render once dimensions exist.
  useEffect(() => {
    if (!requestedReveal) return
    const s = st.current
    if (!s.size.w || !s.size.h || !s.cam || !s.tree?.entries.has(requestedReveal.target)) return
    const request = requestedReveal
    const { id, target } = request
    setRequestedReveal(null)
    if (activeReveal.current !== request) return
    flyTo(target, () => {
      if (activeReveal.current !== request) return
      activeReveal.current = null
      const node = s.tree.entries.get(target)?.view.nodes.find((item) => item.id === id)
      if (!node) return
      s.reported = s.focus
      onFocus(s.focus)
      setSelected({ type: 'node', item: node })
      setKeyboardFocus({ view: target, id })
      setRevealed({ id, token: ++revealSequence.current })
      // A docked explorer keeps the keyboard so the user can go on browsing it.
      if (!document.activeElement?.closest?.('.dshd-explorer')) stage.current?.focus({ preventScroll: true })
      bump()
    }, id)
  })

  /** Let go of the opening group: it folds back over LEAVE_MS at the current zoom. */
  const release = useCallback((id) => {
    const s = st.current
    const g = geom(s.tree, id, s.size)
    const from = blendOf(s, id) // it may not have finished arriving
    const u = childCam(g, s.cam, s.size, from).u
    s.cand = null
    if (s.arriving?.id === id) s.arriving = null
    if (u <= 0) {
      s.leaving = null
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
      const p = ms ? Math.min(1, (now - start) / ms) : 1
      token.blend = from * (1 - ease(p))
      if (p >= 1) s.leaving = null
      else requestAnimationFrame(step)
      bump()
    }
    requestAnimationFrame(step)
  }, [])

  const fadeContext = useCallback(() => {
    const s = st.current
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
  }, [])

  /**
   * A group picked under the pointer when it is already partly open (the
   * zoom went past its opening start elsewhere) opens over ARRIVE_MS from its
   * closed box instead of jumping; it is entered only once it has caught up.
   */
  const arrive = useCallback(() => {
    const s = st.current
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
      const p = Math.min(1, (now - start) / ms)
      token.blend = ease(p)
      if (p >= 1) done()
      else {
        requestAnimationFrame(step)
        bump()
      }
    }
    requestAnimationFrame(step)
  }, [])

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
      if (s.released && (dy > 0 || s.tree.entries.get(s.released)?.parent !== s.focus
        || !holds(s.cam, geom(s.tree, s.released, s.size).N, s.anchor))) s.released = null
      if (dy < 0 && s.cand && !onOpening(s, s.anchor)) {
        s.released = s.cand
        release(s.cand)
      }
      const focus = s.tree.entries.get(s.focus)
      const minK = focus.parent ? 0 : fitView(s.tree, focus.id, s.size).s * 0.3
      const k = Math.min(4, Math.max(minK, s.cam.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))))
      const ratio = k / s.cam.s
      s.cam = { s: k, tx: px - (px - s.cam.tx) * ratio, ty: py - (py - s.cam.ty) * ratio }
      s.fitted = false
      settle(s)
      fadeContext()
      arrive()
      schedule()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Camera context changes never discard the selected element identity.
  useEffect(() => {
    const s = st.current
    if (s.focus && s.focus !== s.reported) {
      s.reported = s.focus
      onFocus(s.focus)
      setSelectedEdge(null)
    }
  })

  const onPointerDown = (e) => {
    const s = st.current
    if (e.button !== 0 || !s.cam) return
    if (e.target.closest && e.target.closest('.dshd-detail')) return
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
    if (d && !d.moved && !(e.target.closest && e.target.closest('.dshd-node, .dshd-edge, .dshd-detail'))) setSelected(null)
    if (d?.moved) suppressClick.current = true
  }
  const s = st.current
  const entry = s.tree?.entries.get(s.focus)
  const view = entry?.view
  const nodeItem = selectionItem(model, view, selectedId)
  const edgeItem = !selectedId && selectedEdge?.view === view?.id ? view?.edges.find((edge) => edge.id === selectedEdge.id) : null
  const selected = edgeItem ? { type: 'edge', item: edgeItem } : nodeItem ? { type: 'node', item: nodeItem } : null
  selectionRef.current = selected
  const containingId = selectionContainer(view, nodeItem?.id)
  // Below 600 px the details become a bottom sheet across the stage.
  const sheet = s.size.w > 0 && s.size.w < 600
  // The details panel must not hide what it describes: once per selection,
  // pan the camera so the selected box sits beside the panel when it can.
  const cleared = useRef(null)
  useLayoutEffect(() => {
    const key = nodeItem && view ? view.id + '\u0000' + nodeItem.id : null
    if (!key) { cleared.current = null; return }
    const S = st.current
    if (cleared.current === key || S.fly || S.morph || !S.cam || !stage.current) return
    cleared.current = key
    const panel = stage.current.querySelector('.dshd-detail')
    const node = view.nodes.find((item) => item.id === nodeItem.id)
    if (!panel || !node) return
    const area = stage.current.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    const P = { l: rect.left - area.left, t: rect.top - area.top, r: rect.right - area.left, b: rect.bottom - area.top }
    const m = 9 // the selection halo around the box
    const B = { l: S.cam.s * node.x + S.cam.tx - m, t: S.cam.s * node.y + S.cam.ty - m, r: S.cam.s * (node.x + node.width) + S.cam.tx + m, b: S.cam.s * (node.y + node.height) + S.cam.ty + m }
    const pan = avoidRect(B, P, S.size)
    if (!pan) return
    const from = S.cam
    const to = { s: from.s, tx: from.tx + pan.dx, ty: from.ty + pan.dy }
    const token = {}
    S.fly = token
    S.fitted = false
    animate(S, token, reducedMotion() ? 0 : 220, (p) => {
      const q = ease(p)
      S.cam = { s: to.s, tx: from.tx + pan.dx * q, ty: from.ty + pan.dy * q }
      bump()
    }, () => {
      S.cam = to
      S.fly = null
      bump()
    })
  })
  const { canFly, outsideView, onActivate, onOpen, onFold, zoomInto, chipOf, onChip } = useActivation(st, flyTo, onToggle, setSelected, suppressClick)
  const scope = entry?.frame?.id ?? view?.viewOf ?? null
  // The enclosing scope frame is not a box to navigate to. Unfolded nested
  // frames and outside neighbours remain available alongside ordinary boxes.
  const keyboardNodes = (view?.nodes ?? []).filter((node) => node.id !== scope)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const firstKeyboardNode = keyboardNodes.find((node) => !scope || node.id.startsWith(scope + '.')) ?? keyboardNodes[0]
  const keyboardNode = (keyboardFocus?.view === view?.id && keyboardNodes.find((node) => node.id === keyboardFocus.id)) || firstKeyboardNode
  const focusId = keyboardActive ? keyboardNode?.id : null
  const optionId = (id) => accessibilityId + '-box-' + encodeURIComponent(id)
  const announcement = (node) => t('keyboard.focus', {
    title: node.title ?? node.id,
    kind: t('kind.' + node.kind),
    count: node.hidden ?? 0,
    state: node.state ? t('state.' + node.state) : t('states.none'),
  }) + (node.marks?.length ? ' · ' + node.marks.map((mark) => t('mark.' + mark)).join(', ') : '')
    + (node.assumedCount > 0 ? ' · ' + t('count.assumed', { n: node.assumedCount }) : '')
  const moveKeyboardFocus = (id) => {
    if (id) setKeyboardFocus({ view: view.id, id })
  }
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent?.isComposing) return
    // Native buttons/inputs in the detail panel keep their normal keymap.
    if (e.target !== e.currentTarget) {
      if (e.key === 'Escape' && selected && e.target.closest?.('.dshd-detail')) {
        e.preventDefault()
        e.stopPropagation()
        if (traceActive) onClearTrace?.()
        else setSelected(null)
        stage.current?.focus({ preventScroll: true })
      }
      return
    }
    const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
    const changeGroup = ['+', '=', '-', ' ', 'Spacebar'].includes(e.key)
    if (!arrow && !changeGroup && !['Enter', 'Escape', 'Backspace', 'Home', 'End', 'f', 'F', '/'].includes(e.key)) return
    if (e.key === '/' && !onSearch) return
    // Escape only closes things; with nothing to close it is left alone (it never navigates).
    if (e.key === 'Escape' && !traceActive && !selected) return
    if (e.key === 'Backspace' && !entry?.parent) return
    e.preventDefault()
    e.stopPropagation()
    setKeyboardActive(true)
    if (arrow) {
      s.fly = null
      endMorph()
      moveKeyboardFocus(directionalNeighbour(keyboardNodes, keyboardNode?.id, e.key))
      return
    }
    if (e.key === 'Home' || e.key === 'End') {
      moveKeyboardFocus(e.key === 'Home' ? keyboardNodes[0]?.id : keyboardNodes.at(-1)?.id)
      return
    }
    if (e.key === 'Escape') {
      if (traceActive) onClearTrace?.()
      else setSelected(null)
      return
    }
    if (e.key === 'Backspace') {
      flyTo(entry.parent)
      return
    }
    if (e.key === 'f' || e.key === 'F') {
      flyTo(s.focus)
      return
    }
    if (e.key === '/') {
      onSearch()
      return
    }
    if (!keyboardNode) return
    if (e.key === 'Enter') {
      // Shift+Enter zooms into the focused group (or unfolds it when it has no view of its own).
      if (e.shiftKey) zoomInto(keyboardNode)
      else setSelected({ type: 'node', item: keyboardNode })
      return
    }
    if (changeGroup && !e.repeat) {
      // Controlled expansion wins over the previous layout while recomputing.
      const open = expanded.includes(keyboardNode.id)
      const toggle = e.key === ' ' || e.key === 'Spacebar'
      const fold = e.key === '-' || (toggle && open)
      if (fold) {
        // Never let '-' on a closed box expand it through a toggle API.
        if (open && keyboardNode.unfold && onToggle) onToggle(keyboardNode.id)
      } else if (!open && !isGroup(keyboardNode)) {
        if (keyboardNode.unfold && onToggle) onToggle(keyboardNode.id)
        else if (canFly(keyboardNode)) flyTo(keyboardNode.drill)
      }
      return
    }
  }
  const endpointGroups = selected?.type === 'edge' && onToggle ? endpointUnfolds(selected.item, model, view, expanded) : []
  const unfoldEndpoints = endpointGroups.length ? () => {
    // The helper excludes outside endpoints, open groups and the scope frame.
    // Close the panel before recomputing so repeated clicks cannot fold them.
    setSelected(null)
    for (const id of endpointGroups) onToggle(id)
  } : null
  let svg = null
  if (s.tree && s.cam && s.size.w) {
    const entry = s.tree.entries.get(s.focus) ?? s.tree.root
    const ctx = {
      tree: s.tree, size: s.size, t, onOpen, onFold, chipOf, onChip,
      onActivate: (item, event) => {
        if (!item.points) moveKeyboardFocus(item.id)
        onActivate(item, event)
      },
      selectedId: selected?.type === 'node' ? selected.item.id : null,
      focusId, revealed, containingId, changes, changedRelations, cand: s.cand, leaving: s.leaving, arriving: s.arriving, morph: s.morph, contextFade: s.contextFade,
      traceOf: traceResult ? (view) => {
        if (!traceCache.has(view)) traceCache.set(view, projectTrace(traceResult, view))
        return traceCache.get(view)
      } : null,
    }
    // Accessible boxes live outside the visual SVG: role=img would otherwise
    // hide descendant controls from assistive technology.
    svg = h('svg', { 'aria-hidden': true, focusable: false },
      h(Markers),
      ...renderLevel(ctx, entry, s.cam, false, entry.id))
  }

  return h('div', {
    ref: stage,
    className: 'dshd-stage' + (dragging ? ' dshd-drag' : ''),
    tabIndex: 0,
    role: 'application',
    'aria-label': view?.title ?? view?.id,
    'aria-describedby': accessibilityId + '-help',
    'aria-activedescendant': focusId ? optionId(focusId) : undefined,
    onFocus: (e) => {
      if (e.target !== e.currentTarget) return
      setKeyboardActive(true)
      moveKeyboardFocus(keyboardNode?.id)
    },
    onBlur: () => setKeyboardActive(false),
    onKeyDown,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
    onClickCapture: () => { setTimeout(() => { suppressClick.current = false }, 0) },
    // Boxes and unfolded frames stop the double-clicks they handle; the rest (empty space, other frames) fits the view.
    onDoubleClick: (e) => { if (!(e.target.closest && e.target.closest('.dshd-detail'))) flyTo(st.current.focus) },
  },
  svg,
  h('span', { id: accessibilityId + '-help', className: 'dshd-sr-only' }, t('keyboard.help')),
  h('div', { role: 'listbox', className: 'dshd-sr-only', 'aria-label': view?.title ?? view?.id },
    ...keyboardNodes.map((node) => h('div', {
      key: node.id, id: optionId(node.id), role: 'option',
      'aria-selected': selected?.type === 'node' && selected.item.id === node.id,
    }, announcement(node)))),
  h('div', { className: 'dshd-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, keyboardActive && keyboardNode ? announcement(keyboardNode) : ''),
  selected?.type === 'node' ? h(NodeDetail, {
    node: selected.item, t, sheet, change: changes && Object.hasOwn(changes.nodes, selected.item.id) ? changes.nodes[selected.item.id] : null,
    onReveal: !view?.nodes.some((node) => node.id === selected.item.id) && onReveal ? () => onReveal(selected.item.id) : null,
    onTrace: onTrace ? (mode) => onTrace(selected.item.id, mode) : null, traceMode,
    onClose: () => setSelected(null),
    onEnter: canFly(selected.item) ? () => flyTo(selected.item.drill) : null,
    // A neighbour drawn around the frame: its view is in another branch.
    elsewhere: outsideView(selected.item.id),
    onUnfold: !isGroup(selected.item) && selected.item.unfold && onToggle ? () => onToggle(selected.item.id) : null,
    onFold: selected.item.expanded ? () => onFold(selected.item) : null,
  }) : null,
  selected?.type === 'edge' ? h(EdgeDetail, { edge: selected.item, model, view, t, sheet, onClose: () => setSelected(null), onUnfoldEndpoints: unfoldEndpoints }) : null)
}
