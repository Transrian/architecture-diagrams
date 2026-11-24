import { useState, useRef, useEffect, useCallback } from 'react'
import { useDiagram } from './data.js'
import { requestIcons, iconsOf } from './iconpack.js'
import { useDirection } from './body-direction.js'
import { useComparison } from './body-comparison.js'
import { useBodyChrome } from './body-chrome.js'
import { useTrace } from './body-trace.js'
import { useBodyViews } from './body-views.js'
import { useBodyExplorer } from './body-explorer.js'

export function useDiagramBody(io, t) {
  const direction = useDirection()
  const { flow, setFlow, layoutDirection } = direction
  // Groups unfolded in place (element ids).
  const [expanded, setExpanded] = useState([])
  const toggle = useCallback(
    (id) => setExpanded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id && !x.startsWith(id + '.')) : [...cur, id].sort())),
    [],
  )
  const diagram = useDiagram(io, layoutDirection, expanded)
  const { history, pick, setPick, result } = diagram
  useEffect(() => requestIcons(iconsOf(result)), [result])
  const ctl = useRef({})
  // Identity, never a stale layout node: navigation and new layouts retain it.
  const [selectedId, setSelectedId] = useState(null)
  const traceState = useTrace(result)
  const comparison = useComparison(io, diagram)
  const views = useBodyViews(result, flow, setFlow)
  const chrome = useBodyChrome()
  const explorer = useBodyExplorer({ ...views, result, t, ctl, docked: chrome.docked, setSelectedId, setFlow })
  return {
    ...direction, ...traceState, ...comparison, ...views, ...chrome, ...explorer,
    t, expanded, setExpanded, toggle, diagram, history, pick, setPick, result, ctl, selectedId, setSelectedId,
  }
}
