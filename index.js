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
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-diagram'

/**
 * Settings, overridable from the plugin's row in the profile (kept
 * dependency-free: no schema package import).
 * - dir: diagram directory, relative to the conversation's workspace
 */
const DEFAULTS = { dir: '.diagram', prompt: true, history: true, maxErrors: 8 }

/** Written into `<dir>/` so the directory ignores itself in any git repository. */
const GITIGNORE = '# Created by dsh-diagram: conversation diagrams stay out of git.\n*\n'

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
    await ensureIgnored(loc)
    const stamp = `${info.mtimeMs}:${info.size}`
    if (seen.get(loc.file) === stamp) return undefined
    const first = !seen.has(loc.file)
    seen.set(loc.file, stamp)
    const source = await readFile(loc.file, 'utf8')
    if (first && !(await differsFromLastSnapshot(loc, source))) return undefined
    const eng = await loadEngine()
    const result = await eng.compute(source)
    if (loc.isSub) await writeRef(loc)
    const errors = result.errors.filter((e) => e.file === 'diagram.c4' || e.file === '')
    if (errors.length > 0) return errorReport(loc, errors)
    if (result.problems.length > 0) return refusalReport(loc, result.problems, eng.RULES)
    const version = config.history ? await snapshot(loc, source) : undefined
    return okReport(loc, result, version)
  }

  /** Workspaces whose diagram directory already holds its `.gitignore`. */
  const ignored = new Set()
  async function ensureIgnored(loc) {
    const dir = path.join(loc.cwd, config.dir)
    if (ignored.has(dir)) return
    const file = path.join(dir, '.gitignore')
    try {
      await stat(file)
    } catch {
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(file, GITIGNORE, { flag: 'wx' })
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          ctx.logger?.warn?.(`dsh-diagram: cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
      }
    }
    ignored.add(dir)
  }

  function check(loc) {
    const previous = chains.get(loc.file) ?? Promise.resolve()
    const next = previous.then(() => checkOnce(loc), () => checkOnce(loc))
    chains.set(loc.file, next.catch(() => undefined))
    return next
  }

  async function lastSnapshot(loc) {
    let names
    try {
      names = (await readdir(loc.historyDir)).filter((n) => n.endsWith('.c4')).sort()
    } catch {
      return { count: 0 }
    }
    if (names.length === 0) return { count: 0 }
    const last = names[names.length - 1]
    return { count: names.length, last, index: Number.parseInt(last, 10) || names.length }
  }

  async function differsFromLastSnapshot(loc, source) {
    const last = await lastSnapshot(loc)
    if (last.count === 0) return true
    try {
      return (await readFile(path.join(loc.historyDir, last.last), 'utf8')) !== source
    } catch {
      return true
    }
  }

  async function snapshot(loc, source) {
    const last = await lastSnapshot(loc)
    if (last.count > 0) {
      try {
        if ((await readFile(path.join(loc.historyDir, last.last), 'utf8')) === source) return last.index
      } catch {}
    }
    const index = (last.index ?? 0) + 1
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    await mkdir(loc.historyDir, { recursive: true })
    await writeFile(path.join(loc.historyDir, `${String(index).padStart(4, '0')}-${stamp}.c4`), source)
    return index
  }

  async function writeRef(loc) {
    const ref = path.join(loc.cwd, config.dir, `${safeId(loc.self)}.ref`)
    try {
      await stat(ref)
    } catch {
      await mkdir(path.dirname(ref), { recursive: true })
      await writeFile(ref, `${loc.rootId}\n`)
      await ensureIgnored(loc)
    }
  }

  function errorReport(loc, errors) {
    const lines = errors.slice(0, config.maxErrors).map((e) => `  ${loc.rel}:${e.line + 1}:${e.character}  ${e.message}`)
    const hidden = errors.length - lines.length
    return [
      `[diagram] ${loc.rel} does not parse — the user's map tab shows the last valid version plus these errors. Fix them now:`,
      ...lines,
      ...(hidden > 0 ? [`  (+${hidden} more)`] : []),
      'Reminder: first line `// diagram v1`; tags go first inside braces; ids use letters/digits/_; no `specification` block needed.',
    ].join('\n')
  }

  function refusalReport(loc, problems, rules) {
    const lines = problems.slice(0, config.maxErrors).map((p) => `  ${loc.rel}:${p.line + 1}  ${p.message}`)
    const hidden = problems.length - lines.length
    return [
      `[diagram] ${loc.rel} refused: too heavy for the user to read at a glance (not kept as a version). Fix it now:`,
      ...lines,
      ...(hidden > 0 ? [`  (+${hidden} more)`] : []),
      `Rules: architecture only (no task/proof boxes), every element inside a schema group except person/external, ≤${rules.children} children per group, ≤${rules.depth} levels, ≤${rules.viewNodes} boxes per view, titles ≤${rules.title} chars, detail in metadata.`,
    ].join('\n')
  }

  function okReport(loc, result, version) {
    const byId = new Map(result.views.map((v) => [v.id, v]))
    const drill = Object.keys(result.viewOfElement ?? {}).length - result.schemas.filter((s) => s.element).length
    const schemas = result.schemas.map((s) => `${s.title} (${byId.get(s.view)?.nodes.length ?? 0} boxes)`).join(', ')
    const lines = [
      `[diagram] Diagram ${version !== undefined ? `v${version} ` : ''}valid and shown to the user: ${schemas || 'no schema'}${drill > 0 ? `, ${drill} drill-down view(s)` : ''}${result.extras.length ? `, flows: ${result.extras.map((e) => e.title).join(', ')}` : ''}.`,
    ]
    const icons = iconLine(result.icons)
    if (icons && iconLines.get(loc.file) !== icons) lines.push(icons)
    iconLines.set(loc.file, icons)
    lines.push(`Link to put in your message (a click opens the interactive tab): [Diagram](<${loc.file}>)`)
    return lines.join('\n')
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

/**
 * What the agent should know about automatic icons, in one line: technologies
 * no product matched, and icons taken from a title alone. Empty when all is clear.
 */
export function iconLine(report, max = 6) {
  if (!report) return ''
  const list = (items, fmt) => items.slice(0, max).map(fmt).join(', ') + (items.length > max ? ` (+${items.length - max})` : '')
  const parts = []
  if (report.unmatched?.length) parts.push(`technology with no product icon ${list(report.unmatched, (u) => `'${u.technology}' (${u.id})`)} — fine if it has none, else use its usual product name`)
  if (report.fromTitle?.length) parts.push(`taken from the title only ${list(report.fromTitle, (f) => `${f.id} → ${f.icon}`)} — write \`icon none\` where a title only looks like a product`)
  return parts.length ? `Icons: ${parts.join('; ')}.` : ''
}

export function promptText(loc) {
  return `# Conversation diagram

This conversation can own a live architecture diagram, drawn in the diagram tab of the right sidebar ("Diagram"; localized). It shows how a system is built, as nested groups the user zooms into one level at a time, and, through state tags, which parts your work changes.

When to draw:
- The user asks for a diagram, schema or map: draw it.
- Your plan or analysis spans several components and the links between them, or so many changes that text alone makes them hard to picture: draw it before changing anything, then keep the states current while you work.
- Anything simpler (a question, a one-file fix, a small change): do not draw. Do not draw either when the user says they do not want one.
Once this conversation has a diagram, keep it current when your work changes what it shows.
The diagram is not a log: no task boxes, no proof boxes, no history. Progress shows only as states on architecture elements; detail goes in metadata.

File: ${loc.file}
${loc.isSub ? `You are a subagent: this diagram belongs to the root conversation and other agents write to it too. Re-read it right before each edit and change only the elements your own work touches.\n` : ''}Edit it with your normal file tools. After each save a "[diagram]" note is appended to the tool result: fix syntax errors and refusals right away (a refused diagram is not kept). When you present the plan or explain the system, link the diagram file in your message, [Diagram](<${loc.file}>) with the label in the user's language: a click opens the interactive tab.

Shape: a hierarchy, never a flat list.
- Each top-level group is a schema: one button in the tab. Unrelated subjects are separate schemas.
- At most 7 children per group and 6 levels (schema > up to 4 nested groups > leaf). When a group would get more, add an intermediate group by function (entry, apps, inference, storage, monitoring…), not only by host.
- Only \`person\` and \`external\` may stay at the root, outside a schema. Docs and data go inside the schema they belong to.
- The plugin makes one view per group: the schema view (its button) and a drill-down view per nested group (the user unfolds a group in place with a click, or zooms into it). Do not write views, except a \`dynamic view\` for a numbered flow.
- Short labels with real names (files, services, hosts): title ≤ 32 chars, description ≤ 80, technology ≤ 40, relation label ≤ 30. Why, numbers, commits and test results go in \`metadata\`, shown when the user clicks.
- Draw relations between the most precise elements; the plugin merges them at higher levels ("3 links").
- No limit on the total: a whole platform can hold hundreds of elements, since the user sees one level at a time. Remove what the conversation no longer needs.

Syntax: the file starts with the line \`// diagram v1\`, then LikeC4: only \`model { }\` (plus \`views { }\` for dynamic views). Kinds and tags are predeclared — never write a \`specification\` block.
- kinds: system (a schema or a group), machine (host, VM, cluster), service (process, container, API), component (module, file, pipeline stage), data (database, index, topic, bucket, dataset), doc, person, external, hardware (GPU, disk)
- Icons are automatic: from \`technology\` (set it to the product's usual name: 'PostgreSQL', 'Apache Kafka', 'Snowflake'), else the title; cloud services ('Lambda', 'Functions') resolve inside a group named after the vendor (AWS, Azure, GCP). \`icon none\` removes one; \`icon aws:lambda\` (sets aws, azure, gcp, tech, bootstrap) forces one. Never spend time looking for an icon.
- state tags, on elements and relations: #planned (will change) #doing #done #impacted (not changed, but affected) #deviation (differs from the plan) #blocked #waiting (needs the user) #frozen — one state per element; marks #new #removed combine with a state (e.g. #done #new). An element changed before and planned again takes its next state; history goes in metadata.
- metadata: \`why\`, \`decided\` ('agent' or 'user'), \`proof\` (commit, command, test) have a meaning; any other key (lot, count…) is shown as is. A #deviation needs \`why\` and \`decided\`.
- One statement per line. Tags come FIRST inside the braces, before description/technology/metadata.
- Ids: letters, digits, underscore; not a keyword (model, views, view, include, style, element…). Reference nested elements as parent.child.
- Relationship: \`a -> b 'label'\` (never between an element and its own parent or child); with a tag: \`a -> b 'label' {\` newline \`#done\` newline \`}\`.
- Titles in the user's language.

Example:
// diagram v1
model {
  customer = person 'Customer'
  shop = system 'Web shop' {
    front = system 'Frontend' {
      cart = component 'Cart.tsx' {
        #planned
      }
      checkout = system 'Checkout' {
        form = component 'PaymentForm.tsx' {
          description 'card fields, 3-D Secure'
        }
        client = component 'payments.ts' {
          #doing
          metadata {
            proof 'vitest 44/44'
          }
        }
        form -> client 'card token'
      }
      checkout.client -> cart 'order paid'
    }
    api = system 'Backend' {
      orders = service 'orders-api' {
        technology 'FastAPI'
      }
    }
    front.checkout.client -> api.orders 'POST /orders'
  }
  customer -> shop.front.checkout.form 'pays'
}
`
}
