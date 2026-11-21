/**
 * Host half of dsh-diagram: a live architecture diagram per conversation.
 *
 * - Tells every agent where its conversation's diagram lives and how to write
 *   it (system prompt section, evaluated per agent).
 * - After each tool call, notices when the diagram file changed, parses it with
 *   the bundled LikeC4 engine and appends a short "[diagram]" verdict to that
 *   tool result: syntax errors, or a refusal when the diagram breaks the
 *   readability rules (too many boxes, flat structure, long labels).
 * - Keeps a snapshot of every accepted version. The agent links the diagram
 *   file in its reply; a click opens the Diagram tab.
 *
 * One diagram per root conversation: subagents resolve to their root Session
 * and share its file. Files live in the workspace, under `.diagram/`, which holds
 * its own `.gitignore` so diagrams never end up in the project's git history.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promptText } from './prompt.js'
import { errorReport, refusalReport, okReport, iconLine } from './report.js'
import { ensureIgnored, differsFromLastSnapshot, snapshot } from './history.js'
import { safeId } from './src/shared.js'

export { promptText } from './prompt.js'
export { iconLine } from './report.js'

export const name = 'dsh-diagram'

/**
 * Settings, overridable from the plugin's row in the profile (kept
 * dependency-free: no schema package import).
 */
const DIR = '.diagram'
const DEFAULTS = { prompt: true, history: true, maxErrors: 8 }

export const inject = ['agents', 'tools']

let engine
function loadEngine() {
  engine ??= import('./lib/likec4.mjs').catch((error) => {
    engine = undefined
    throw error
  })
  return engine
}

export function apply(ctx, rowConfig) {
  const config = { ...DEFAULTS, ...(rowConfig ?? {}) }
  if (rowConfig?.dir !== undefined && rowConfig.dir !== DIR) {
    ctx.logger?.warn?.('dsh-diagram: the "dir" setting is no longer supported; diagrams stay in .diagram')
  }
  /**
   * DSH is still moving fast: when a Session field this plugin relies on is
   * missing, the feature switches itself off with one warning instead of
   * throwing on every turn.
   */
  const warned = new Set()
  function warnOnce(what, error) {
    if (warned.has(what)) return
    warned.add(what)
    ctx.logger?.warn?.(`dsh-diagram: ${what} disabled, this DSH version is not supported (${error instanceof Error ? error.message : String(error)})`)
  }

  const ioWarnings = new Map()
  function warnIo(what, key, error) {
    const message = error instanceof Error ? error.message : String(error)
    if (ioWarnings.get(key) === message) return
    ioWarnings.set(key, message)
    ctx.logger?.warn?.(`dsh-diagram: ${what}: ${message}`)
  }

  /** Root Session id and working directory of the conversation an agent belongs to. */
  function locate(agent) {
    let session = agent.session
    let id = session.id
    let cwd = session.header.cwd
    let depth = 0
    while (session?.header.origin === 'subagent' && session.header.parentSession && depth++ < 16) {
      id = session.header.parentSession
      session = ctx.agents.get(id)?.session
      if (session?.header.cwd) cwd = session.header.cwd
    }
    if (!cwd) return undefined
    const rel = `${DIR}/${safeId(id)}.c4`
    return {
      rootId: id,
      self: agent.session.id,
      isSub: id !== agent.session.id,
      cwd,
      rel,
      file: path.join(cwd, rel),
      historyDir: path.join(cwd, DIR, safeId(id)),
    }
  }

  // ── prompt ────────────────────────────────────────────────────────────────
  if (config.prompt) {
    ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.section({
        name: 'dsh-diagram:diagram',
        order: 9500,
        interpolate: false,
        text: (context) => {
          const agent = context.agent
          if (agent === undefined) return ''
          let loc
          try {
            loc = locate(agent)
          } catch (error) {
            warnOnce('prompt', error)
            return ''
          }
          return loc === undefined ? '' : promptText(loc)
        },
      })
    })
  }

  // ── change detection after every tool call ────────────────────────────────
  /** file → last seen `${mtimeMs}:${size}` */
  const seen = new Map()
  /** file → last icon line reported, so it is repeated only when it changes */
  const iconLines = new Map()
  /** file → serialized checks so parallel subagents do not interleave */
  const chains = new Map()
  const failures = new Map()

  async function checkOnce(loc) {
    let info
    try {
      info = await stat(loc.file)
    } catch {
      return undefined
    }
    if (loc.isSub) await ensureRef(loc)
    const stamp = `${info.mtimeMs}:${info.size}`
    const failed = failures.get(loc.file)
    if (failed?.stamp === stamp && failed.retryAt > Date.now()) return undefined
    await ensureDiagramIgnored(loc)
    if (seen.get(loc.file) === stamp) return undefined
    const finish = (report) => {
      failures.delete(loc.file)
      ioWarnings.delete('check:' + loc.file)
      return report
    }
    const first = !seen.has(loc.file)
    seen.set(loc.file, stamp)
    try {
      const source = await readFile(loc.file, 'utf8')
      if (first && !(await differsFromLastSnapshot(loc.historyDir, source))) return finish(undefined)
      const eng = await loadEngine()
      const result = await eng.compute(source)
      const errors = result.errors
      if (errors.length > 0) return finish(errorReport({ rel: loc.rel, errors, maxErrors: config.maxErrors, shown: "the user's Diagram tab shows the last valid version plus these errors" }))
      if (result.problems.length > 0) return finish(refusalReport({ rel: loc.rel, problems: result.problems, rules: eng.RULES, maxErrors: config.maxErrors }))
      const version = config.history ? await snapshot(loc.historyDir, source) : undefined
      const icons = iconLine(result.icons)
      const repeated = iconLines.get(loc.file) === icons
      iconLines.set(loc.file, icons)
      return finish(okReport({
        result,
        version,
        icons: repeated ? '' : icons,
        shown: 'and shown to the user',
        link: `Link to put in your message (a click opens the interactive tab): [Diagram](<${loc.file}>)`,
      }))
    } catch (error) {
      seen.delete(loc.file)
      const reason = error instanceof Error ? error.message : String(error)
      const count = failed?.stamp === stamp && failed.reason === reason ? failed.count + 1 : 1
      // The first failure retries on the very next tool. Persistent failures
      // back off (up to 30 s); editing the file bypasses the delay immediately.
      failures.set(loc.file, { stamp, reason, count, retryAt: count === 1 ? 0 : Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(count - 2, 5)) })
      throw error
    }
  }

  async function ensureDiagramIgnored(loc) {
    const dir = path.join(loc.cwd, DIR)
    try {
      await ensureIgnored(dir)
      ioWarnings.delete('ignore:' + dir)
    } catch (error) {
      warnIo(`cannot write ${path.join(dir, '.gitignore')}`, 'ignore:' + dir, error)
    }
  }

  function check(loc) {
    const previous = chains.get(loc.file) ?? Promise.resolve()
    const next = previous.then(() => checkOnce(loc), () => checkOnce(loc))
    chains.set(loc.file, next.catch(() => undefined))
    return next
  }

  async function writeRef(loc) {
    const ref = path.join(loc.cwd, DIR, `${safeId(loc.self)}.ref`)
    try {
      await stat(ref)
    } catch {
      await mkdir(path.dirname(ref), { recursive: true })
      await writeFile(ref, `${safeId(loc.rootId)}\n`)
      await ensureDiagramIgnored(loc)
    }
  }

  async function ensureRef(loc) {
    try {
      await writeRef(loc)
      ioWarnings.delete('pointer:' + loc.self)
    } catch (error) { warnIo('cannot write subagent pointer', 'pointer:' + loc.self, error) }
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (exec.agent === undefined || exec.parent !== undefined) return downstream
    if (downstream.kind !== 'accept' || downstream.value !== undefined) return downstream
    let loc
    try {
      loc = locate(exec.agent)
    } catch (error) {
      warnOnce('diagram check', error)
      return downstream
    }
    if (loc === undefined) return downstream
    let report
    try {
      report = await check(loc)
    } catch (error) {
      warnIo('check failed', 'check:' + loc.file, error)
      return downstream
    }
    if (report === undefined) return downstream
    const base = downstream.content ?? result.content ?? []
    return { ...downstream, content: [...base, { type: 'text', text: report }] }
  })

  // Subagents created while a diagram already exists get a pointer so the user
  // sees the root diagram from the subagent's own view too.
  ctx.on('agent/created', async ({ agent }) => {
    let loc
    try {
      loc = locate(agent)
    } catch (error) {
      warnOnce('subagent pointer', error)
      return
    }
    if (!loc?.isSub) return
    // A root diagram may not exist yet: that is normal, not a compatibility error.
    try { await stat(loc.file) } catch { return }
    await ensureRef(loc)
  })
}
