import { useState, useRef, useLayoutEffect, useEffect, useId } from 'react'
import { readPreference, writePreference } from './preferences.js'
export function useBodyChrome() {
  // Chrome sizing: the measured width of the viewer drives the compact toolbar and the legend default.
  const root = useRef(null)
  const tools = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return undefined
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Labels stay while the labelled tools fit on one row of the viewer; below
  // 560 px, or when they would not fit, the tools show their icons only.
  const [labelled, setLabelled] = useState(0)
  const compact = width > 0 && (width < 560 || (labelled > 0 && labelled > width - 20))
  // Wide viewers dock the explorer beside the canvas; narrow ones lay it over the canvas.
  const docked = width > 900
  useLayoutEffect(() => {
    if (compact || !tools.current) return
    const items = [...tools.current.children]
    const natural = items.reduce((sum, item) => sum + item.offsetWidth, 0) + 6 * Math.max(0, items.length - 1)
    if (Math.abs(natural - labelled) > 1) setLabelled(natural)
  })
  const [legendPref, setLegendPref] = useState(() => {
    const saved = readPreference('dsh-diagram.legend')
    return ['open', 'closed'].includes(saved) ? saved : null
  })
  const legendOpen = legendPref ? legendPref === 'open' : width === 0 || width >= 600
  const toggleLegend = () => {
    const next = legendOpen ? 'closed' : 'open'
    setLegendPref(next)
    writePreference('dsh-diagram.legend', next)
  }
  const legendId = 'dshd-legend-' + useId().replace(/:/g, '')
  const [helpOpen, setHelpOpen] = useState(false)
  const helpButton = useRef(null)
  const helpId = 'dshd-help-' + useId().replace(/:/g, '')
  const closeHelp = (returnFocus) => {
    setHelpOpen(false)
    if (returnFocus) requestAnimationFrame(() => helpButton.current?.focus())
  }
  useEffect(() => {
    if (!helpOpen) return undefined
    const outside = (event) => {
      if (event.target.closest?.('.dshd-help') || helpButton.current?.contains(event.target)) return
      setHelpOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [helpOpen])

  return {
    root, tools, width, compact, docked, legendOpen, toggleLegend, legendId,
    helpOpen, setHelpOpen, helpButton, helpId, closeHelp,
  }
}
