// Complete textual alternative to the diagram; shares the displayed model offline.
import * as React from 'react'
import { CloseButton } from './icons.js'

import { useOutline } from './outline-state.js'
import { outlineRow } from './outline-row.js'

const h = React.createElement

/**
 * `embedded`: inside the explorer, below its search field: no header of its
 * own, the field keeps the focus on opening, and ArrowUp on the first row
 * returns to it (`onTop`).
 */
export function Outline({ model, currentGroup, t, onReveal, onClose, embedded = false, onTop }) {
  const state = useOutline({ model, currentGroup, embedded, onTop, onReveal, onClose })
  const { roots, container, ownedFocus } = state
  const row = (id, level, index, size) => outlineRow({ ...state, model, currentGroup, t, onReveal }, id, level, index, size)
  return h(
    embedded ? 'div' : 'section',
    {
      className: 'archd-outline' + (embedded ? ' archd-outline-embedded' : ''),
      ref: container,
      'aria-label': embedded ? undefined : t('outline'),
      onFocusCapture: () => {
        ownedFocus.current = true
      },
      onBlurCapture: (event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) ownedFocus.current = false
      },
      onKeyDown: (event) => {
        if (event.key !== 'Escape' || event.nativeEvent?.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      },
    },
    embedded ? null : h('div', { className: 'archd-panel-head' }, h('strong', null, t('outline')), h(CloseButton, { t, onClick: onClose })),
    h(
      'ul',
      { role: 'tree', 'aria-label': t('outline') },
      roots.map((id, i) => row(id, 1, i, roots.length)),
    ),
  )
}
