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
 * and share its file. Files live in the workspace, under `<dir>/`, which holds
 * its own `.gitignore` so diagrams never end up in the project's git history.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promptText } from './prompt.js'
import { errorReport, refusalReport, okReport, iconLine } from './report.js'
import { ensureIgnored, differsFromLastSnapshot, snapshot } from './history.js'

export { promptText } from './prompt.js'
export { iconLine } from './report.js'

export const name = 'dsh-diagram'

/**
 * Settings, overridable from the plugin's row in the profile (kept
 * dependency-free: no schema package import).
 * - dir: diagram directory, relative to the conversation's workspace
 */
const DEFAULTS = { dir: '.diagram', prompt: true, history: true, maxErrors: 8 }

export const inject = ['agents', 'tools']

let engine
function loadEngine() {
  engine ??= import('./lib/likec4.mjs')
  return engine
}

const safeId = (id) => String(id).replace(/[^A-Za-z0-9_.-]/g, '_')

export function apply(ctx, rowConfig) {
  const config = { ...DEFAULTS, ...(rowConfig ?? {}) }
  /** Root Session id and working directory of the conversation an agent belongs to. */
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
    const rel = `${config.dir}/${safeId(id)}.c4`
    return {
      rootId: id,
      self: agent.session.id,
      isSub: id !== agent.session.id,
      cwd,
      rel,
      file: path.join(cwd, rel),
      historyDir: path.join(cwd, config.dir, safeId(id)),
    }
  }

  // ── prompt ────────────────────────────────────────────────────────────────
  if (config.prompt) {
    ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.section({
        name: 'dsh-diagram:map',
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

  async function checkOnce(loc) {
    let info
    try {
      info = await stat(loc.file)
    } catch {
      return undefined
    }
    await ensureDiagramIgnored(loc)
    const stamp = `${info.mtimeMs}:${info.size}`
    if (seen.get(loc.file) === stamp) return undefined
    const first = !seen.has(loc.file)
    seen.set(loc.file, stamp)
    const source = await readFile(loc.file, 'utf8')
    if (first && !(await differsFromLastSnapshot(loc.historyDir, source))) return undefined
    const eng = await loadEngine()
    const result = await eng.compute(source)
    if (loc.isSub) await writeRef(loc)
    const errors = result.errors.filter((e) => e.file === 'diagram.c4' || e.file === '')
    if (errors.length > 0) return errorReport({ rel: loc.rel, errors, maxErrors: config.maxErrors })
    if (result.problems.length > 0) return refusalReport({ rel: loc.rel, problems: result.problems, rules: eng.RULES, maxErrors: config.maxErrors })
    const version = config.history ? await snapshot(loc.historyDir, source) : undefined
    const icons = iconLine(result.icons)
    const repeated = iconLines.get(loc.file) === icons
    iconLines.set(loc.file, icons)
    return okReport({
      result,
      version,
      icons: repeated ? '' : icons,
      shown: 'and shown to the user',
      link: `Link to put in your message (a click opens the interactive tab): [Diagram](<${loc.file}>)`,
    })
  }

  async function ensureDiagramIgnored(loc) {
    const dir = path.join(loc.cwd, config.dir)
    try {
      await ensureIgnored(dir)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-diagram: cannot write ${path.join(dir, '.gitignore')}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function check(loc) {
    const previous = chains.get(loc.file) ?? Promise.resolve()
    const next = previous.then(() => checkOnce(loc), () => checkOnce(loc))
    chains.set(loc.file, next.catch(() => undefined))
    return next
  }

  async function writeRef(loc) {
    const ref = path.join(loc.cwd, config.dir, `${safeId(loc.self)}.ref`)
    try {
      await stat(ref)
    } catch {
      await mkdir(path.dirname(ref), { recursive: true })
      await writeFile(ref, `${loc.rootId}\n`)
      await ensureDiagramIgnored(loc)
    }
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (exec.agent === undefined || exec.parent !== undefined) return downstream
    if (downstream.kind !== 'accept' || downstream.value !== undefined) return downstream
    let loc
    try {
      loc = locate(exec.agent)
    } catch {
      return downstream
    }
    if (loc === undefined) return downstream
    let report
    try {
      report = await check(loc)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-diagram: check failed: ${error instanceof Error ? error.message : String(error)}`)
      return downstream
    }
    if (report === undefined) return downstream
    const base = downstream.content ?? result.content ?? []
    return { ...downstream, content: [...base, { type: 'text', text: report }] }
  })

  // Subagents created while a map already exists get a pointer so the user
  // sees the root map from the subagent's own view too.
  ctx.on('agent/created', async ({ agent }) => {
    try {
      const loc = locate(agent)
      if (loc?.isSub) {
        await stat(loc.file)
        await writeRef(loc)
      }
    } catch {}
  })
}
