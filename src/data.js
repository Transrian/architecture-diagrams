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

// ── following a file ───────────────────────────────────────────────────────
const NONE = 'dsh-diagram:none' // not a dsh-resource:// address: resolves to no resource

/** `dsh-resource://file/session/<id>/<path>`, the address DSH's file provider follows. */
function fileAddress(sessionId, rel) {
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${rel.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Stand-in for DSH's `useResource` on a DSH without it: same snapshot shape
 * (`{ status, value, failure }`), but by polling `stat`. Only used as a fallback.
 */
function makePolledResource(io) {
  return function usePolledResource(address) {
    const [snap, setSnap] = useState({ status: 'loading' })
    useEffect(() => {
      const m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/.exec(address)
      if (!m) {
        setSnap({ status: 'none' })
        return undefined
      }
      const sid = decodeURIComponent(m[1])
      const rel = m[2].split('/').map(decodeURIComponent).join('/')
      const ctl = new AbortController()
      let last
      async function tick() {
        const st = await io.stat(sid, rel, ctl.signal).catch(() => undefined)
        if (ctl.signal.aborted) return
        const key = st ? String(st.version) : 'absent'
        if (key === last) return
        last = key
        setSnap(st ? { status: 'live', value: st } : { status: 'failed', failure: { code: 'workspace-file/not-found' } })
      }
      setSnap({ status: 'loading' })
      tick()
      const timer = setInterval(() => {
        if (document.visibilityState !== 'hidden') tick()
      }, POLL_MS)
      return () => {
        ctl.abort()
        clearInterval(timer)
      }
    }, [address])
    return snap
  }
}
const polled = new WeakMap()
function polledResource(io) {
  let hook = polled.get(io)
  if (!hook) polled.set(io, (hook = makePolledResource(io)))
  return hook
}

const isMissing = (snap) => snap.status === 'failed' && /not-found|not-regular-file/.test(String(snap.failure?.code ?? ''))

/** Snapshot names of a diagram, sorted (the timeline). */
async function listHistory(io, sessionId, id, signal) {
  const entries = await io.list(sessionId, `${DIR}/${id}`, signal)
  return entries.filter((e) => e.type === 'file' && e.name.endsWith('.c4')).map((e) => e.name).sort()
}

// ── diagram state for one Session ──────────────────────────────────────────
/**
 * Follows the diagram file of a Session (its own, or its root's through the
 * `.ref` pointer a subagent gets), its history snapshots, and lays out
 * either the live text or a picked snapshot.
 *
 * Changes are pushed: DSH's `useResource` hook (a slot prop) follows the file
 * through the Host's `workspaceFiles.changes` watch. Older DSH without it
 * falls back to polling `stat`.
 */
export function useDiagram(io, sessionId, direction, expand, useResource) {
  const useFile = useResource ?? polledResource(io)
  const [file, setFile] = useState({ phase: 'loading' })
  const [history, setHistory] = useState([])
  const [pick, setPick] = useState(null) // null = live, else snapshot file name
  const [layout, setLayout] = useState({ phase: 'idle' })
  const [busy, setBusy] = useState(false) // a new layout is being computed
  const lastGood = useRef(null)

  // Which file to show: the Session's own diagram, else its root's through `.ref`.
  const own = useFile(sessionId ? fileAddress(sessionId, `${DIR}/${sessionId}.c4`) : NONE)
  const ownMissing = isMissing(own)
  const ref = useFile(sessionId && ownMissing ? fileAddress(sessionId, `${DIR}/${sessionId}.ref`) : NONE)
  const refVersion = ref.status === 'live' ? ref.value?.version : undefined
  const [refRoot, setRefRoot] = useState({ version: undefined, id: null }) // `.ref` content, per version read
  useEffect(() => {
    if (refVersion === undefined) return undefined
    const ctl = new AbortController()
    const done = (id) => !ctl.signal.aborted && setRefRoot({ version: refVersion, id })
    io.readText(sessionId, `${DIR}/${sessionId}.ref`, ctl.signal).then(({ text }) => done(text.trim() || null), () => done(null))
    return () => ctl.abort()
  }, [io, sessionId, refVersion])
  const refPending = refVersion !== undefined && refRoot.version !== refVersion
  const rootId = refVersion !== undefined && !refPending ? refRoot.id : null
  const root = useFile(sessionId && ownMissing && rootId ? fileAddress(sessionId, `${DIR}/${rootId}.c4`) : NONE)

  let target = null // { id, file, sub }
  let snap = own
  if (!ownMissing) target = { id: sessionId, file: `${DIR}/${sessionId}.c4`, sub: false }
  else if (rootId) {
    target = { id: rootId, file: `${DIR}/${rootId}.c4`, sub: true }
    snap = root
  }
  const targetFile = target?.file
  const version = snap.status === 'live' ? snap.value?.version : undefined
  const waiting = own.status === 'loading' || (ownMissing && (ref.status === 'loading' || refPending)) || (target?.sub && root.status === 'loading')
  const failure = snap.status === 'failed' && !isMissing(snap) ? String(snap.failure?.message ?? snap.failure?.code ?? 'error') : null

  // A new Session: forget the previous one's state.
  useEffect(() => {
    lastGood.current = null
    setPick(null)
    setHistory([])
    setFile({ phase: 'loading' })
  }, [sessionId])

  // A new version of the followed file: read it, then refresh the timeline.
  useEffect(() => {
    if (!sessionId) return undefined
    if (failure) {
      setFile({ phase: 'error', message: failure })
      return undefined
    }
    if (version === undefined || !target) {
      if (!waiting) setFile({ phase: 'empty' })
      return undefined
    }
    const ctl = new AbortController()
    const { signal } = ctl
    let timer
    ;(async () => {
      try {
        const { text } = await io.readText(sessionId, target.file, signal)
        if (signal.aborted) return
        setFile({ phase: 'ready', text, target, sessionId })
        // The Host snapshots an accepted version right after the tool call that
        // wrote it, so the push may arrive first: retry a few times until the
        // newest snapshot holds this text (refused versions never get one).
        for (const delay of [0, 500, 1500, 4000]) {
          if (delay) await new Promise((r) => (timer = setTimeout(r, delay)))
          if (signal.aborted) return
          const names = await listHistory(io, sessionId, target.id, signal)
          if (signal.aborted) return
          setHistory(names)
          const last = names[names.length - 1]
          if (!last) continue
          const snapText = (await io.readText(sessionId, `${DIR}/${target.id}/${last}`, signal)).text
          if (snapText.trim() === text.trim()) return
        }
      } catch (e) {
        if (!signal.aborted) setFile({ phase: 'error', message: String(e?.message ?? e) })
      }
    })()
    return () => {
      ctl.abort()
      clearTimeout(timer)
    }
  }, [io, sessionId, targetFile, version, waiting, failure])

  // Lay out the live text, or the picked snapshot.
  useEffect(() => {
    // Session props may change one render before the old file state resets.
    // Never compute that previous Session's source under the new Session id.
    if (file.phase !== 'ready' || file.sessionId !== sessionId) return undefined
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
        if (errors.length === 0 && live) lastGood.current = { result, text }
        setLayout({
          phase: 'ready',
          sessionId,
          result: errors.length === 0 ? result : live ? lastGood.current?.result : null,
          // Keep source and result together. A refused live edit must export
          // the last valid drawing, not the invalid text currently on disk.
          source: errors.length === 0 ? { text, pick: live ? null : pick } : live && lastGood.current ? { text: lastGood.current.text, pick: null } : null,
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
    source: layout.phase === 'ready' && layout.sessionId === sessionId ? layout.source : null,
    errors: layout.phase === 'ready' ? layout.errors : [],
    problems: layout.phase === 'ready' ? layout.problems : [],
    busy,
    history,
    pick,
    setPick,
  }
}
