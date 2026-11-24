import { useState, useEffect, useMemo } from 'react'
import { buildTree, pathOf } from './zoom-tree.js'

export function useBodyViews(result, flow, setFlow) {
  const [initial, setInitial] = useState(null) // schema to start in
  const [focus, setFocus] = useState(null) // view the camera is in (reported by the stage)
  const byId = useMemo(() => new Map((result?.views ?? []).map((v) => [v.id, v])), [result])
  const schemas = result?.schemas ?? []
  const extras = result?.extras ?? []
  const flowView = flow && byId.has(flow) ? flow : null
  // A flow removed from the file: back to the schemas (and their direction).
  useEffect(() => {
    if (flow && result && !byId.has(flow)) setFlow(null)
  }, [flow, result, byId])
  // One canvas for every schema: the overview (LikeC4's index view) holds them all.
  const overview = byId.has('index')
  const chosen = initial && schemas.some((x) => x.view === initial) ? initial : schemas[0]?.view
  const rootId = flowView ?? (overview ? 'index' : chosen)
  const tree = useMemo(() => (result && rootId ? buildTree(result, rootId, !!flowView) : null), [result, rootId, flowView])
  // Leaving a flow returns to the view shown before it (once, then the schema rules again).
  const [returnTo, setReturnTo] = useState(null)
  const start = flowView ?? (returnTo && tree?.entries.has(returnTo) ? returnTo : chosen)
  useEffect(() => {
    if (!flowView && returnTo && focus === returnTo) setReturnTo(null)
  }, [flowView, returnTo, focus])
  const path = tree && focus && tree.entries.has(focus) ? pathOf(tree, focus) : tree ? [tree.root.id] : []

  const currentView = tree?.entries.get(focus)?.view ?? tree?.entries.get(start)?.view
  return { byId, schemas, extras, flowView, chosen, tree, start, path, focus, setFocus, setInitial, setReturnTo, currentView }
}
