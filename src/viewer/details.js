// Detail panels shown when a box or a link is clicked.
import * as React from 'react'
import { changeSummary, hiddenLinkSummary } from './translation.js'
import { STATE_COLOR, stateLabel, relationLabel } from './theme.js'
import { textOf } from '../core/shared.js'
import { endpointPath } from './relations.js'
import { CloseButton } from './icons.js'
import { ChangedFields } from './change-panel.js'

const h = React.createElement
const stop = (e) => e.stopPropagation()
const metadataRows = (metadata, t) =>
  Object.entries(metadata ?? {}).flatMap(([key, value]) => [
    h('dt', { key: 'k' + key }, ['why', 'decided', 'proof', 'source'].includes(key) ? t('meta.' + key) : key),
    h('dd', { key: 'v' + key }, String(value)),
  ])

export function NodeDetail({ node, t, sheet, onClose, onEnter, elsewhere, onUnfold, onFold, onReveal, onTrace, traceMode, change }) {
  const state = node.state
  const rows = metadataRows(node.metadataPlain, t)
  // Navigation actions on one row; tracing is a separate, labelled toggle group.
  const actions = [
    onReveal ? h('button', { key: 'reveal', type: 'button', className: 'archd-btn', onClick: onReveal }, t('reveal')) : null,
    onUnfold ? h('button', { key: 'unfold', type: 'button', className: 'archd-btn', onClick: onUnfold }, '⊕ ' + t('unfold')) : null,
    onFold ? h('button', { key: 'fold', type: 'button', className: 'archd-btn', onClick: onFold }, '⊖ ' + t('fold')) : null,
    onEnter
      ? h('button', { key: 'enter', type: 'button', className: 'archd-btn', onClick: onEnter }, elsewhere ? t('goto') + ' ↗' : t('enter'))
      : null,
  ].filter(Boolean)
  const traceRow = traceControls(t, onTrace, traceMode)
  return h(
    'div',
    { className: 'archd-detail' + (sheet ? ' archd-sheet' : ''), onPointerDown: stop },
    h(CloseButton, { t, onClick: onClose }),
    h(
      'h4',
      null,
      node.title,
      state ? h('span', { className: 'archd-pill', style: { color: STATE_COLOR.get(state) } }, stateLabel(state, t)) : null,
      ...(node.marks ?? []).map((m) => h('span', { key: m, className: 'archd-pill' }, t('mark.' + m))),
    ),
    h('p', { style: { margin: 0 } }, [t('kind.' + node.kind), node.technology].filter(Boolean).join(' · ') + `  —  ${node.id}`),
    textOf(node.description) ? h('p', null, textOf(node.description)) : null,
    node.rollup
      ? h(
          'p',
          null,
          Object.entries(node.rollup.byState)
            .map(([s, n]) => t('count.state', { n, state: stateLabel(s, t) }))
            .join(' · '),
        )
      : null,
    node.assumedCount > 0 ? h('p', null, t('count.assumed', { n: node.assumedCount })) : null,
    Number.isInteger(node.internalLinks) && !node.children?.length
      ? h('p', null, hiddenLinkSummary(node.internalLinks, node.externalLinks, t))
      : null,
    onReveal ? h('p', null, t('selection.hidden')) : null,
    rows.length ? h('dl', null, ...rows) : null,
    change
      ? h(
          'section',
          { className: 'archd-node-changes' },
          h('h5', null, t('changes.element')),
          h('p', null, changeSummary(change.total, t)),
          h(ChangedFields, { record: change.changedRecord, t }),
          change.from ? h('p', null, t('changes.from', { path: change.from })) : null,
          change.removedElements.length
            ? h(
                'details',
                null,
                h('summary', null, t('changes.removedList', { n: change.removedElements.length })),
                h(
                  'ul',
                  null,
                  change.removedElements.map((element) => h('li', { key: element.id }, `${element.title} — ${element.id}`)),
                ),
              )
            : null,
        )
      : null,
    actions.length ? h('div', { className: 'archd-actions' }, ...actions) : null,
    traceRow,
  )
}

export function EdgeDetail({ edge, model, view, t, sheet, onClose, onUnfoldEndpoints }) {
  const list = edge.relationList ?? []
  return h(
    'div',
    { className: 'archd-detail' + (sheet ? ' archd-sheet' : ''), onPointerDown: stop },
    h(CloseButton, { t, onClick: onClose }),
    h('h4', null, relationLabel(edge, 0, false, t), edge.mixed ? h('span', { className: 'archd-pill' }, t('states.mixed')) : null),
    edge.assumedCount > 0 ? h('p', null, t('count.assumedLinks', { n: edge.assumedCount, total: list.length })) : null,
    h(
      'ul',
      null,
      list.map((r, i) =>
        h(
          'li',
          { key: r.id ?? i },
          h('span', { title: r.sourceId }, r.sourceId ? endpointPath(model, r.sourceId, view) : r.source),
          ' → ',
          h('span', { title: r.targetId }, r.targetId ? endpointPath(model, r.targetId, view) : r.target),
          h(
            'span',
            { style: r.marks?.includes('assumed') ? { fontStyle: 'italic' } : undefined },
            r.title ? ' : ' + r.title : '',
            r.marks?.includes('assumed') ? ' ?' : '',
          ),
          h('span', { className: 'archd-pill' }, t('relation.' + (r.kind ?? 'call'))),
          h(
            'span',
            { className: 'archd-pill', style: r.state ? { color: STATE_COLOR.get(r.state) } : undefined },
            r.state ? stateLabel(r.state, t) : t('states.none'),
          ),
          ...(r.marks ?? []).map((m) => h('span', { key: m, className: 'archd-pill' }, t('mark.' + m))),
          Object.keys(r.metadata ?? {}).length ? h('dl', null, ...metadataRows(r.metadata, t)) : null,
        ),
      ),
    ),
    onUnfoldEndpoints
      ? h('button', { type: 'button', className: 'archd-btn', onClick: onUnfoldEndpoints }, '⊕ ' + t('unfoldEndpoints'))
      : null,
  )
}

function traceControls(t, onTrace, traceMode) {
  const traceLabel = t('trace.label')
  const traceRow = onTrace
    ? h(
        'div',
        { className: 'archd-trace-modes', role: 'group', 'aria-label': t('trace.group') },
        h('span', { className: 'archd-trace-label', 'aria-hidden': true }, traceLabel),
        h(
          'div',
          { className: 'archd-segmented' },
          ...['neighbours', 'upstream', 'downstream'].map((mode) =>
            h(
              'button',
              {
                key: mode,
                type: 'button',
                className: 'archd-btn',
                'aria-pressed': traceMode === mode,
                onClick: () => onTrace(mode),
              },
              t('trace.' + mode),
            ),
          ),
        ),
      )
    : null
  return traceRow
}
