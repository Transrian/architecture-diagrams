import { useState, useEffect } from 'react'
import { viewForElement } from './navigation.js'

export function useBodyExplorer({
  result,
  t,
  ctl,
  docked,
  setSelectedId,
  setFlow,
  flowView,
  tree,
  setReturnTo,
  setInitial,
  focus,
  chosen,
}) {
  const [exploring, setExploring] = useState(false)
  const [explorerToken, setExplorerToken] = useState(0) // bumped to put the keyboard back in its field
  const [pendingReveal, setPendingReveal] = useState(null)
  const [navigationNote, setNavigationNote] = useState(null)
  const focusStage = () => requestAnimationFrame(() => ctl.current.focus?.())
  const closeExplorer = () => {
    setExploring(false)
    focusStage()
  }
  const openExplorer = () => {
    setExploring(true)
    setExplorerToken((n) => n + 1)
  }
  useExplorerShortcut(!!result?.model, openExplorer)
  const reveal = (id) => {
    if (!viewForElement(result, id)) {
      setNavigationNote(t('reveal.missing'))
      return
    }
    setNavigationNote(null)
    setSelectedId(id)
    // A docked explorer stays open so the user can go on browsing; over the canvas it gives way.
    if (!docked) setExploring(false)
    setFlow(null)
    setPendingReveal(id)
  }
  useEffect(() => {
    if (!pendingReveal || flowView || !tree) return
    const target = viewForElement(result, pendingReveal)
    if (!target || !tree.entries.has(target)) {
      setNavigationNote(t('reveal.missing'))
      setPendingReveal(null)
      return
    }
    if (ctl.current.reveal?.(pendingReveal)) setPendingReveal(null)
  }, [pendingReveal, flowView, tree, result])

  const chooseSchema = (id) => {
    if (!docked) setExploring(false)
    setReturnTo(null)
    if (!flowView && ctl.current.has?.(id) && ctl.current.flyTo(id)) return
    setFlow(null)
    setInitial(id)
  }
  const enterFlow = (id) => {
    if (!flowView) setReturnTo(focus ?? chosen)
    setFlow(id)
  }
  const leaveFlow = () => setFlow(null)

  return {
    exploring,
    explorerToken,
    pendingReveal,
    setPendingReveal,
    navigationNote,
    closeExplorer,
    openExplorer,
    reveal,
    chooseSchema,
    enterFlow,
    leaveFlow,
  }
}

function useExplorerShortcut(enabled, onSearch) {
  useEffect(() => {
    if (!enabled) return undefined
    const onKeyDown = (event) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const target = event.target
      if (target.isContentEditable || target.closest?.('input, textarea, select')) return
      event.preventDefault()
      onSearch()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, onSearch])
}
