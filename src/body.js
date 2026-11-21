// The tab body: toolbar (schemas, flows, timeline, direction, fit), breadcrumb,
// problems, the zoomable stage and the legend.
import * as React from 'react'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { V, STATE_COLOR, viewLegend, stateLabel } from './theme.js'
import { RelationSample } from './shapes.js'
import { useDiagram } from './data.js'
import { buildTree, pathOf } from './zoom.js'
import { ZoomStage } from './stage.js'
import { Search } from './search.js'
import { Outline } from './outline.js'
import { viewForElement } from './navigation.js'
import { DirIcon, DownloadIcon } from './icons.js'
import { download, fileName } from './export.js'
import { requestIcons, iconsOf } from './iconpack.js'

const h = React.createElement

export function makeBody(io, { exportHtml } = {}) {
  return function DiagramBody(props) {
    const { t, diagramSessionId: sessionId } = props
    const [direction, setDirection] = useState(() => {
      try { return localStorage.getItem('dsh-diagram.direction') || 'TopBottom' } catch { return 'TopBottom' }
    })
    const flip = () => {
      const next = direction === 'LeftRight' ? 'TopBottom' : 'LeftRight'
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
    const diagram = useDiagram(io, sessionId, direction, expanded, useResource)
    const { history, pick, setPick, result } = diagram
    useEffect(() => requestIcons(iconsOf(result)), [result])
    const [flow, setFlow] = useState(null) // dynamic view shown instead of the zoomable diagram
    const [initial, setInitial] = useState(null) // schema to start in
    const [focus, setFocus] = useState(null) // view the camera is in (reported by the stage)
    const ctl = useRef({})

    const byId = useMemo(() => new Map((result?.views ?? []).map((v) => [v.id, v])), [result])
    const schemas = result?.schemas ?? []
    const extras = result?.extras ?? []
    const flowView = flow && byId.has(flow) ? flow : null
    // One canvas for every schema: the overview (LikeC4's index view) holds them all.
    const overview = byId.has('index')
    const chosen = initial && schemas.some((x) => x.view === initial) ? initial : schemas[0]?.view
    const rootId = flowView ?? (overview ? 'index' : chosen)
    const tree = useMemo(() => (result && rootId ? buildTree(result, rootId, !!flowView) : null), [result, rootId, flowView])
    const start = flowView ?? chosen
    const path = tree && focus && tree.entries.has(focus) ? pathOf(tree, focus) : tree ? [tree.root.id] : []

    const [searching, setSearching] = useState(false)
    const [outline, setOutline] = useState(false)
    const [pendingReveal, setPendingReveal] = useState(null)
    const [navigationNote, setNavigationNote] = useState(null)
    const focusStage = () => requestAnimationFrame(() => ctl.current.focus?.())
    const closeNavigator = () => { setSearching(false); setOutline(false); focusStage() }
    const openSearch = () => { setOutline(false); setSearching(true) }
    const reveal = (id) => {
      if (!viewForElement(result, id)) { setNavigationNote(t('reveal.missing')); return }
      setNavigationNote(null)
      setSearching(false)
      setOutline(false)
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
      setSearching(false); setOutline(false); setPendingReveal(null); setNavigationNote(null)
    }, [sessionId])

    const chooseSchema = (id) => {
      setSearching(false)
      setOutline(false)
      if (!flowView && ctl.current.has?.(id) && ctl.current.flyTo(id)) return
      setFlow(null)
      setInitial(id)
    }

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
      content = h(ZoomStage, { tree, result, model: result.model, expanded, start, t, ctl, onFocus: setFocus, onToggle: toggle, onSearch: openSearch })
    }

    const legend = viewLegend(byId.get(focus) ?? byId.get(start))
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
    return h('div', { className: 'dshd-root', onKeyDown: (event) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent?.isComposing || !result?.model) return
      if (event.target.closest?.('input, textarea, select, [contenteditable=true]')) return
      event.preventDefault(); event.stopPropagation(); openSearch()
    } },
      h('div', { className: 'dshd-bar' },
        h('div', { className: 'dshd-views' },
          schemas.length > 1 || extras.length ? schemas.map((b) => h('button', {
            key: b.view, type: 'button', className: 'dshd-btn',
            'aria-pressed': !flowView && path.includes(b.view),
            onClick: () => chooseSchema(b.view),
          }, b.title)) : null,
          extras.map((b) => h('button', {
            key: b.view, type: 'button', className: 'dshd-btn dshd-flow',
            'aria-pressed': flowView === b.view,
            onClick: () => setFlow(b.view),
          }, b.title))),
        history.length > 1 ? h('div', { className: 'dshd-time' },
          h('button', { type: 'button', className: 'dshd-btn dshd-icon', title: t('older'), 'aria-label': t('older'), disabled: idx <= 0, onClick: () => setIdx(idx - 1) }, '‹'),
          h('input', { type: 'range', min: 0, max: last, value: idx, 'aria-label': t('version'), onChange: (e) => setIdx(Number(e.target.value)) }),
          h('button', { type: 'button', className: 'dshd-btn dshd-icon', title: t('newer'), 'aria-label': t('newer'), disabled: pick === null, onClick: () => setIdx(idx + 1) }, '›'),
          h('span', null, pick === null ? t('live') : `v${Number.parseInt(pick, 10)}`)) : null,
        diagram.busy && expanded.length ? h('span', { className: 'dshd-busy' }, t('unfolding')) : null,
        expanded.length ? h('button', { type: 'button', className: 'dshd-btn', onClick: () => setExpanded([]) }, t('foldAll')) : null,
        h('button', { type: 'button', className: 'dshd-btn', disabled: !result?.model, 'aria-pressed': searching, onClick: () => searching ? closeNavigator() : openSearch() }, t('search')),
        h('button', { type: 'button', className: 'dshd-btn', disabled: !result?.model, 'aria-pressed': outline, onClick: () => {
          if (outline) closeNavigator()
          else { setSearching(false); setOutline(true) }
        } }, t('outline')),
        h('button', { type: 'button', className: 'dshd-btn dshd-icon', title: t('direction'), 'aria-label': t('direction'), onClick: flip }, h(DirIcon, { horizontal: direction === 'LeftRight' })),
        h('button', { type: 'button', className: 'dshd-btn', onClick: () => ctl.current.fit?.() }, t('fit')),
        exportHtml ? h('button', { type: 'button', className: 'dshd-btn dshd-dl', title: t('html.title'), 'aria-label': t('html.title'), disabled: !tree || !diagram.source || diagram.busy || exporting || !staged, onClick: downloadHtml }, h(DownloadIcon), t('html')) : null),
      state.sub ? h('div', { className: 'dshd-sub' }, t('sub')) : null,
      content !== null && tree && !flowView ? h('div', { className: 'dshd-crumbs' },
        ...path.flatMap((id, i) => {
          const last = i === path.length - 1
          const item = last ? h('b', { key: id }, viewTitle(id)) : h('button', { key: id, type: 'button', onClick: () => ctl.current.flyTo?.(id) }, viewTitle(id))
          return i === 0 ? [item] : [h('span', { key: 's' + i }, '›'), item]
        }),
        h('span', { key: 'hint', className: 'dshd-hint' }, t('hint'))) : null,
      state.errors.length > 0 && pick === null ? h('div', { className: 'dshd-err', role: 'status' }, t('errors'),
        h('code', null, state.errors.slice(0, 4).map((e) => `L${e.line + 1}:${e.character} ${e.message}`).join('\n'))) : null,
      state.problems.length > 0 && pick === null ? h('div', { className: 'dshd-err', role: 'status' }, t('problems'),
        h('code', null, state.problems.slice(0, 3).map((e) => e.message).join('\n'))) : null,
      exportError ? h('button', { type: 'button', className: 'dshd-err', role: 'alert', onClick: () => setExportError(null) }, exportError) : null,
      navigationNote ? h('div', { className: 'dshd-sub', role: 'status' }, navigationNote) : null,
      searching ? h(Search, { model: result?.model, t, onReveal: reveal, onClose: closeNavigator }) : null,
      h('div', { className: 'dshd-workspace' },
        h('div', { style: { display: outline ? 'none' : 'flex', flex: 1, minHeight: 0, minWidth: 0 } }, content),
        outline ? h(Outline, { model: result?.model, t, onReveal: reveal, onClose: closeNavigator }) : null),
      h('div', { className: 'dshd-legend' },
        ...legend.states.map((s) => h('span', { key: s, style: { color: STATE_COLOR.get(s) } },
          h('i', { className: 'dshd-dot', style: s === 'planned' ? { borderStyle: 'dashed' } : undefined }),
          h('span', { style: { color: V('label-secondary') } }, stateLabel(s, t)))),
        ...legend.kinds.map((kind) => h('span', { key: 'relation.' + kind }, h(RelationSample, { kind }), t('relation.' + kind)))))
  }
}
