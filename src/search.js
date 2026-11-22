// Display-only search across the entire currently displayed model.
import * as React from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { searchElements } from './navigation.js'
import { stateLabel } from './theme.js'

const h = React.createElement

export function Search({ model, t, onReveal, onClose }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef(null)
  const id = 'dshd-search-' + useId().replace(/:/g, '')
  const results = useMemo(() => searchElements(model, query, 12), [model, query])
  const index = Math.max(0, Math.min(active, results.length - 1))
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    if (results.length) document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, index, query, results])
  const onKeyDown = (event) => {
    if (event.nativeEvent?.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowDown') setActive(results.length ? (index + 1) % results.length : 0)
    else if (event.key === 'ArrowUp') setActive(results.length ? (index + results.length - 1) % results.length : 0)
    else if (event.key === 'Enter' && results[index]) onReveal(results[index].id)
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  return h('section', { className: 'dshd-search', 'aria-label': t('search'), onKeyDown: (event) => {
    if (event.key === 'Escape' && !event.nativeEvent?.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation(); onClose()
    }
  } },
    h('div', { className: 'dshd-panel-head' },
      h('input', {
        ref: input, type: 'search', role: 'combobox', value: query,
        'aria-label': t('search'), placeholder: t('search.placeholder'),
        'aria-autocomplete': 'list', 'aria-expanded': results.length > 0,
        'aria-controls': id, 'aria-activedescendant': results.length ? `${id}-${index}` : undefined,
        onChange: (event) => { setQuery(event.target.value); setActive(0) }, onKeyDown,
      }),
      h('button', { type: 'button', className: 'dshd-btn', 'aria-label': t('close'), onClick: onClose }, '×')),
    h('div', { className: 'dshd-sr-only', role: 'status' }, t('search.results', { n: results.length })),
    h('ul', { role: 'listbox', id, 'aria-label': t('search.results', { n: results.length }) }, results.map((result, i) =>
      h('li', {
        key: result.id, id: `${id}-${i}`, role: 'option', 'aria-selected': i === index,
        onMouseDown: (event) => event.preventDefault(), onMouseEnter: () => setActive(i), onClick: () => onReveal(result.id),
      },
      h('strong', null, result.title),
      result.state ? h('span', { className: 'dshd-pill' }, stateLabel(result.state, t)) : null,
      ...(model.elements[result.id].marks ?? []).map((mark) => h('span', { key: mark, className: 'dshd-pill' }, t('mark.' + mark))),
      h('small', null, result.path)))),
    query.trim() && !results.length ? h('p', null, t('search.empty')) : null)
}
