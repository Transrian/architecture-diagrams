import * as React from 'react'
import { ZoomStage } from './stage.js'
const h = React.createElement

export function bodyContent({ diagram, tree, result, expanded, start, t, ctl, setFocus, toggle, openExplorer,
  selectedId, setSelectedId, pendingReveal, setPendingReveal, reveal, traceResult, setTraceSpec, traceSpec, changesProjection }) {
  let content
  const state = diagram
  if (state.phase === 'loading') content = h('div', { className: 'dshd-msg' }, t('loading'))
  else if (state.phase === 'engine') content = h('div', { className: 'dshd-msg' }, t('engine'))
  else if (state.phase === 'empty')
    content = h('div', { className: 'dshd-msg' }, h('b', null, t('empty.title')), h('span', null, t('empty.body')))
  else if (state.phase === 'error')
    content = h('div', { className: 'dshd-msg' }, h('b', null, t('readFailed')), h('code', null, state.message))
  else if (!tree) content = h('div', { className: 'dshd-msg' }, t('noValid'))
  else {
    content = h(ZoomStage, {
      tree,
      result,
      model: result.model,
      expanded,
      start,
      t,
      ctl,
      onFocus: setFocus,
      onToggle: toggle,
      onSearch: openExplorer,
      selectedId,
      onSelect: (id) => {
        setSelectedId(id)
        if (id !== pendingReveal) setPendingReveal(null)
      },
      onReveal: reveal,
      traceResult,
      onTrace: (id, mode) => setTraceSpec({ id, mode }),
      onClearTrace: () => setTraceSpec(null),
      traceActive: !!traceResult,
      traceMode: traceSpec?.id === selectedId ? traceSpec.mode : null,
      changes: changesProjection,
    })
  }

  return content
}
