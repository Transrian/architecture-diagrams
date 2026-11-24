import { useState, useEffect, useMemo } from 'react'
import { loadModel } from './data.js'
import { diffModels } from '../core/diff.js'
import { projectChanges } from './changes.js'
import { resolveComparisonBase } from './comparison.js'
export function useComparison(io, diagram) {
  const { history, result } = diagram
  const [changesEnabled, setChangesEnabled] = useState(false)
  const [baseMode, setBaseMode] = useState('previous')
  const [chosenBase, setChosenBase] = useState(null)
  const [comparison, setComparison] = useState({ phase: 'idle', key: null })
  const comparisonKey = JSON.stringify([diagram.source?.text, diagram.source?.pick, history, baseMode, chosenBase ?? history[0]])
  useEffect(() => {
    if (!changesEnabled) return undefined
    const abort = new AbortController()
    const { signal } = abort
    setComparison({ phase: 'loading', key: comparisonKey })
    ;(async () => {
      const baseline = await resolveComparisonBase(
        { history, source: diagram.source, mode: baseMode, chosen: chosenBase ?? history[0] },
        async (name) => {
          if (!/^[^/\\]+[.]c4$/.test(name)) throw new Error('Invalid comparison snapshot')
          return io.snapshot(name, signal)
        },
      )
      if (signal.aborted) return
      if (baseline.phase !== 'ready') {
        setComparison({ ...baseline, key: comparisonKey })
        return
      }
      const model = await loadModel(baseline.text)
      if (signal.aborted) return
      if (!model) throw new Error('Invalid comparison model')
      setComparison({ phase: 'ready', name: baseline.name, model, key: comparisonKey })
    })().catch(() => {
      if (!signal.aborted) setComparison({ phase: 'error', key: comparisonKey })
    })
    return () => abort.abort()
  }, [changesEnabled, comparisonKey, io])
  const currentComparison = !changesEnabled ? { phase: 'idle' } : comparison.key === comparisonKey ? comparison : { phase: 'loading' }
  const changesProjection = useMemo(
    () =>
      currentComparison.phase === 'ready' && result?.model
        ? projectChanges(diffModels(currentComparison.model, result.model), result.model)
        : null,
    [currentComparison.phase, currentComparison.model, result?.model],
  )

  return {
    changesEnabled,
    setChangesEnabled,
    baseMode,
    setBaseMode,
    chosenBase,
    setChosenBase,
    currentComparison,
    changesProjection,
  }
}
