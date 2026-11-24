import * as React from 'react'
import { useState, useMemo } from 'react'
import { trace, projectTrace } from './trace.js'
import { endpointPath } from './relations.js'

const h = React.createElement
export function useTrace(result) {
  const [traceSpec, setTraceSpec] = useState(null)
  const traceResult = useMemo(
    () => (traceSpec && result?.model?.elements[traceSpec.id] ? trace(result.model, traceSpec.id, traceSpec.mode) : null),
    [traceSpec, result?.model],
  )

  return { traceSpec, setTraceSpec, traceResult }
}

export function TraceBar({ traceResult, traceSpec, currentView, result, t, reveal, setTraceSpec }) {
  const traceProjection = useMemo(() => (traceResult ? projectTrace(traceResult, currentView) : null), [traceResult, currentView])
  return traceResult
    ? h(
        'div',
        { className: 'archd-trace' },
        h(
          'div',
          { role: 'status' },
          t('trace.title', { mode: t('trace.' + traceSpec.mode), title: result.model.elements[traceSpec.id].title }),
          ' · ',
          t('trace.summary', { n: Object.keys(traceResult.elements).length, hidden: traceProjection.hidden.length }),
        ),
        h('button', { type: 'button', className: 'archd-btn', onClick: () => setTraceSpec(null) }, t('trace.clear')),
        traceProjection.hidden.length
          ? h(
              'details',
              null,
              h('summary', null, t('trace.hidden', { n: traceProjection.hidden.length })),
              h(
                'ul',
                null,
                traceProjection.hidden.map((id) =>
                  h(
                    'li',
                    { key: id },
                    h(
                      'button',
                      { type: 'button', className: 'archd-btn', onClick: () => reveal(id) },
                      endpointPath(result.model, id, null),
                    ),
                  ),
                ),
              ),
            )
          : null,
      )
    : null
}
