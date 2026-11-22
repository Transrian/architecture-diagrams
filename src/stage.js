// The zoomable canvas: camera, wheel / drag / click, flights between views,
// and the transition to a new layout.
import * as React from 'react'
import { useState, useEffect, useRef, useCallback, useReducer, useId, useMemo } from 'react'
import { Markers } from './shapes.js'
import { NodeDetail, EdgeDetail } from './details.js'
import { renderLevel } from './render.js'
import { useIconVersion } from './iconpack.js'
import { animate, reducedMotion } from './animation.js'
import { useActivation } from './activation.js'
import { endpointUnfolds } from './relations.js'
import { directionalNeighbour, viewForElement, selectionContainer, selectionItem } from './navigation.js'
import { projectTrace } from './trace.js'
import { isGroup, frac, centered, pathOf, fitLocal, geom, childCam, parentCam, plain, settle, toU, fromU, zoomPath, ease } from './zoom.js'

const h = React.createElement
const MORPH_MS = 480

export function ZoomStage({ tree, result, model = result?.model, expanded = [], start, t, ctl, onFocus, onToggle, onSearch,
  selectedId, onSelect, onReveal, traceResult, onTrace, onClearTrace, traceActive, traceMode, changes,
}) {
  const stage = useRef(null)
  const st = useRef({ tree: null, cam: null, focus: null, cand: null, anchor: null, fly: null, morph: null, size: { w: 0, h: 0 }, raf: 0, reported: null })
  const [, bump] = useReducer((x) => x + 1, 0)
  const [selectedEdge, setSelectedEdge] = useState(null) // only ephemeral edge identity
  const activeReveal = useRef(null)
  useEffect(() => {
    if (selectedId) setSelectedEdge(null)
    if (activeReveal.current && activeReveal.current.id !== selectedId) {
      activeReveal.current = null
      st.current.fly = null
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
    st.current.fly = null
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
  const flyTo = useCallback((target, onComplete, elementId) => {
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
    segs.push({ end: () => {
      const entry = E(target)
      const node = elementId && entry.view.nodes.find((item) => item.id === elementId)
      if (!node || node.id === entry.frame?.id) return fitLocal(entry, s.size)
      const scale = Math.min(1.5, (s.size.w - 50) / (node.width + 120), (s.size.h - 50) / (node.height + 120))
      return centered(Math.max(0.05, scale), node, s.size)
    } })
    const reduce = reducedMotion()
    const token = {}
    s.fly = token
    let i = -1
    const next = () => {
      if (++i >= segs.length) {
        s.fly = null
        onComplete?.()
        return
      }
      const seg = segs[i]
      seg.before?.()
      const to = seg.end()
      const path = zoomPath(toU(s.cam, s.size), toU(to, s.size))
      const ms = reduce ? 0 : Math.max(160, Math.min(650, path.duration * 0.45))
      animate(s, token, ms, (p) => {
        s.cam = fromU(path(ease(p)), s.size)
        if (!seg.keep) settle(s, false)
        bump()
      }, () => {
        s.cam = to
        seg.after?.()
        if (!seg.keep) settle(s, false)
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
      stage.current?.focus({ preventScroll: true })
      bump()
    }, id)
  })

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
  const s = st.current
  const entry = s.tree?.entries.get(s.focus)
  const view = entry?.view
  const nodeItem = selectionItem(model, view, selectedId)
  const edgeItem = !selectedId && selectedEdge?.view === view?.id ? view?.edges.find((edge) => edge.id === selectedEdge.id) : null
  const selected = edgeItem ? { type: 'edge', item: edgeItem } : nodeItem ? { type: 'node', item: nodeItem } : null
  selectionRef.current = selected
  const containingId = selectionContainer(view, nodeItem?.id)
  const { canFly, outsideView, onActivate, onOpen, onFold } = useActivation(st, flyTo, onToggle, setSelected, suppressClick)
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
  })
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
    if (!arrow && !changeGroup && !['Enter', 'Escape', 'Home', 'End', 'f', 'F', '/'].includes(e.key)) return
    if (e.key === '/' && !onSearch) return
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
      else if (selected) setSelected(null)
      else if (entry?.parent) flyTo(entry.parent)
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
      setSelected({ type: 'node', item: keyboardNode })
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
      tree: s.tree, size: s.size, t, onOpen, onFold,
      onActivate: (item, event) => {
        if (!item.points) moveKeyboardFocus(item.id)
        onActivate(item, event)
      },
      selectedId: selected?.type === 'node' ? selected.item.id : null,
      focusId, revealed, containingId, changes, changedRelations, cand: s.cand, morph: s.morph,
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
    node: selected.item, t, change: changes && Object.hasOwn(changes.nodes, selected.item.id) ? changes.nodes[selected.item.id] : null,
    onReveal: !view?.nodes.some((node) => node.id === selected.item.id) && onReveal ? () => onReveal(selected.item.id) : null,
    onTrace: onTrace ? (mode) => onTrace(selected.item.id, mode) : null, traceMode,
    onClose: () => setSelected(null),
    onEnter: canFly(selected.item) ? () => flyTo(selected.item.drill) : null,
    // A neighbour drawn around the frame: its view is in another branch.
    elsewhere: outsideView(selected.item.id),
    onUnfold: !isGroup(selected.item) && selected.item.unfold ? () => onOpen(selected.item) : null,
    onFold: selected.item.expanded ? () => onFold(selected.item) : null,
  }) : null,
  selected?.type === 'edge' ? h(EdgeDetail, { edge: selected.item, model, view, t, onClose: () => setSelected(null), onUnfoldEndpoints: unfoldEndpoints }) : null)
}
