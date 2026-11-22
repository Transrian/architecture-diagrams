// Complete textual alternative to the diagram; shares the displayed model offline.
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { STATE_COLOR, stateLabel } from './theme.js'

const h = React.createElement
const GLYPH = { system: '▣', machine: '▤', service: '⚙', component: '◇', data: '▱', doc: '▧', person: '♙', external: '↗', hardware: '▥' }

export function Outline({ model, t, onReveal, onClose }) {
  const roots = useMemo(() => (model?.order ?? []).filter((id) => !model.elements[id].parent), [model])
  const [open, setOpen] = useState(() => new Set(roots))
  const [active, setActive] = useState(roots[0] ?? null)
  const container = useRef(null)
  const ownedFocus = useRef(false)
  const didFocus = useRef(false)
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
    if (!didFocus.current || (ownedFocus.current && !container.current?.contains(document.activeElement))) focus(focused)
    didFocus.current = true
  }, [focused, model])
  const onKeyDown = (event, id) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent?.isComposing) return
    const element = model.elements[id]
    const at = visible.indexOf(id)
    switch (event.key) {
      case 'ArrowDown': focus(visible[Math.min(visible.length - 1, at + 1)]); break
      case 'ArrowUp': focus(visible[Math.max(0, at - 1)]); break
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
  const row = (id, level, index, size) => {
    const element = model.elements[id]
    const group = element.children.length > 0
    const expanded = group && open.has(id)
    return h('li', { key: id, role: 'none' },
      h('div', {
        role: 'treeitem', tabIndex: id === focused ? 0 : -1,
        'aria-label': [element.title, t('kind.' + element.kind), element.state ? t('state.' + element.state) : '', ...(element.marks ?? []).map((mark) => t('mark.' + mark)), group && !expanded ? t('outline.hidden', { n: count(id) }) : ''].filter(Boolean).join(', '),
        'aria-level': level, 'aria-posinset': index + 1, 'aria-setsize': size,
        'aria-expanded': group ? expanded : undefined,
        'data-element': id,
        onFocus: (event) => { if (event.target === event.currentTarget) setActive(id) },
        onKeyDown: (event) => onKeyDown(event, id),
      },
      h('div', { className: 'dshd-tree-row', style: { paddingInlineStart: 8 + (level - 1) * 18 }, onClick: () => onReveal(id) },
      group ? h('button', {
        type: 'button', tabIndex: -1, className: 'dshd-tree-toggle',
        'aria-label': t(expanded ? 'fold' : 'unfold'),
        onClick: (event) => { event.stopPropagation(); toggle(id); focus(id) },
      }, expanded ? '▾' : '▸') : h('span', { className: 'dshd-tree-toggle', 'aria-hidden': true }, '·'),
      h('span', { 'aria-hidden': true }, GLYPH[element.kind] ?? '◇'),
      h('span', null, element.title),
      element.state ? h('span', { className: 'dshd-pill', style: { color: STATE_COLOR.get(element.state) } }, stateLabel(element.state, t)) : null,
      ...(element.marks ?? []).map((mark) => h('span', { key: mark, className: 'dshd-pill' }, t('mark.' + mark))),
      group && !expanded ? h('small', null, t('outline.hidden', { n: count(id) })) : null),
      expanded ? h('ul', { role: 'group' }, element.children.map((child, i) => row(child, level + 1, i, element.children.length))) : null))
  }
  return h('section', {
    className: 'dshd-outline', ref: container, 'aria-label': t('outline'),
    onFocusCapture: () => { ownedFocus.current = true },
    onBlurCapture: (event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) ownedFocus.current = false
    },
    onKeyDown: (event) => {
      if (event.key !== 'Escape' || event.nativeEvent?.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      event.preventDefault(); event.stopPropagation(); onClose()
    },
  },
    h('div', { className: 'dshd-panel-head' }, h('strong', null, t('outline')), h('button', { type: 'button', className: 'dshd-btn', onClick: onClose, 'aria-label': t('close') }, '×')),
    h('ul', { role: 'tree', 'aria-label': t('outline') }, roots.map((id, i) => row(id, 1, i, roots.length))))
}
