// The tab body: toolbar (schema tabs and flows, then tools: versions, panels,
// direction, fit, export, help), breadcrumb, problems, the zoomable stage and
// the collapsible legend.
import * as React from 'react'
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useId } from 'react'
import { V, STATE_COLOR, GROUP_COLOR, viewLegend, stateLabel } from './theme.js'
import { RelationSample } from './shapes.js'
import { useDiagram, loadModel } from './data.js'
import { diffModels } from './diff.js'
import { projectChanges } from './changes.js'
import { resolveComparisonBase } from './comparison.js'
import { ComparisonBar } from './change-panel.js'
import { safeId } from './shared.js'
import { buildTree, pathOf } from './zoom.js'
import { ZoomStage } from './stage.js'
import { Explorer } from './explorer.js'
import { viewForElement } from './navigation.js'
import { trace, projectTrace } from './trace.js'
import { endpointPath } from './relations.js'
import { DirIcon, DownloadIcon, SearchIcon, FitIcon, FoldAllIcon, HelpIcon, CloseButton } from './icons.js'
import { HelpPopover } from './help.js'
import { download, fileName } from './export.js'
import { requestIcons, iconsOf } from './iconpack.js'

const h = React.createElement

export function makeBody(io, { exportHtml } = {}) {
  return function DiagramBody(props) {
    const { t, diagramSessionId: sessionId } = props
    const [direction, setDirection] = useState(() => {
      try { return localStorage.getItem('dsh-diagram.direction') || 'TopBottom' } catch { return 'TopBottom' }
    })
    // Flows follow the shape of the stage (wide: left to right) until the user picks a direction for them.
    const [flowDirection, setFlowDirection] = useState(() => {
      try { return ['LeftRight', 'TopBottom'].includes(localStorage.getItem('dsh-diagram.flowDirection')) ? localStorage.getItem('dsh-diagram.flowDirection') : null } catch { return null }
    })
    const area = useRef(null)
    const [areaSize, setAreaSize] = useState({ w: 0, h: 0 })
    useLayoutEffect(() => {
      const el = area.current
      if (!el) return undefined
      const measure = () => setAreaSize((cur) => (cur.w === el.clientWidth && cur.h === el.clientHeight ? cur : { w: el.clientWidth, h: el.clientHeight }))
      measure()
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }, [])
    const [flow, setFlow] = useState(null) // dynamic view shown instead of the zoomable diagram
    const autoFlowDirection = areaSize.w > 1.3 * areaSize.h ? 'LeftRight' : 'TopBottom'
    const layoutDirection = flow ? flowDirection ?? autoFlowDirection : direction
    const flip = () => {
      const next = layoutDirection === 'LeftRight' ? 'TopBottom' : 'LeftRight'
      if (flow) {
        setFlowDirection(next)
        try { localStorage.setItem('dsh-diagram.flowDirection', next) } catch {}
        return
      }
      setDirection(next)
      try { localStorage.setItem('dsh-diagram.direction', next) } catch {}
    }
    // Groups unfolded in place (element ids), for this Session only.
    const [expanded, setExpanded] = useState([])
    useEffect(() => setExpanded([]), [sessionId])
    const toggle = useCallback((id) => setExpanded((cur) => (cur.includes(id)
      ? cur.filter((x) => x !== id && !x.startsWith(id + '.'))
      : [...cur, id].sort())), [])
    // DSH's standard `useResource` slot hook pushes file changes; absent on older DSH (then: polling).
    const useResource = typeof props.useResource === 'function' ? props.useResource : undefined
    const diagram = useDiagram(io, sessionId, layoutDirection, expanded, useResource)
    const { history, pick, setPick, result } = diagram
    useEffect(() => requestIcons(iconsOf(result)), [result])
    const [initial, setInitial] = useState(null) // schema to start in
    const [focus, setFocus] = useState(null) // view the camera is in (reported by the stage)
    const ctl = useRef({})
    // Identity, never a stale layout node: navigation and new layouts retain it.
    const [selectedId, setSelectedId] = useState(null)
    const [traceSpec, setTraceSpec] = useState(null)
    useEffect(() => { setSelectedId(null); setTraceSpec(null) }, [sessionId])
    const traceResult = useMemo(() => traceSpec && result?.model?.elements[traceSpec.id]
      ? trace(result.model, traceSpec.id, traceSpec.mode) : null, [traceSpec, result?.model])

    const [changesEnabled, setChangesEnabled] = useState(false)
    const [baseMode, setBaseMode] = useState('previous')
    const [chosenBase, setChosenBase] = useState(null)
    const [comparison, setComparison] = useState({ phase: 'idle', key: null })
    const comparisonKey = JSON.stringify([sessionId, diagram.targetId, diagram.source?.text, diagram.source?.pick, history, baseMode, chosenBase ?? history[0]])
    useEffect(() => {
      setChangesEnabled(false); setBaseMode('previous'); setChosenBase(null)
    }, [sessionId])
    useEffect(() => {
      if (!changesEnabled) return undefined
      const abort = new AbortController()
      const { signal } = abort
      setComparison({ phase: 'loading', key: comparisonKey })
      ;(async () => {
        const baseline = await resolveComparisonBase({ history, source: diagram.source, mode: baseMode, chosen: chosenBase ?? history[0] }, async (name) => {
          if (!diagram.targetId || !/^[^/\\]+[.]c4$/.test(name)) throw new Error('Invalid comparison snapshot')
          return (await io.readText(sessionId, `.diagram/${safeId(diagram.targetId)}/${name}`, signal)).text
        })
        if (signal.aborted) return
        if (baseline.phase !== 'ready') { setComparison({ ...baseline, key: comparisonKey }); return }
        const model = await loadModel(baseline.text)
        if (signal.aborted) return
        if (!model) throw new Error('Invalid comparison model')
        setComparison({ phase: 'ready', name: baseline.name, model, key: comparisonKey })
      })().catch(() => { if (!signal.aborted) setComparison({ phase: 'error', key: comparisonKey }) })
      return () => abort.abort()
    }, [changesEnabled, comparisonKey, io])
    const currentComparison = !changesEnabled ? { phase: 'idle' } : comparison.key === comparisonKey ? comparison : { phase: 'loading' }
    const changesProjection = useMemo(() => currentComparison.phase === 'ready' && result?.model
      ? projectChanges(diffModels(currentComparison.model, result.model), result.model) : null, [currentComparison.phase, currentComparison.model, result?.model])

    const byId = useMemo(() => new Map((result?.views ?? []).map((v) => [v.id, v])), [result])
    const schemas = result?.schemas ?? []
    const extras = result?.extras ?? []
    const flowView = flow && byId.has(flow) ? flow : null
    // A flow removed from the file: back to the schemas (and their direction).
    useEffect(() => { if (flow && result && !byId.has(flow)) setFlow(null) }, [flow, result, byId])
    // One canvas for every schema: the overview (LikeC4's index view) holds them all.
    const overview = byId.has('index')
    const chosen = initial && schemas.some((x) => x.view === initial) ? initial : schemas[0]?.view
    const rootId = flowView ?? (overview ? 'index' : chosen)
    const tree = useMemo(() => (result && rootId ? buildTree(result, rootId, !!flowView) : null), [result, rootId, flowView])
    // Leaving a flow returns to the view shown before it (once, then the schema rules again).
    const [returnTo, setReturnTo] = useState(null)
    useEffect(() => setReturnTo(null), [sessionId])
    const start = flowView ?? (returnTo && tree?.entries.has(returnTo) ? returnTo : chosen)
    useEffect(() => { if (!flowView && returnTo && focus === returnTo) setReturnTo(null) }, [flowView, returnTo, focus])
    const path = tree && focus && tree.entries.has(focus) ? pathOf(tree, focus) : tree ? [tree.root.id] : []

    const [exploring, setExploring] = useState(false)
    const [explorerToken, setExplorerToken] = useState(0) // bumped to put the keyboard back in its field
    const [pendingReveal, setPendingReveal] = useState(null)
    const [navigationNote, setNavigationNote] = useState(null)
    const focusStage = () => requestAnimationFrame(() => ctl.current.focus?.())
    const closeExplorer = () => { setExploring(false); focusStage() }
    const openExplorer = () => { setExploring(true); setExplorerToken((n) => n + 1) }
    const reveal = (id) => {
      if (!viewForElement(result, id)) { setNavigationNote(t('reveal.missing')); return }
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
    useEffect(() => {
      setExploring(false); setPendingReveal(null); setNavigationNote(null)
    }, [sessionId])

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

    const last = history.length - 1 // the live diagram is the newest notch
    const idx = pick === null ? last : history.indexOf(pick)
    const setIdx = (i) => setPick(i >= last || i < 0 ? null : history[i])

    let content
    let staged = false
    const state = diagram
    if (state.phase === 'loading') content = h('div', { className: 'dshd-msg' }, t('loading'))
    else if (state.phase === 'engine') content = h('div', { className: 'dshd-msg' }, t('engine'))
    else if (state.phase === 'empty') content = h('div', { className: 'dshd-msg' }, h('b', null, t('empty.title')), h('span', null, t('empty.body')))
    else if (state.phase === 'legacy') content = h('div', { className: 'dshd-msg' }, h('b', null, t('legacy')))
    else if (state.phase === 'error') content = h('div', { className: 'dshd-msg' }, h('b', null, t('readFailed')), h('code', null, state.message))
    else if (!tree) content = h('div', { className: 'dshd-msg' }, t('noValid'))
    else {
      staged = true
      content = h(ZoomStage, { tree, result, model: result.model, expanded, start, t, ctl, onFocus: setFocus, onToggle: toggle, onSearch: openExplorer,
        selectedId, onSelect: (id) => { setSelectedId(id); if (id !== pendingReveal) setPendingReveal(null) }, onReveal: reveal,
        traceResult, onTrace: (id, mode) => setTraceSpec({ id, mode }), onClearTrace: () => setTraceSpec(null), traceActive: !!traceResult, traceMode: traceSpec?.id === selectedId ? traceSpec.mode : null, changes: changesProjection,
      })
    }

    const currentView = tree?.entries.get(focus)?.view ?? tree?.entries.get(start)?.view
    const legend = viewLegend(currentView)
    const traceProjection = useMemo(() => traceResult ? projectTrace(traceResult, currentView) : null, [traceResult, currentView])
    const viewTitle = (id) => (id === 'index' ? t('overview') : byId.get(id)?.title ?? id)
    const [exporting, setExporting] = useState(false)
    const [exportError, setExportError] = useState(null)
    useEffect(() => setExportError(null), [sessionId])
    const downloadHtml = async () => {
      if (!diagram.source || exporting) return
      setExportError(null)
      setExporting(true)
      try {
        // Capture the displayed source before loading any assets: live updates
        // or timeline navigation during export must not change the snapshot.
        const { text, pick: version } = diagram.source
        const title = schemas.map((schema) => schema.title).join(' · ') || 'diagram'
        const name = title + (version === null ? '' : ` · v${Number.parseInt(version, 10)}`)
        const html = await exportHtml({ text, name })
        download(new Blob([html], { type: 'text/html;charset=utf-8' }), fileName(name))
      } catch (e) {
        console.error('[dsh-diagram] HTML export', e)
        setExportError(t('html.failed') + ': ' + String(e?.message ?? e))
      } finally {
        setExporting(false)
      }
    }
    // Chrome sizing: the measured width of the tab drives the compact toolbar and the legend default.
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
    // Labels stay while the labelled tools fit on one row of the tab; below
    // 560 px, or when they would not fit, the tools show their icons only.
    const [labelled, setLabelled] = useState(0)
    const compact = width > 0 && (width < 560 || (labelled > 0 && labelled > width - 20))
    // Wide tabs dock the explorer beside the canvas; narrow ones lay it over the canvas.
    const docked = width > 900
    useLayoutEffect(() => {
      if (compact || !tools.current) return
      const items = [...tools.current.children]
      const natural = items.reduce((sum, item) => sum + item.offsetWidth, 0) + 6 * Math.max(0, items.length - 1)
      if (Math.abs(natural - labelled) > 1) setLabelled(natural)
    })
    const [legendPref, setLegendPref] = useState(() => {
      try { return ['open', 'closed'].includes(localStorage.getItem('dsh-diagram.legend')) ? localStorage.getItem('dsh-diagram.legend') : null } catch { return null }
    })
    const legendOpen = legendPref ? legendPref === 'open' : width === 0 || width >= 600
    const toggleLegend = () => {
      const next = legendOpen ? 'closed' : 'open'
      setLegendPref(next)
      try { localStorage.setItem('dsh-diagram.legend', next) } catch {}
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
    useEffect(() => setHelpOpen(false), [sessionId])

    /** A toolbar tool: label and icon, icon only when compact; the full name stays in aria-label and title. */
    const tool = ({ key, name, text = name, icon, title, pressed, disabled, onClick, className, ref, controls, glyph }) => h('button', {
      key, ref, type: 'button', className: 'dshd-btn dshd-tool' + (compact || !text ? ' dshd-icon' : '') + (className ? ' ' + className : ''),
      'aria-label': name, title: title ?? name, 'aria-pressed': pressed, 'aria-controls': controls, disabled, onClick,
    }, icon ? h(icon) : null, glyph ? h('span', { 'aria-hidden': true }, glyph) : null, compact || !text ? null : h('span', null, text))

    const tabs = schemas.length > 1 || extras.length ? schemas.map((b) => h('button', {
      key: b.view, type: 'button', className: 'dshd-tab', 'data-label': b.title,
      'aria-current': !flowView && path.includes(b.view) ? 'true' : undefined,
      onClick: () => chooseSchema(b.view),
    }, b.title)) : []
    const flows = extras.map((b) => h('button', {
      key: b.view, type: 'button', className: 'dshd-tab dshd-flow', 'data-label': '▶ ' + b.title,
      'aria-current': flowView === b.view ? 'true' : undefined,
      onClick: () => enterFlow(b.view),
    }, h('span', null, h('span', { 'aria-hidden': true }, '▶ '), b.title)))
    const views = tabs.length || flows.length ? h('nav', {
      className: 'dshd-views', 'aria-label': t('views'),
      // A vertical wheel scrolls the tab row sideways.
      onWheel: (event) => { if (!event.deltaX && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) event.currentTarget.scrollLeft += event.deltaY },
    }, ...tabs, tabs.length && flows.length ? h('span', { key: 'sep', className: 'dshd-sep', 'aria-hidden': true }) : null, ...flows)
      : h('div', { className: 'dshd-views' })
    const currentTab = flowView ?? path.find((id) => schemas.some((b) => b.view === id))
    useEffect(() => {
      // Keep the current tab in sight without scrolling any other ancestor.
      const row = root.current?.querySelector('.dshd-views')
      const tab = row?.querySelector('[aria-current=true]')
      if (!row || !tab || row.scrollWidth <= row.clientWidth) return
      const left = tab.offsetLeft - row.offsetLeft
      if (left < row.scrollLeft) row.scrollLeft = left - 8
      else if (left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + tab.offsetWidth - row.clientWidth + 8
    }, [currentTab, width])

    const showChanges = changesEnabled || history.length >= 2
    const versions = history.length > 1 || showChanges ? h('div', { key: 'versions', className: 'dshd-versions', role: 'group', 'aria-label': t('versions') },
      history.length > 1 ? h('div', { className: 'dshd-time' },
        compact ? null : h('button', { type: 'button', className: 'dshd-btn dshd-icon', title: t('older'), 'aria-label': t('older'), disabled: idx <= 0, onClick: () => setIdx(idx - 1) }, '‹'),
        h('input', { type: 'range', min: 0, max: last, value: idx, 'aria-label': t('version'), onChange: (e) => setIdx(Number(e.target.value)) }),
        compact ? null : h('button', { type: 'button', className: 'dshd-btn dshd-icon', title: t('newer'), 'aria-label': t('newer'), disabled: pick === null, onClick: () => setIdx(idx + 1) }, '›'),
        h('span', null, pick === null ? t('live') : `v${Number.parseInt(pick, 10)}`)) : null,
      showChanges ? tool({
        key: 'changes', name: t('changes'), glyph: 'Δ', text: t('changes'), pressed: changesEnabled,
        title: !diagram.source ? t('changes.unavailable') : t('changes'),
        disabled: !changesEnabled && !diagram.source, onClick: () => setChangesEnabled((value) => !value),
      }) : null) : null
    const horizontal = layoutDirection === 'LeftRight'
    const toolbar = h('div', { className: 'dshd-tools', ref: tools },
      versions,
      tool({ key: 'explorer', name: t('explorer'), icon: SearchIcon, disabled: !result?.model, pressed: exploring, onClick: () => (exploring ? closeExplorer() : openExplorer()) }),
      flowView ? null : tool({ key: 'foldAll', name: t('foldAll'), icon: FoldAllIcon, disabled: !expanded.length, onClick: () => setExpanded([]) }),
      h('button', { key: 'direction', type: 'button', className: 'dshd-btn dshd-tool dshd-icon', title: t(horizontal ? 'direction.toVertical' : 'direction.toHorizontal'), 'aria-label': t(horizontal ? 'direction.toVertical' : 'direction.toHorizontal'), onClick: flip }, h(DirIcon, { horizontal })),
      tool({ key: 'fit', name: t('fit'), icon: FitIcon, onClick: () => ctl.current.fit?.() }),
      exportHtml ? tool({ key: 'export', name: t('export.label'), text: t('export'), icon: DownloadIcon, title: t('html.title'), disabled: !tree || !diagram.source || diagram.busy || exporting || !staged, onClick: downloadHtml }) : null,
      tool({ key: 'help', ref: helpButton, name: t('help'), text: null, icon: HelpIcon, pressed: helpOpen, controls: helpOpen ? helpId : undefined, onClick: () => (helpOpen ? closeHelp(false) : setHelpOpen(true)) }))

    return h('div', { ref: root, className: 'dshd-root' + (compact ? ' dshd-compact' : ''), onKeyDownCapture: (event) => {
      if (helpOpen && event.key === 'Escape' && !event.nativeEvent?.isComposing) { event.preventDefault(); event.stopPropagation(); closeHelp(true) }
    }, onKeyDown: (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent?.isComposing) return
      if (event.key === 'Escape' && traceResult) { event.preventDefault(); event.stopPropagation(); setTraceSpec(null); return }
      // Escape closes what the focus is in: help first (above), the explorer from inside it (its own
      // handler); on the canvas the trace, then the details (stage), and only then a docked explorer.
      if (event.key === 'Escape' && exploring) { event.preventDefault(); event.stopPropagation(); closeExplorer(); return }
      if (event.key !== '/' || !result?.model) return
      if (event.target.closest?.('input, textarea, select, [contenteditable=true]')) return
      event.preventDefault(); event.stopPropagation(); openExplorer()
    } },
      h('div', { className: 'dshd-bar' }, views, toolbar),
      state.sub ? h('div', { className: 'dshd-sub' }, t('sub')) : null,
      content !== null && tree && flowView ? h('div', { className: 'dshd-crumbs' },
        h('b', null, h('span', { 'aria-hidden': true }, '▶ '), byId.get(flowView)?.title ?? flowView),
        h('button', { type: 'button', className: 'dshd-leave', onClick: leaveFlow }, h('span', { 'aria-hidden': true }, '× '), t('flow.leave'))) : null,
      content !== null && tree && !flowView ? h('div', { className: 'dshd-crumbs' },
        ...path.flatMap((id, i) => {
          const last = i === path.length - 1
          const item = last ? h('b', { key: id }, viewTitle(id)) : h('button', { key: id, type: 'button', onClick: () => ctl.current.flyTo?.(id) }, viewTitle(id))
          return i === 0 ? [item] : [h('span', { key: 's' + i }, '›'), item]
        })) : null,
      state.errors.length > 0 && pick === null ? h('div', { className: 'dshd-err', role: 'status' }, t('errors'),
        h('code', null, state.errors.slice(0, 4).map((e) => `L${e.line + 1}:${e.character} ${e.message}`).join('\n'))) : null,
      state.problems.length > 0 && pick === null ? h('div', { className: 'dshd-err', role: 'status' }, t('problems'),
        h('code', null, state.problems.slice(0, 3).map((e) => e.message).join('\n'))) : null,
      exportError ? h('div', { className: 'dshd-err dshd-note', role: 'alert' }, h('span', null, exportError), h(CloseButton, { t, onClick: () => setExportError(null) })) : null,
      changesEnabled ? h(ComparisonBar, {
        t, state: currentComparison, projection: changesProjection, model: result?.model,
        mode: baseMode, chosen: chosenBase, history, onMode: setBaseMode, onChosen: setChosenBase,
      }) : null,
      navigationNote ? h('div', { className: 'dshd-sub', role: 'status' }, navigationNote) : null,
      selectedId && result?.model && !result.model.elements[selectedId] ? h('div', { className: 'dshd-sub dshd-note', role: 'status' },
        h('span', null, t('selection.absent', { id: selectedId })), h(CloseButton, { t, onClick: () => setSelectedId(null) })) : null,
      traceResult ? h('div', { className: 'dshd-trace' },
        h('div', { role: 'status' }, t('trace.title', { mode: t('trace.' + traceSpec.mode), title: result.model.elements[traceSpec.id].title }), ' · ',
          t('trace.summary', { n: Object.keys(traceResult.elements).length, hidden: traceProjection.hidden.length })),
        h('button', { type: 'button', className: 'dshd-btn', onClick: () => setTraceSpec(null) }, t('trace.clear')),
        traceProjection.hidden.length ? h('details', null,
          h('summary', null, t('trace.hidden', { n: traceProjection.hidden.length })),
          h('ul', null, traceProjection.hidden.map((id) => h('li', { key: id },
            h('button', { type: 'button', className: 'dshd-btn', onClick: () => reveal(id) }, endpointPath(result.model, id, null)))))) : null) : null,
      h('div', { className: 'dshd-workspace' },
        exploring && result?.model ? h(Explorer, { model: result.model, t, docked, focusToken: explorerToken, onReveal: reveal, onClose: closeExplorer }) : null,
        h('div', { ref: area, className: 'dshd-area' }, content,
          // Over the stage corner, so the toolbar never shifts while a layout is computed.
          diagram.busy && expanded.length ? h('div', { className: 'dshd-busy', role: 'status' }, t('unfolding')) : null),
        helpOpen ? h(HelpPopover, { id: helpId, t, onClose: () => closeHelp(true) }) : null),
      h('div', { className: 'dshd-legend' },
        h('button', { type: 'button', className: 'dshd-btn dshd-legend-toggle', 'aria-pressed': legendOpen, 'aria-controls': legendId, onClick: toggleLegend },
          h('span', { 'aria-hidden': true }, legendOpen ? '▾' : '▸'), t('legend')),
        h('div', { id: legendId, className: 'dshd-legend-items', hidden: !legendOpen },
          ...legend.states.map((s) => h('span', { key: s, style: { color: STATE_COLOR.get(s) } },
            h('i', { className: 'dshd-dot', style: s === 'planned' ? { borderStyle: 'dashed' } : undefined }),
            h('span', { style: { color: V('label-secondary') } }, stateLabel(s, t)))),
          ...legend.kinds.map((kind) => h('span', { key: 'relation.' + kind }, h(RelationSample, { kind }), t('relation.' + kind))),
          legend.opens ? h('span', { key: 'opens' }, h('b', { style: { color: GROUP_COLOR } }, '⊕'), t('legend.opens')) : null,
          legend.elsewhere ? h('span', { key: 'elsewhere' }, h('b', null, '↗'), t('legend.elsewhere')) : null,
          legend.assumed ? h('span', { key: 'assumed' }, '? ', t('mark.assumed')) : null)))
  }
}
