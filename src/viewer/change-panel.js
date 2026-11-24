// Comparison controls and disclosures. This state is never serialized into exports.
import * as React from 'react'
import { endpointPath } from './relations.js'

const h = React.createElement
const version = (name) => `v${Number.parseInt(name, 10) || name}`

export function ComparisonBar({ t, state, projection, model, mode, chosen, history, onMode, onChosen }) {
  const counts = projection?.counts
  const unplaced = new Set(projection?.unplaced.map((element) => element.id) ?? [])
  const relation = (record, type, i) => comparisonRelation(record, type, i, state, model, t)
  return h(
    'section',
    { className: 'archd-changes', 'aria-label': t('changes') },
    h(
      'div',
      { className: 'archd-comparison-controls' },
      h(
        'label',
        null,
        t('changes.base'),
        ' ',
        h(
          'select',
          { value: mode, onChange: (event) => onMode(event.target.value) },
          ...['previous', 'first', 'chosen'].map((value) => h('option', { key: value, value }, t('changes.' + value))),
        ),
      ),
      mode === 'chosen'
        ? h(
            'label',
            null,
            t('changes.version'),
            ' ',
            h(
              'select',
              { value: chosen ?? history[0] ?? '', onChange: (event) => onChosen(event.target.value) },
              history.map((name) => h('option', { key: name, value: name }, version(name))),
            ),
          )
        : null,
    ),
    h(
      'p',
      { role: 'status' },
      state.phase === 'ready' && counts
        ? t('changes.compared', { version: version(state.name) }) + ' · ' + t('changes.summary', counts)
        : state.phase === 'error'
          ? t('changes.error')
          : t('changes.' + (state.phase === 'ready' ? 'loading' : state.phase)),
    ),
    h('p', { className: 'archd-muted' }, t('changes.note')),
    counts ? h('p', null, t('changes.relations', counts.relations)) : null,
    projection?.removed.length
      ? h(
          'details',
          null,
          h('summary', null, t('changes.removedList', { n: projection.removed.length })),
          h(
            'ul',
            null,
            projection.removed.map((element) =>
              h(
                'li',
                { key: element.id },
                `${element.title} — ${element.id}`,
                unplaced.has(element.id) ? ' · ' + t('changes.unplaced') : null,
              ),
            ),
          ),
        )
      : null,
    projection && Object.values(counts.relations).some(Boolean)
      ? h(
          'details',
          null,
          h('summary', null, t('changes.linkDetails')),
          h(
            'ul',
            null,
            ...['added', 'changed', 'removed'].flatMap((type) => projection.relations[type].map((record, i) => relation(record, type, i))),
          ),
        )
      : null,
  )
}

function comparisonRelation(record, type, i, state, model, t) {
    const item = record.after ?? record
    const graph = type === 'removed' ? state.model : model
    return h(
      'li',
      { key: type + ':' + (item.id ?? i) },
      { added: '+', changed: 'Δ', removed: '−' }[type] + ' ',
      endpointPath(graph, item.source, null),
      ' → ',
      endpointPath(graph, item.target, null),
      item.title ? ' : ' + item.title : '',
      record.fields?.length ? ' · ' + t('changes.fields', { fields: record.fields.map((field) => t('field.' + field)).join(', ') }) : null,
    )
  }
