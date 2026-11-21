// The tab body: toolbar (schemas, flows, timeline, direction, fit), breadcrumb,
// problems, the zoomable stage and the legend.
import * as React from 'react'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { V, STATES, STATE_COLOR, LEGEND } from './theme.js'
import { useDiagram } from './data.js'
import { buildTree, pathOf } from './zoom.js'
import { ZoomStage } from './stage.js'
import { DirIcon, DownloadIcon } from './icons.js'
import { composeSvg, toPng, download, fileName } from './export.js'
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
    const overview = schemas.length >= 2 && byId.has('index')
    const chosen = initial && schemas.some((x) => x.view === initial) ? initial : schemas[0]?.view
    const rootId = flowView ?? (overview ? 'index' : chosen)
    const tree = useMemo(() => (result && rootId ? buildTree(result, rootId, !!flowView) : null), [result, rootId, flowView])
    const start = flowView ?? chosen
    const path = tree && focus && tree.entries.has(focus) ? pathOf(tree, focus) : tree ? [tree.root.id] : []

    const chooseSchema = (id) => {
      if (!flowView && ctl.current.has?.(id) && ctl.current.flyTo(id)) return
      setFlow(null)
      setInitial(id)
    }

    const last = history.length - 1 // the live diagram is the newest notch
    const idx = pick === null ? last : history.indexOf(pick)
    const setIdx = (i) => setPick(i >= last || i < 0 ? null : history[i])

    let content
    const state = diagram
    if (state.phase === 'loading') content = h('div', { className: 'dshd-msg' }, t('loading'))
    else if (state.phase === 'engine') content = h('div', { className: 'dshd-msg' }, t('engine'))
    else if (state.phase === 'empty') content = h('div', { className: 'dshd-msg' }, h('b', null, t('empty.title')), h('span', null, t('empty.body')))
    else if (state.phase === 'legacy') content = h('div', { className: 'dshd-msg' }, h('b', null, t('legacy')))
    else if (state.phase === 'error') content = h('div', { className: 'dshd-msg' }, h('b', null, t('readFailed')), h('code', null, state.message))
    else if (!tree) content = h('div', { className: 'dshd-msg' }, t('noValid'))
    else content = h(ZoomStage, { tree, start, t, ctl, onFocus: setFocus, onToggle: toggle })

    const viewTitle = (id) => (id === 'index' ? t('overview') : byId.get(id)?.title ?? id)
    const [exporting, setExporting] = useState(false)
    const exportPng = async () => {
      const snap = ctl.current.snapshot?.()
      if (!snap || exporting) return
      setExporting(true)
      try {
        const where = flowView ? [viewTitle(flowView)] : path.map(viewTitle)
        const title = where.join(' › ')
        const version = pick === null ? '' : `v${Number.parseInt(pick, 10)} · `
        const legend = STATES.filter(([s]) => snap.states.has(s)).map(([s, color]) => ({ label: t('state.' + s), color, dashed: s === 'planned' || s === 'frozen' }))
        const stamp = version + new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
        download(await toPng(composeSvg(snap.svg, { title, stamp, legend })), fileName(where[where.length - 1] ?? 'diagram'))
      } catch (e) {
        console.error('[dsh-diagram] PNG export', e)
        window.alert(t('png.failed') + ': ' + String(e?.message ?? e))
      } finally {
        setExporting(false)
      }
    }
    const downloadHtml = async () => {
      if (!diagram.source || exporting) return
      setExporting(true)
      try {
        // Capture the displayed source before loading any assets: live updates
        // or timeline navigation during export must not change the snapshot.
        const { text, pick: version } = diagram.source
        const title = schemas.map((schema) => schema.title).join(' · ') || 'diagram'
        const name = title + (version === null ? '' : ` · v${Number.parseInt(version, 10)}`)
        const html = await exportHtml({ text, name })
        download(new Blob([html], { type: 'text/html;charset=utf-8' }), fileName(name, new Date(), 'html'))
      } catch (e) {
        console.error('[dsh-diagram] HTML export', e)
        window.alert(t('html.failed') + ': ' + String(e?.message ?? e))
      } finally {
        setExporting(false)
      }
    }
    return h('div', { className: 'dshd-root' },
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
        h('button', { type: 'button', className: 'dshd-btn dshd-icon', title: t('direction'), 'aria-label': t('direction'), onClick: flip }, h(DirIcon, { horizontal: direction === 'LeftRight' })),
        h('button', { type: 'button', className: 'dshd-btn', onClick: () => ctl.current.fit?.() }, t('fit')),
        h('button', { type: 'button', className: 'dshd-btn dshd-dl', title: t('png.title'), 'aria-label': t('png.title'), disabled: !tree || exporting || content?.type !== ZoomStage, onClick: exportPng }, h(DownloadIcon), t('png')),
        exportHtml ? h('button', { type: 'button', className: 'dshd-btn dshd-dl', title: t('html.title'), 'aria-label': t('html.title'), disabled: !tree || !diagram.source || diagram.busy || exporting || content?.type !== ZoomStage, onClick: downloadHtml }, h(DownloadIcon), t('html')) : null),
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
      content,
      h('div', { className: 'dshd-legend' }, LEGEND.map((s) => h('span', { key: s, style: { color: STATE_COLOR.get(s) } },
        h('i', { className: 'dshd-dot', style: s === 'planned' ? { borderStyle: 'dashed' } : undefined }),
        h('span', { style: { color: V('label-secondary') } }, t('state.' + s))))))
  }
}
