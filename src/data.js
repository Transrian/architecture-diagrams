// Diagram file of a Session, its history snapshots, and their layout by the engine.
import { useState, useEffect, useRef } from 'react'
import { safeId, bySnapshotIndex } from './shared.js'

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
/** Parse a comparison baseline without layout or view generation. */
export function loadModel(text) {
  return engine().then((module) => module.modelOf(text))
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
  const entries = await io.list(sessionId, `${DIR}/${safeId(id)}`, signal)
  return entries.filter((e) => e.type === 'file' && e.name.endsWith('.c4')).map((e) => e.name).sort(bySnapshotIndex)
}

// ── diagram state for one Session ──────────────────────────────────────────
/** Own file → .ref pointer → root file. Resource Session ids remain untouched. */
function useDiagramTarget(io, sessionId, useFile) {
  // Which file to show: the Session's own diagram, else its root's through `.ref`.
  const own = useFile(sessionId ? fileAddress(sessionId, `${DIR}/${safeId(sessionId)}.c4`) : NONE)
  const ownMissing = isMissing(own)
  const ref = useFile(sessionId && ownMissing ? fileAddress(sessionId, `${DIR}/${safeId(sessionId)}.ref`) : NONE)
  const refVersion = ref.status === 'live' ? ref.value?.version : undefined
  const [refRoot, setRefRoot] = useState({ sessionId: null, version: undefined, id: null }) // `.ref` content, per version read
  useEffect(() => {
    if (refVersion === undefined) return undefined
    const ctl = new AbortController()
    const done = (id) => !ctl.signal.aborted && setRefRoot({ sessionId, version: refVersion, id })
    io.readText(sessionId, `${DIR}/${safeId(sessionId)}.ref`, ctl.signal).then(({ text }) => done(text.trim() ? safeId(text.trim()) : null), () => done(null))
    return () => ctl.abort()
  }, [io, sessionId, refVersion])
  const refPending = refVersion !== undefined && (refRoot.sessionId !== sessionId || refRoot.version !== refVersion)
  const rootId = refVersion !== undefined && !refPending ? refRoot.id : null
  const root = useFile(sessionId && ownMissing && rootId ? fileAddress(sessionId, `${DIR}/${safeId(rootId)}.c4`) : NONE)

  let target = null // { id, file, sub }
  let snap = own
  if (!ownMissing) target = { id: sessionId, file: `${DIR}/${safeId(sessionId)}.c4`, sub: false }
  else if (rootId) {
    target = { id: rootId, file: `${DIR}/${safeId(rootId)}.c4`, sub: true }
    snap = root
  }
  const version = snap.status === 'live' ? snap.value?.version : undefined
  const waiting = own.status === 'loading' || (ownMissing && (ref.status === 'loading' || refPending)) || (target?.sub && root.status === 'loading')
  const failure = snap.status === 'failed' && !isMissing(snap) ? String(snap.failure?.message ?? snap.failure?.code ?? 'error') : null

  return { target, snap, version, waiting, failure }
}

/** Refresh after the file read: the Host may not have written its snapshot yet. */
function useHistory(io, sessionId, file) {
  const [history, setHistory] = useState({ sessionId, targetId: file.target?.id, names: [] })
  useEffect(() => {
    if (file.phase !== 'ready' || file.sessionId !== sessionId) return undefined
    const ctl = new AbortController()
    const { signal } = ctl
    let timer
    ;(async () => {
      for (const delay of [0, 500, 1500, 4000]) {
        if (delay) await new Promise((resolve) => { timer = setTimeout(resolve, delay) })
        if (signal.aborted) return
        try {
          const names = await listHistory(io, sessionId, file.target.id, signal)
          if (signal.aborted) return
          setHistory((current) => current.sessionId === sessionId && current.targetId === file.target.id && current.names.length === names.length && current.names.every((name, i) => name === names[i]) ? current : { sessionId, targetId: file.target.id, names })
          const last = names[names.length - 1]
          if (!last) continue
          const snapText = (await io.readText(sessionId, `${DIR}/${safeId(file.target.id)}/${last}`, signal)).text
          if (snapText.trim() === file.text.trim()) return
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
  }, [io, sessionId, file])
  return history.sessionId === sessionId && history.targetId === file.target?.id ? history.names : []
}

/** Layout and source stay paired, including while displaying a last valid version. */
function useLayout(io, sessionId, file, snapshot, direction, expand) {
  const [layout, setLayout] = useState({ phase: 'idle' })
  const [busy, setBusy] = useState(false)
  const lastGood = useRef(null)
  useEffect(() => {
    lastGood.current = null
    setLayout({ phase: 'idle' })
  }, [sessionId, file.target?.id])
  useEffect(() => {
    if (file.phase !== 'ready' || file.sessionId !== sessionId) {
      setBusy(false)
      return undefined
    }
    const ctl = new AbortController()
    const { signal } = ctl
    setBusy(true)
    ;(async () => {
      try {
        let text = file.text
        const live = snapshot === null
        if (!live) text = (await io.readText(sessionId, `${DIR}/${safeId(file.target.id)}/${snapshot}`, signal)).text
        if (signal.aborted) return
        if (!lastGood.current) setLayout((l) => (l.phase === 'ready' ? l : { phase: 'engine' }))
        const result = await compute(text, direction, expand)
        if (signal.aborted) return
        setBusy(false)
        if (result.legacy) {
          setLayout({ phase: 'legacy', sessionId, targetId: file.target.id })
          return
        }
        const errors = result.errors
        if (errors.length === 0 && live) lastGood.current = { result, text }
        setLayout({
          phase: 'ready',
          sessionId,
          targetId: file.target.id,
          result: errors.length === 0 ? result : live ? lastGood.current?.result : null,
          source: errors.length === 0 ? { text, pick: snapshot, targetId: file.target.id } : live && lastGood.current ? { text: lastGood.current.text, pick: null, targetId: file.target.id } : null,
          errors: live ? errors : [],
          problems: live && errors.length === 0 ? result.problems ?? [] : [],
        })
      } catch (e) {
        if (signal.aborted) return
        setBusy(false)
        setLayout({ phase: 'error', message: String(e?.message ?? e), sessionId, targetId: file.target.id })
      }
    })()
    return () => {
      ctl.abort()
    }
  }, [file, snapshot, direction, io, sessionId, expand.join(',')])
  return { layout, busy }
}

/** Follow the live file (DSH pushes or polling), history and selected layout. */
export function useDiagram(io, sessionId, direction, expand, useResource) {
  const useFile = useResource ?? polledResource(io)
  const { target, version, waiting, failure } = useDiagramTarget(io, sessionId, useFile)
  const [file, setFile] = useState({ phase: 'loading', sessionId })
  const [pick, setPick] = useState(null)
  const targetFile = target?.file
  useEffect(() => {
    setFile({ phase: 'loading', sessionId })
  }, [sessionId])
  useEffect(() => setPick(null), [sessionId, targetFile])
  useEffect(() => {
    if (!sessionId) return undefined
    if (failure) {
      setFile({ phase: 'error', message: failure, sessionId })
      return undefined
    }
    if (version === undefined || !target) {
      if (!waiting) setFile({ phase: 'empty', sessionId })
      return undefined
    }
    const ctl = new AbortController()
    io.readText(sessionId, target.file, ctl.signal).then(({ text }) => {
      if (!ctl.signal.aborted) setFile({ phase: 'ready', text, target, sessionId })
    }, (e) => {
      if (!ctl.signal.aborted) setFile({ phase: 'error', message: String(e?.message ?? e), sessionId })
    })
    return () => ctl.abort()
  }, [io, sessionId, targetFile, version, waiting, failure])
  const history = useHistory(io, sessionId, file)
  const snapshot = pick !== null && history.includes(pick) ? pick : null
  const { layout, busy } = useLayout(io, sessionId, file, snapshot, direction, expand)
  let phase = file.sessionId === sessionId ? file.phase : 'loading'
  const paired = layout.sessionId === sessionId && layout.targetId === file.target?.id
  if (phase === 'ready') phase = layout.phase === 'idle' || !paired ? 'engine' : layout.phase
  const ready = layout.phase === 'ready' && paired
  return {
    phase,
    message: file.message ?? layout.message,
    sub: file.sessionId === sessionId && file.phase === 'ready' && file.target.sub,
    result: ready ? layout.result : null,
    source: ready ? layout.source : null,
    errors: ready ? layout.errors : [],
    problems: ready ? layout.problems : [],
    busy,
    history,
    targetId: ready ? layout.source?.targetId ?? null : null,
    pick,
    setPick,
  }
}
