// Comparison controls and disclosures. This state is never serialized into exports.
import * as React from 'react'
import { changeSummary } from './translation.js'
import { endpointPath } from './relations.js'

const h = React.createElement
const version = (name) => `v${Number.parseInt(name, 10) || name}`

export function ComparisonBar({ t, state, projection, model, mode, chosen, history, onMode, onChosen }) {
  const counts = projection?.counts
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
        ? t('changes.compared', { version: version(state.name) }) + ' · ' + changeSummary(counts, t)
        : state.phase === 'error'
          ? t('changes.error')
          : t('changes.' + (state.phase === 'ready' ? 'loading' : state.phase)),
    ),
    h('div', { className: 'archd-comparison-scroll' },
      h('p', { className: 'archd-muted' }, t('changes.note')),
      counts ? h('p', null, t('changes.relations', counts.relations)) : null,
      h(ComparisonDisclosures, { projection, state, model, t })),
  )
}

function ComparisonDisclosures({ projection, state, model, t }) {
  const unplaced = new Set(projection?.unplaced.map((element) => element.id) ?? [])
  const relation = (record, type, i) => comparisonRelation(record, type, i, state, model, t)
  return h(React.Fragment, null,
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
    projection && Object.values(projection.counts.relations).some(Boolean)
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
      h(ChangedFields, { record, t }),
    )
  }

function fieldText(value, field, t, kindKey) {
  if (value == null || value === '') return t('changes.empty')
  const text = field === 'state' ? t('state.' + value)
    : field === 'kind' ? t(kindKey + value)
    : typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 160 ? text.slice(0, 159) + '…' : text
}

export function ChangedFields({ record, t }) {
  if (!record?.fields?.length) return null
  const kindKey = record.after.source ? 'relation.' : 'kind.'
  const value = (side, field) => fieldText(record[side][field], field, t, kindKey)
  return h('dl', { className: 'archd-field-values' }, ...record.fields.flatMap((field) => [
    h('dt', { key: field }, t('field.' + field)),
    h('dd', { key: field + ':values' }, value('before', field), ' → ', value('after', field)),
  ]))
}
