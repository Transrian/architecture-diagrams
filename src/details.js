// Detail panels shown when a box or a link is clicked.
import * as React from 'react'
import { STATE_COLOR } from './theme.js'
import { textOf } from './shared.js'

const h = React.createElement
const stop = (e) => e.stopPropagation()

export function NodeDetail({ node, t, onClose, onEnter, elsewhere, onUnfold, onFold }) {
  const state = node.state
  const rows = []
  for (const [k, v] of Object.entries(node.metadataPlain ?? {})) {
    const key = ['why', 'decided', 'proof'].includes(k) ? t('meta.' + k) : k
    rows.push(h('dt', { key: 'k' + k }, key), h('dd', { key: 'v' + k }, String(v)))
  }
  const actions = [
    onUnfold ? h('button', { key: 'unfold', type: 'button', className: 'dshd-btn', onClick: onUnfold }, '+ ' + t('unfold')) : null,
    onFold ? h('button', { key: 'fold', type: 'button', className: 'dshd-btn', onClick: onFold }, '− ' + t('fold')) : null,
    onEnter ? h('button', { key: 'enter', type: 'button', className: 'dshd-btn', onClick: onEnter }, elsewhere ? t('goto') + ' ↗' : t('enter') + ' ▸') : null,
  ].filter(Boolean)
  return h('div', { className: 'dshd-detail', onPointerDown: stop },
    h('button', { type: 'button', className: 'dshd-x', 'aria-label': t('close'), onClick: onClose }, '×'),
    h('h4', null, node.title,
      state ? h('span', { className: 'dshd-pill', style: { color: STATE_COLOR.get(state) } }, t('state.' + state)) : null,
      ...(node.marks ?? []).map((m) => h('span', { key: m, className: 'dshd-pill' }, t('mark.' + m)))),
    h('p', { style: { margin: 0 } }, [t('kind.' + node.kind), node.technology].filter(Boolean).join(' · ') + `  —  ${node.id}`),
    textOf(node.description) ? h('p', null, textOf(node.description)) : null,
    node.rollup ? h('p', null, Object.entries(node.rollup.byState).map(([s, n]) => t('count.state', { n, state: t('state.' + s) })).join(' · ')) : null,
    rows.length ? h('dl', null, ...rows) : null,
    actions.length ? h('div', { style: { display: 'flex', gap: 6 } }, ...actions) : null)
}

export function EdgeDetail({ edge, t, onClose }) {
  const list = edge.relationList ?? []
  return h('div', { className: 'dshd-detail', onPointerDown: stop },
    h('button', { type: 'button', className: 'dshd-x', 'aria-label': t('close'), onClick: onClose }, '×'),
    h('h4', null, list.length > 1 ? t('count.links', { n: list.length }) : edge.label ?? ''),
    h('ul', null, list.map((r, i) => h('li', { key: i }, `${r.source} → ${r.target}${r.title ? ' : ' + r.title : ''}`))))
}
