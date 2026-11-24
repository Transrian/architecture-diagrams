// Body composition: state lives in focused hooks, each panel has a named renderer.
import * as React from 'react'
import { viewLegend } from './theme.js'
import { useDiagramBody } from './body-state.js'
import { bodyContent } from './body-content.js'
import { BodyToolbar } from './body-toolbar.js'
import { TraceBar } from './body-trace.js'
import { BodyCrumbs, BodyNotices, BodyWorkspace, BodyLegend } from './body-panels.js'
const h = React.createElement

export function makeBody(io) {
  return function DiagramBody({ t, onConnectionChange }) {
    const state = useDiagramBody(io, t)
    React.useEffect(() => onConnectionChange?.(state.diagram.disconnected), [onConnectionChange, state.diagram.disconnected])
    return h(BodyLayout, state)
  }
}

function BodyLayout(state) {
  const { root, compact, helpOpen, closeHelp, traceResult, setTraceSpec, exploring, closeExplorer, result, openExplorer, currentView } =
    state
  const content = bodyContent(state)
  return h(
    'div',
    {
      ref: root,
      className: 'archd-root' + (compact ? ' archd-compact' : ''),
      onKeyDownCapture: (event) => {
        if (helpOpen && event.key === 'Escape' && !event.nativeEvent?.isComposing) {
          event.preventDefault()
          event.stopPropagation()
          closeHelp(true)
        }
      },
      onKeyDown: (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent?.isComposing) return
        if (event.key === 'Escape' && traceResult) {
          event.preventDefault()
          event.stopPropagation()
          setTraceSpec(null)
          return
        }
        // Escape closes what the focus is in: help first (above), the explorer from inside it (its own
        // handler); on the canvas the trace, then the details (stage), and only then a docked explorer.
        if (event.key === 'Escape' && exploring) {
          event.preventDefault()
          event.stopPropagation()
          closeExplorer()
          return
        }
        if (event.key !== '/' || !result?.model) return
        if (event.target.closest?.('input, textarea, select, [contenteditable=true]')) return
        event.preventDefault()
        event.stopPropagation()
        openExplorer()
      },
    },
    h(BodyToolbar, state),
    h(BodyCrumbs, { ...state, content }),
    h(BodyNotices, state),
    h(TraceBar, state),
    h(BodyWorkspace, { ...state, content }),
    state.diagram.phase !== 'empty' ? h(BodyLegend, { ...state, legend: viewLegend(currentView) }) : null,
  )
}
