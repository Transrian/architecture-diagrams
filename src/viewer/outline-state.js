import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export function useOutline({ model, currentGroup, embedded, onTop, onReveal, onClose }) {
  const roots = useMemo(() => (model?.order ?? []).filter((id) => !model.elements[id].parent), [model])
  const [open, setOpen] = useState(() => new Set(roots))
  const [active, setActive] = useState(roots[0] ?? null)
  const container = useRef(null)
  const ownedFocus = useRef(false)
  const didFocus = useRef(false)
  const scrolled = useRef(null)
  useLayoutEffect(() => {
    if (!currentGroup) return
    setOpen(before => {
      const next = new Set(before)
      for (let element = model.elements[currentGroup]; element; element = model.elements[element.parent]) next.add(element.id)
      return next.size === before.size ? before : next
    })
  }, [currentGroup, model])
  useLayoutEffect(() => {
    if (!currentGroup) { scrolled.current = null; return }
    if (scrolled.current?.id === currentGroup && scrolled.current.model === model) return
    const panel = container.current
    for (const item of panel?.querySelectorAll('[role=treeitem]') ?? []) {
      if (item.dataset.element !== currentGroup) continue
      // Scroll only the tree, never the page or the canvas; leave keyboard focus alone.
      const row = item.firstElementChild.getBoundingClientRect()
      const bounds = panel.getBoundingClientRect()
      if (row.top < bounds.top) panel.scrollTop += row.top - bounds.top
      else if (row.bottom > bounds.bottom) panel.scrollTop += row.bottom - bounds.bottom
      scrolled.current = { id: currentGroup, model }
      break
    }
  }, [currentGroup, model, open])
  const visible = []
  const walk = (id) => {
    visible.push(id)
    if (open.has(id)) for (const child of model.elements[id].children) walk(child)
  }
  for (const id of roots) walk(id)
  const focused = visible.includes(active) ? active : visible[0]
  const count = (id) => model.elements[id].children.reduce((sum, child) => sum + 1 + count(child), 0)
  const toggle = (id, value) => setOpen((before) => {
    const next = new Set(before)
    if (value ?? !next.has(id)) next.add(id)
    else next.delete(id)
    return next
  })
  const focus = (id) => {
    if (!id) return
    setActive(id)
    // Query by data attribute rather than building selectors from user-authored ids.
    for (const row of container.current?.querySelectorAll('[role=treeitem]') ?? []) {
      if (row.dataset.element === id) { row.focus(); break }
    }
  }
  useEffect(() => {
    if (!focused) return
    // A removed focused row drops browser focus onto body without a blur event.
    // Restore a surviving row only if the outline still owns keyboard focus.
    if ((!didFocus.current && !embedded) || (ownedFocus.current && !container.current?.contains(document.activeElement))) focus(focused)
    didFocus.current = true
  }, [focused, model])
  const onKeyDown = (event, id) => outlineKey(event, id, { model, visible, open, focus, toggle, onTop, onReveal, onClose })
  return { roots, open, focused, container, ownedFocus, setActive, count, toggle, focus, onKeyDown }
}

function outlineKey(event, id, { model, visible, open, focus, toggle, onTop, onReveal, onClose }) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent?.isComposing) return
    const element = model.elements[id]
    const at = visible.indexOf(id)
    switch (event.key) {
      case 'ArrowDown': focus(visible[Math.min(visible.length - 1, at + 1)]); break
      case 'ArrowUp': if (at === 0 && onTop) onTop(); else focus(visible[Math.max(0, at - 1)]); break
      case 'Home': focus(visible[0]); break
      case 'End': focus(visible.at(-1)); break
      case 'ArrowRight':
        if (element.children.length && !open.has(id)) toggle(id, true)
        else if (element.children.length) focus(element.children[0])
        break
      case 'ArrowLeft':
        if (element.children.length && open.has(id)) toggle(id, false)
        else focus(element.parent)
        break
      case 'Enter': onReveal(id); break
      case ' ': if (element.children.length) toggle(id); else onReveal(id); break
      case 'Escape': onClose(); break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
  }
