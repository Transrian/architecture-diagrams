// Complete textual alternative to the diagram; shares the displayed model offline.
import * as React from 'react'
import { STATE_COLOR, stateLabel } from './theme.js'

const h = React.createElement
const GLYPH = { system: '▣', machine: '▤', service: '⚙', component: '◇', data: '▱', doc: '▧', person: '♙', external: '◎', hardware: '▥' }

export function outlineRow(state, id, level, index, size) {
  const { model, open, focused, currentGroup, t, onReveal, setActive, onKeyDown, toggle, focus, count } = state
  const element = model.elements[id]
  const group = element.children.length > 0
  const expanded = group && open.has(id)
  return h(
    'li',
    { key: id, role: 'none' },
    h(
      'div',
      {
        role: 'treeitem',
        tabIndex: id === focused ? 0 : -1,
        'aria-label': [
          element.title,
          t('kind.' + element.kind),
          element.state ? t('state.' + element.state) : '',
          ...(element.marks ?? []).map((mark) => t('mark.' + mark)),
          group && !expanded ? t('outline.hidden', { n: count(id) }) : '',
        ]
          .filter(Boolean)
          .join(', '),
        'aria-level': level,
        'aria-posinset': index + 1,
        'aria-setsize': size,
        'aria-expanded': group ? expanded : undefined,
        'aria-current': id === currentGroup ? 'location' : undefined,
        'data-element': id,
        onFocus: (event) => {
          if (event.target === event.currentTarget) setActive(id)
        },
        onKeyDown: (event) => onKeyDown(event, id),
      },
      h(
        'div',
        { className: 'dshd-tree-row', style: { paddingInlineStart: 8 + (level - 1) * 18 }, onClick: () => onReveal(id) },
        group
          ? h(
              'button',
              {
                type: 'button',
                tabIndex: -1,
                className: 'dshd-tree-toggle',
                'aria-label': t(expanded ? 'fold' : 'unfold'),
                onClick: (event) => {
                  event.stopPropagation()
                  toggle(id)
                  focus(id)
                },
              },
              expanded ? '▾' : '▸',
            )
          : h('span', { className: 'dshd-tree-toggle', 'aria-hidden': true }, '·'),
        h('span', { 'aria-hidden': true }, GLYPH[element.kind] ?? '◇'),
        h('span', { className: 'dshd-tree-title' }, element.title),
        element.state
          ? h('span', { className: 'dshd-pill', style: { color: STATE_COLOR.get(element.state) } }, stateLabel(element.state, t))
          : null,
        ...(element.marks ?? []).map((mark) => h('span', { key: mark, className: 'dshd-pill' }, t('mark.' + mark))),
        group && !expanded ? h('small', null, t('outline.hidden', { n: count(id) })) : null,
      ),
      expanded
        ? h(
            'ul',
            { role: 'group' },
            element.children.map((child, i) => outlineRow(state, child, level + 1, i, element.children.length)),
          )
        : null,
    ),
  )
}
