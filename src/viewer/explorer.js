// The explorer: one panel for searching and browsing the displayed model.
// Empty field: the outline tree. Typed query: a flat result list (combobox).
// Docked beside the canvas on wide tabs (it stays open when a row is chosen),
// over the canvas on narrow ones (choosing a row closes it).
import * as React from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { searchElements, searchCount, SEARCH_MAX } from './navigation.js'
import { STATE_COLOR, stateLabel } from './theme.js'
import { CloseButton } from './icons.js'
import { Outline } from './outline.js'

const h = React.createElement
const plainKey = (event) => !(event.nativeEvent?.isComposing || event.altKey || event.ctrlKey || event.metaKey)

export function Explorer({ model, currentGroup, t, docked, focusToken, onReveal, onClose }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef(null)
  const section = useRef(null)
  const id = 'archd-explorer-' + useId().replace(/:/g, '')
  const searching = query.trim() !== ''
  const results = useMemo(() => (searching ? searchElements(model, query, SEARCH_MAX) : []), [model, query, searching])
  const total = useMemo(() => (searching ? searchCount(model, query) : 0), [model, query, searching])
  const index = Math.max(0, Math.min(active, results.length - 1))
  // Opening (or `/` again while open) puts the keyboard in the field.
  useEffect(() => {
    input.current?.focus()
  }, [focusToken])
  useEffect(() => {
    if (results.length) document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, index, query, results])
  const toTree = () => section.current?.querySelector('[role=treeitem][tabindex="0"]')?.focus()
  const onKeyDown = (event) => {
    if (!plainKey(event)) return
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowDown' && !searching) toTree()
    else if (event.key === 'ArrowDown') setActive(results.length ? (index + 1) % results.length : 0)
    else if (event.key === 'ArrowUp' && searching) setActive(results.length ? (index + results.length - 1) % results.length : 0)
    else if (event.key === 'Enter' && results[index]) onReveal(results[index].id)
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  const more = total - results.length
  return h(
    'section',
    {
      ref: section,
      className: 'archd-explorer' + (docked ? ' archd-docked' : ' archd-overlay'),
      'aria-label': t('explorer'),
      onKeyDown: (event) => {
        if (event.key !== 'Escape' || !plainKey(event)) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      },
    },
    h(
      'div',
      { className: 'archd-panel-head' },
      h('input', {
        ref: input,
        type: 'search',
        role: 'combobox',
        value: query,
        'aria-label': t('search'),
        placeholder: t('search.placeholder'),
        'aria-autocomplete': 'list',
        'aria-expanded': results.length > 0,
        'aria-controls': searching ? id : undefined,
        'aria-activedescendant': results.length ? `${id}-${index}` : undefined,
        onChange: (event) => {
          setQuery(event.target.value)
          setActive(0)
        },
        onKeyDown,
      }),
      h(CloseButton, { t, onClick: onClose }),
    ),
    searching ? h('div', { className: 'archd-sr-only', role: 'status' }, t('search.results', { n: total })) : null,
    searching
      ? searchResults({ model, t, id, total, results, index, setActive, onReveal, more })
      : h(Outline, { model, currentGroup, t, onReveal, onClose, embedded: true, onTop: () => input.current?.focus() }),
  )
}

function searchResults({ model, t, id, total, results, index, setActive, onReveal, more }) {
  return h(
          'div',
          { className: 'archd-search' },
          h(
            'ul',
            { role: 'listbox', id, 'aria-label': t('search.results', { n: total }) },
            results.map((result, i) =>
              h(
                'li',
                {
                  key: result.id,
                  id: `${id}-${i}`,
                  role: 'option',
                  'aria-selected': i === index,
                  onMouseDown: (event) => event.preventDefault(),
                  onMouseEnter: () => setActive(i),
                  onClick: () => onReveal(result.id),
                },
                h('strong', null, result.title),
                result.state
                  ? h('span', { className: 'archd-pill', style: { color: STATE_COLOR.get(result.state) } }, stateLabel(result.state, t))
                  : null,
                ...(model.elements[result.id].marks ?? []).map((mark) =>
                  h('span', { key: mark, className: 'archd-pill' }, t('mark.' + mark)),
                ),
                h('small', null, result.path),
              ),
            ),
          ),
          more > 0 ? h('p', { className: 'archd-more' }, t('explorer.more', { n: more })) : null,
          !results.length ? h('p', null, t('search.empty')) : null,
        )
}
