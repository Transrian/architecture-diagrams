// The diagram source (followed live from `serve`), its history snapshots, and their layout.
import { useState, useEffect, useRef, useMemo } from 'react'

const POLL_MS = 2000

let loader = null
/** Loads built chunks (the engine, icon shards) by name. */
export function setLoader(next) {
  loader = next
}

let enginePromise
function engine() {
  enginePromise ??= loader.load('engine.js').catch((e) => {
    enginePromise = undefined
    throw e
  })
  return enginePromise
}
/** Parse a comparison baseline without layout or view generation. */
export function loadModel(text) {
  return engine().then((module) => module.modelOf(text))
}
/** (text, schema direction, unfolded groups, flow direction) → Promise<result>; small cache keeps the timeline snappy. */
const computed = new Map()
function compute(text, direction, expand, flowDirection) {
  const key = direction + '\u0000' + flowDirection + '\u0000' + expand.join(',') + '\u0000' + text
  let p = computed.get(key)
  if (!p) {
    p = engine().then((m) => m.compute(text, { direction, expand, flowDirection }))
    computed.set(key, p)
    p.catch(() => computed.delete(key))
    if (computed.size > 32) computed.delete(computed.keys().next().value)
  }
  return p
}

/**
 * The current source: read once from an embedded page, polled from `serve`.
 * `io.source()` resolves `{ text, version }`, or null while the file is absent.
 */
function useSource(io) {
  const [file, setFile] = useState({ phase: 'loading' })
  useEffect(() => {
    const ctl = new AbortController()
    let last
    async function tick() {
      try {
        const current = await io.source(ctl.signal)
        if (ctl.signal.aborted) return
        const key = current ? String(current.version) : 'absent'
        if (key === last) return
        last = key
        setFile(current ? { phase: 'ready', text: current.text } : { phase: 'empty' })
      } catch (e) {
        if (ctl.signal.aborted) return
        last = undefined
        setFile((current) => current.phase === 'ready'
          ? current.disconnected ? current : { ...current, disconnected: true }
          : { phase: 'error', message: String(e?.message ?? e), disconnected: true })
      }
    }
    tick()
    const timer = io.live
      ? setInterval(() => {
          if (document.visibilityState !== 'hidden') tick()
        }, POLL_MS)
      : undefined
    return () => {
      ctl.abort()
      clearInterval(timer)
    }
  }, [io])
  return file
}

/** Refresh after the file read: `serve` may not have written its snapshot yet. */
function useHistory(io, file) {
  const [names, setNames] = useState([])
  useEffect(() => {
    if (file.phase !== 'ready') return undefined
    const ctl = new AbortController()
    const { signal } = ctl
    let timer
    ;(async () => {
      for (const delay of io.live ? [0, 500, 1500, 4000] : [0]) {
        if (delay)
          await new Promise((resolve) => {
            timer = setTimeout(resolve, delay)
          })
        if (signal.aborted) return
        try {
          const next = await io.history(signal)
          if (signal.aborted) return
          setNames((current) => (current.length === next.length && current.every((name, i) => name === next[i]) ? current : next))
          const last = next[next.length - 1]
          if (!last) continue
          if ((await io.snapshot(last, signal)).trim() === file.text.trim()) return
        } catch {
          // A transient history failure must not stop the remaining retries.
          if (signal.aborted) return
        }
      }
    })()
    return () => {
      ctl.abort()
      clearTimeout(timer)
    }
  }, [io, file])
  return names
}

/** Layout and source stay paired, including while displaying a last valid version. */
function useLayout(io, file, snapshot, direction, expand, flowDirection) {
  const [layout, setLayout] = useState({ phase: 'idle' })
  const request = useMemo(() => ({}), [file.text, snapshot, direction, flowDirection, expand.join(',')])
  const busy = file.phase === 'ready' && layout.request !== request
  const lastGood = useRef(null)
  const [refusedText, setRefusedText] = useState(null)
  useEffect(() => {
    if (file.phase !== 'ready') return undefined
    const ctl = new AbortController()
    const { signal } = ctl
    ;(async () => {
      try {
        const live = snapshot === null
        const text = live ? file.text : await io.snapshot(snapshot, signal)
        if (signal.aborted) return
        if (!lastGood.current) setLayout((l) => (l.phase === 'ready' ? l : { phase: 'engine' }))
        // One paint for the pending state before the main-thread engine starts.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        if (signal.aborted) return
        const result = await compute(text, direction, expand, flowDirection)
        if (signal.aborted) return
        const errors = result.errors
        if (live) setRefusedText(errors.length === 0 && result.problems?.length ? text : null)
        if (errors.length === 0 && live) lastGood.current = text
        const fallback = errors.length > 0 && live && lastGood.current !== null
        const shown = errors.length === 0 ? result : fallback ? await compute(lastGood.current, direction, expand, flowDirection) : null
        if (signal.aborted) return
        setLayout({
          phase: 'ready',
          request,
          result: shown,
          source: errors.length === 0 ? { text, pick: snapshot } : fallback ? { text: lastGood.current, pick: null } : null,
          errors: live ? errors : [],
          problems: live && errors.length === 0 ? (result.problems ?? []) : [],
        })
      } catch (e) {
        if (signal.aborted) return
        setLayout({ phase: 'error', request, message: String(e?.message ?? e) })
      }
    })()
    return () => {
      ctl.abort()
    }
  }, [file.phase, request, io])
  return { layout, busy, unsaved: io.live && file.text === refusedText }
}

/** Follow the source, its history and the selected version's layout. */
export function useDiagram(io, direction, expand, flowDirection) {
  const file = useSource(io)
  const [pick, setPick] = useState(null)
  const history = useHistory(io, file)
  const snapshot = pick !== null && history.includes(pick) ? pick : null
  const { layout, busy, unsaved } = useLayout(io, file, snapshot, direction, expand, flowDirection)
  let phase = file.phase
  if (phase === 'ready') phase = layout.phase === 'idle' ? 'engine' : layout.phase
  const ready = file.phase === 'ready' && layout.phase === 'ready'
  return {
    phase,
    live: !!io.live,
    disconnected: !!file.disconnected,
    unsaved,
    message: file.message ?? layout.message,
    result: ready ? layout.result : null,
    source: ready ? layout.source : null,
    errors: ready ? layout.errors : [],
    problems: ready ? layout.problems : [],
    busy,
    history: file.phase === 'empty' ? [] : history,
    pick,
    setPick,
  }
}
