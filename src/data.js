// Diagram file of a Session, its history snapshots, and their layout by the engine.
import { useState, useEffect, useRef } from 'react'

const DIR = '.diagram'
const POLL_MS = 2000

// ── data access ────────────────────────────────────────────────────────
function unwrap(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (!result.ok) {
      const e = result.error
      const err = new Error(e?.message ?? e?.code ?? 'remote error')
      err.code = e?.code
      throw err
    }
    return result.value
  }
  return result
}

export function makeIo(remote) {
  const files = () => remote.workspaceFiles
  return {
    async stat(sid, p, signal) {
      try {
        return unwrap(await files().stat(sid, p, signal))
      } catch (e) {
        if (signal?.aborted) throw e
        return undefined
      }
    },
    async readText(sid, p, signal) {
      let offset = 1
      const parts = []
      for (let i = 0; i < 200; i++) {
        const page = unwrap(await files().read(sid, p, { offset }, signal))
        if (page.lines > 0) parts.push(page.text)
        if (page.eof || page.lines === 0) return { text: parts.join('\n'), version: page.version }
        offset += page.lines
      }
      return { text: parts.join('\n'), version: undefined }
    },
    async list(sid, p, signal) {
      try {
        return unwrap(await files().list(sid, p, signal)).entries
      } catch (e) {
        if (signal?.aborted) throw e
        return []
      }
    },
  }
}

let loader = null
/** The module loader's `require` (it loads the engine chunk on demand). */
export function setLoader(require) {
  loader = require
}

let enginePromise
function engine() {
  enginePromise ??= loader.async('./client.likec4.js').catch((e) => {
    enginePromise = undefined
    throw e
  })
  return enginePromise
}
/** (text, direction, unfolded groups) → Promise<result>; small cache keeps the timeline snappy. */
const computed = new Map()
function compute(text, direction, expand) {
  const key = direction + '\u0000' + expand.join(',') + '\u0000' + text
  let p = computed.get(key)
  if (!p) {
    p = engine().then((m) => m.compute(text, { direction, expand }))
    computed.set(key, p)
    p.catch(() => computed.delete(key))
    if (computed.size > 32) computed.delete(computed.keys().next().value)
  }
  return p
}

// ── diagram state for one Session ──────────────────────────────────────────
/**
 * Follows the diagram file of a Session (its own, or its root's through the
 * `.ref` pointer a subagent gets), its history snapshots, and lays out
 * either the live text or a picked snapshot.
 */
export function useDiagram(io, sessionId, direction, expand) {
  const [file, setFile] = useState({ phase: 'loading' })
  const [history, setHistory] = useState([])
  const [pick, setPick] = useState(null) // null = live, else snapshot file name
  const [layout, setLayout] = useState({ phase: 'idle' })
  const [busy, setBusy] = useState(false) // a new layout is being computed
  const lastGood = useRef(null)

  useEffect(() => {
    if (!sessionId) return undefined
    const ctl = new AbortController()
    const { signal } = ctl
    let version
    let target
    let busy = false
    lastGood.current = null
    setPick(null)
    setHistory([])
    setFile({ phase: 'loading' })

    async function resolveTarget() {
      const own = `${DIR}/${sessionId}.c4`
      if (await io.stat(sessionId, own, signal)) return { id: sessionId, file: own, sub: false }
      const ref = `${DIR}/${sessionId}.ref`
      if (await io.stat(sessionId, ref, signal)) {
        const root = (await io.readText(sessionId, ref, signal)).text.trim()
        if (root) return { id: root, file: `${DIR}/${root}.c4`, sub: true }
      }
      return { id: sessionId, file: own, sub: false }
    }

    async function tick() {
      if (busy || signal.aborted) return
      busy = true
      try {
        if (!target || version === undefined) target = await resolveTarget()
        const st = await io.stat(sessionId, target.file, signal)
        if (!st) {
          version = undefined
          if (!signal.aborted) setFile({ phase: 'empty' })
          return
        }
        if (st.version === version) return
        const { text } = await io.readText(sessionId, target.file, signal)
        version = st.version
        if (signal.aborted) return
        setFile({ phase: 'ready', text, target })
        const entries = await io.list(sessionId, `${DIR}/${target.id}`, signal)
        const names = entries.filter((e) => e.type === 'file' && e.name.endsWith('.c4')).map((e) => e.name).sort()
        if (!signal.aborted) setHistory(names)
      } catch (e) {
        if (!signal.aborted) setFile({ phase: 'error', message: String(e?.message ?? e) })
      } finally {
        busy = false
      }
    }

    tick()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') tick()
    }, POLL_MS)
    return () => {
      ctl.abort()
      clearInterval(timer)
    }
  }, [io, sessionId])

  // Lay out the live text, or the picked snapshot.
  useEffect(() => {
    if (file.phase !== 'ready') return undefined
    let cancelled = false
    ;(async () => {
      try {
        let text = file.text
        const live = pick === null || !history.includes(pick)
        if (!live) text = (await io.readText(sessionId, `${DIR}/${file.target.id}/${pick}`)).text
        if (!lastGood.current) setLayout((l) => (l.phase === 'ready' ? l : { phase: 'engine' }))
        setBusy(true)
        const result = await compute(text, direction, expand)
        if (cancelled) return
        setBusy(false)
        if (result.legacy) {
          setLayout({ phase: 'legacy' })
          return
        }
        const errors = result.errors.filter((e) => e.file === 'diagram.c4' || e.file === '')
        if (errors.length === 0 && live) lastGood.current = result
        setLayout({
          phase: 'ready',
          result: errors.length === 0 ? result : live ? lastGood.current : null,
          errors: live ? errors : [],
          problems: live && errors.length === 0 ? result.problems ?? [] : [],
        })
      } catch (e) {
        if (cancelled) return
        setBusy(false)
        setLayout({ phase: 'error', message: String(e?.message ?? e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, pick, history, direction, io, sessionId, expand.join(',')])

  let phase = file.phase
  if (phase === 'ready') phase = layout.phase === 'idle' ? 'engine' : layout.phase
  return {
    phase,
    message: file.message ?? layout.message,
    sub: file.phase === 'ready' && file.target.sub,
    result: layout.phase === 'ready' ? layout.result : null,
    errors: layout.phase === 'ready' ? layout.errors : [],
    problems: layout.phase === 'ready' ? layout.problems : [],
    busy,
    history,
    pick,
    setPick,
  }
}
