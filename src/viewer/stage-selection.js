import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { viewForElement, selectionItem, selectionContainer } from './navigation.js'
import { avoidRect } from './zoom.js'
import { ease } from './zoom-path.js'
import { animate, reducedMotion } from './animation.js'
export function useStageSelection({ st, stage, model, result, view, selectedId, onSelect, onFocus, cancelFly, flyTo, bump }) {
  const selectionRef = useRef(null)
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
  useRevealFlight({
    st, stage, requestedReveal, setRequestedReveal, activeReveal, flyTo, onFocus,
    setSelected, setKeyboardFocus, setRevealed, revealSequence, bump,
  })
  const nodeItem = selectionItem(model, view, selectedId)
  const edgeItem = !selectedId && selectedEdge?.view === view?.id ? view?.edges.find((edge) => edge.id === selectedEdge.id) : null
  const selected = edgeItem ? { type: 'edge', item: edgeItem } : nodeItem ? { type: 'node', item: nodeItem } : null
  selectionRef.current = selected
  const containingId = selectionContainer(view, nodeItem?.id)
  usePanelClearance(st, stage, view, nodeItem, bump)
  const requestReveal = (id) => {
    const target = viewForElement(result, id)
    if (!target || !st.current.tree?.entries.has(target)) return false
    const request = { id, target }
    activeReveal.current = request
    setRequestedReveal(request)
    return true
  }
  return {
    selected,
    setSelected,
    setSelectedEdge,
    containingId,
    revealed,
    requestReveal,
    keyboardFocus,
    keyboardActive,
    setKeyboardFocus,
    setKeyboardActive,
  }
}

function useRevealFlight({
  st, stage, requestedReveal, setRequestedReveal, activeReveal, flyTo, onFocus,
  setSelected, setKeyboardFocus, setRevealed, revealSequence, bump,
}) {
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
    flyTo(
      target,
      () => {
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
        if (!document.activeElement?.closest?.('.archd-explorer')) stage.current?.focus({ preventScroll: true })
        bump()
      },
      id,
    )
  })

}

function usePanelClearance(st, stage, view, nodeItem, bump) {
  // Below 600 px the details become a bottom sheet across the stage.
  // The details panel must not hide what it describes: once per selection,
  // pan the camera so the selected box sits beside the panel when it can.
  const cleared = useRef(null)
  useLayoutEffect(() => {
    const key = nodeItem && view ? view.id + '\u0000' + nodeItem.id : null
    if (!key) {
      cleared.current = null
      return
    }
    const S = st.current
    if (cleared.current === key || S.fly || S.morph || !S.cam || !stage.current) return
    cleared.current = key
    const panel = stage.current.querySelector('.archd-detail')
    const node = view.nodes.find((item) => item.id === nodeItem.id)
    if (!panel || !node) return
    const area = stage.current.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    const P = { l: rect.left - area.left, t: rect.top - area.top, r: rect.right - area.left, b: rect.bottom - area.top }
    const m = 9 // the selection halo around the box
    const B = {
      l: S.cam.s * node.x + S.cam.tx - m,
      t: S.cam.s * node.y + S.cam.ty - m,
      r: S.cam.s * (node.x + node.width) + S.cam.tx + m,
      b: S.cam.s * (node.y + node.height) + S.cam.ty + m,
    }
    const pan = avoidRect(B, P, S.size)
    if (!pan) return
    const from = S.cam
    const to = { s: from.s, tx: from.tx + pan.dx, ty: from.ty + pan.dy }
    const token = {}
    S.fly = token
    S.fitted = false
    animate(
      S,
      token,
      reducedMotion() ? 0 : 220,
      (p) => {
        const q = ease(p)
        S.cam = { s: to.s, tx: from.tx + pan.dx * q, ty: from.ty + pan.dy * q }
        bump()
      },
      () => {
        S.cam = to
        S.fly = null
        bump()
      },
    )
  })
}
