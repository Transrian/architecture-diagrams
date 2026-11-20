// Engine shared by the Host (validation, previews) and the browser (rendering):
// LikeC4 parse + Graphviz (wasm) layout, the fixed specification prelude,
// one generated view per group (schemas + drill-down), state roll-up and the
// readability rules ("lint") that keep a diagram small enough to read at a glance.
import { createLanguageServices } from '@likec4/language-server/browser'
import { configureLogger, rootLogger } from '@likec4/log'
import { createFromSources } from './node_modules/@likec4/language-services/dist/common/createFromSources.mjs'
import { textOf, wrap, edgePath, GROUP_COLOR } from '../src/shared.js'

export { wrap, edgePath }

// ── vocabulary ──────────────────────────────────────────────────────────────

/** Canonical element kinds (what the prompt teaches). */
export const KINDS = ['system', 'machine', 'service', 'component', 'data', 'doc', 'person', 'external', 'hardware']
/** First line of every diagram file. Files without it are not loaded. */
export const FORMAT = 'diagram v1'
/** Current format version. */
export const FORMAT_VERSION = 1
// `// carte v2` is the same format under the plugin's former name.
const FORMAT_RE = /^\s*\/\/\s*(diagram|carte)\s+v(\d+)\b/
/** Format version declared on the first line (normalized to the `diagram` numbering), or null. */
export function formatOf(source) {
  const first = String(source ?? '').split('\n').find((l) => l.trim() !== '') ?? ''
  const m = FORMAT_RE.exec(first)
  if (!m) return null
  const v = Number(m[2])
  return m[1] === 'carte' ? v - 1 : v
}
/** Kinds allowed at the root of the model without being a group. */
const ROOT_LEAF_KINDS = new Set(['person', 'external'])
/** State tags, by display precedence (first wins, also for the roll-up). */
export const STATES = ['blocked', 'deviation', 'waiting', 'doing', 'planned', 'impacted', 'done', 'frozen']
/** Marks shown next to the state. */
export const MARKS = ['new', 'removed']

/** Readability rules. Exported so the prompt quotes the same numbers. */
export const RULES = {
  children: 7, // boxes inside one group
  roots: 8, // top-level elements (schemas + people/externals)
  depth: 4, // schema > group > group > leaf
  elements: 60, // whole diagram
  title: 32,
  description: 80,
  technology: 40,
  relation: 30,
  viewNodes: 16, // boxes drawn in one view
}

export const PRELUDE = `specification {
${KINDS.map((k) => `  element ${k} {\n    style {\n      size small\n${k === 'data' ? '      shape storage\n' : k === 'doc' ? '      shape document\n' : k === 'person' ? '      shape person\n' : ''}    }\n  }`).join('\n')}
${[...STATES, ...MARKS].map((t) => `  tag ${t}`).join('\n')}
}
`

/** Canonical state of a tag list (highest precedence), or undefined. */
export function stateOf(tags) {
  return STATES.find((s) => (tags ?? []).includes(s))
}

let configured = false
function quiet() {
  if (configured) return
  configured = true
  try {
    configureLogger({ sinks: {}, loggers: [{ category: 'likec4', sinks: [], lowestLevel: 'fatal' }], reset: true })
  } catch {}
}

/**
 * Give every view without its own `autoLayout` rule the requested direction.
 * The rule is inserted right before the view's closing brace, on the same
 * line, so reported line numbers stay those of the original text.
 * @param {string} src
 * @param {'TopBottom'|'LeftRight'|'BottomTop'|'RightLeft'} dir
 */
export function orient(src, dir) {
  const re = /(^|\n)[ \t]*(?:dynamic[ \t]+)?view[ \t]+[A-Za-z_][\w]*[^{\n]*\{/g
  const inserts = []
  let m
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    let quote = null
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = null
      } else if (c === "'" || c === '"') quote = c
      else if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++
      } else if (c === '{') depth++
      else if (c === '}') depth--
    }
    if (depth !== 0) break
    const end = i - 1
    if (!/\bautoLayout\b/.test(src.slice(re.lastIndex, end))) inserts.push(end)
  }
  let out = src
  for (const at of inserts.reverse()) out = out.slice(0, at) + ` autoLayout ${dir} ` + out.slice(at)
  return out
}

/** Parse results by source text: unfolding a group re-lays out the same text. */
const parsed = new Map()

async function load(files) {
  return createFromSources(createLanguageServices(), rootLogger.getChild('lang'), files, { printErrors: false, throwIfInvalid: false })
}

function collectErrors(l) {
  const errors = []
  const seen = new Set()
  for (const e of l.getErrors()) {
    const file = String(e.sourceFsPath ?? '').replace(/^.*\//, '')
    const first = String(e.message ?? '').split('\n')[0]
    const item = { message: first.length > 300 ? first.slice(0, 300) + '…' : first, line: e.line, character: (e.range?.start?.character ?? 0) + 1, file }
    const key = item.line + ':' + item.message
    if (seen.has(key)) continue
    seen.add(key)
    errors.push(item)
  }
  return errors
}

/** Plain, serializable summary of the parsed model. */
function summarize(cm) {
  const elements = {}
  const order = []
  for (const e of cm.elements()) {
    const raw = e.$element ?? {}
    const id = e.id
    const meta = {}
    for (const [k, v] of Object.entries(raw.metadata ?? {})) meta[k] = Array.isArray(v) ? v.join(', ') : String(v)
    const tags = raw.tags ?? []
    elements[id] = {
      id,
      parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null,
      depth: id.split('.').length,
      kind: raw.kind,
      title: raw.title ?? id,
      description: textOf(raw.description),
      technology: raw.technology ?? '',
      metadata: meta,
      tags,
      state: STATES.find((s) => tags.includes(s)),
      marks: MARKS.filter((m) => tags.includes(m)),
      children: [],
    }
    order.push(id)
  }
  for (const id of order) {
    const p = elements[id].parent
    if (p && elements[p]) elements[p].children.push(id)
  }
  const relations = {}
  for (const r of cm.relationships()) {
    const raw = r.$relationship ?? {}
    relations[r.id] = {
      id: r.id,
      source: raw.source?.model ?? r.source?.id,
      target: raw.target?.model ?? r.target?.id,
      title: raw.title ?? r.title ?? '',
      tags: raw.tags ?? [],
    }
  }
  const views = []
  for (const v of cm.views()) views.push({ id: v.id, type: v.$view?._type, viewOf: v.$view?.viewOf ?? null, title: v.$view?.title ?? null })
  return { elements, order, relations, views }
}

const AUTO = 'diagram_'
const autoId = (fqn) => AUTO + fqn.replace(/\./g, '__')
const quote = (s) => `'${String(s).replace(/\\/g, '').replace(/'/g, '’')}'`

/**
 * Groups unfolded inside the view of `scope` (null: the overview): an
 * unfolded group shows there when every group between it and `scope` is
 * unfolded too.
 */
function unfoldedIn(model, expand, scope) {
  const out = []
  for (const x of expand) {
    const el = model.elements[x]
    if (!el || el.children.length === 0) continue
    let p = el.parent
    while (p !== scope && p !== null && expand.has(p)) p = model.elements[p]?.parent ?? null
    if (p === scope) out.push(x)
  }
  return out
}

/**
 * One view per group: the schema views (top-level groups, one button each)
 * and the drill-down views (nested groups, reached by zooming). Groups the
 * user unfolded are expanded in place (`include X.*`) in every generated view
 * that shows them.
 */
function generateViews(model, expand = new Set(), source = '') {
  const scoped = new Map()
  for (const v of model.views) if (v.viewOf && !scoped.has(v.viewOf)) scoped.set(v.viewOf, v.id)
  const lines = []
  const viewOfElement = {}
  for (const id of model.order) {
    const el = model.elements[id]
    if (el.children.length === 0) continue
    if (scoped.has(id)) {
      viewOfElement[id] = scoped.get(id)
      continue
    }
    const vid = autoId(id)
    viewOfElement[id] = vid
    lines.push(`  view ${vid} of ${id} {`, `    title ${quote(el.title)}`, '    include *', ...unfoldedIn(model, expand, id).map((x) => `    include ${x}.*`), '  }')
  }
  // The overview is LikeC4's implicit index view, unless the diagram defines one.
  const ownIndex = /(^|\n)\s*view\s+index\b/.test(source)
  const top = ownIndex ? [] : unfoldedIn(model, expand, null)
  if (top.length) lines.push('  view index {', '    include *', ...top.map((x) => `    include ${x}.*`), '  }')
  const generated = new Set(Object.values(viewOfElement).filter((v) => v.startsWith(AUTO)))
  if (!ownIndex) generated.add('index')
  const schemas = model.order
    .filter((id) => model.elements[id].parent === null && model.elements[id].children.length > 0)
    .map((id) => ({ view: viewOfElement[id], element: id, title: model.elements[id].title }))
  const used = new Set(Object.values(viewOfElement))
  const extras = model.views.filter((v) => v.id !== 'index' && !used.has(v.id)).map((v) => ({ view: v.id, title: v.title ?? v.id, type: v.type }))
  return { text: lines.length ? `\nviews {\n${lines.join('\n')}\n}\n` : '', schemas, extras, viewOfElement, generated }
}

/** Adds state, marks, roll-up and merged-link info to the layouted views. */
function decorate(views, model, viewOfElement, generated = new Set(), expand = new Set()) {
  const descendants = (id) => {
    const out = []
    const walk = (x) => {
      for (const c of model.elements[x]?.children ?? []) {
        out.push(c)
        walk(c)
      }
    }
    walk(id)
    return out
  }
  for (const v of views) {
    for (const n of v.nodes) {
      const el = model.elements[n.id]
      n.state = el?.state ?? stateOf(n.tags)
      n.marks = el?.marks ?? []
      n.metadataPlain = el?.metadata ?? {}
      n.drill = viewOfElement[n.id] && viewOfElement[n.id] !== v.id ? viewOfElement[n.id] : undefined
      // Can be unfolded / folded back in place: a group inside the scope of a generated view.
      n.unfold = !!el && el.children.length > 0 && generated.has(v.id) && (v.viewOf ? n.id.startsWith(v.viewOf + '.') : true)
      n.expanded = n.unfold && n.children.length > 0 && expand.has(n.id)
      if (el && el.children.length > 0 && n.children.length === 0) {
        const byState = {}
        let count = 0
        for (const d of descendants(n.id)) {
          const s = model.elements[d].state
          if (!s || s === 'frozen') continue
          byState[s] = (byState[s] ?? 0) + 1
          count++
        }
        if (count > 0) n.rollup = { count, state: STATES.find((s) => byState[s]), byState }
        n.hidden = descendants(n.id).length
      }
    }
    for (const e of v.edges) {
      const rels = (e.relations ?? []).map((id) => model.relations[id]).filter(Boolean)
      e.count = rels.length
      e.relationList = rels.map((r) => ({ source: model.elements[r.source]?.title ?? r.source, target: model.elements[r.target]?.title ?? r.target, title: r.title }))
      e.state = stateOf(e.tags)
    }
  }
}

function lineOf(source, id) {
  const name = id.split('.').pop()
  const re = new RegExp(`^\\s*${name.replace(/[^\w]/g, '')}\\s*=`, 'm')
  const m = re.exec(source)
  return m ? source.slice(0, m.index + m[0].length).split('\n').length - 1 : 0
}

/** Readability problems: the Host refuses a diagram that has any. */
export function lint(model, views, source) {
  const out = []
  const add = (id, message) => out.push({ message, line: id ? lineOf(source, id) : 0, character: 1, file: 'diagram.c4', element: id })
  const els = model.order.map((id) => model.elements[id])
  if (els.length > RULES.elements) add(null, `${els.length} elements: the whole diagram holds at most ${RULES.elements}. Remove what this conversation no longer needs.`)
  const roots = els.filter((e) => e.parent === null)
  if (roots.length > RULES.roots) add(null, `${roots.length} top-level elements: at most ${RULES.roots}. Group them into schemas.`)
  for (const e of els) {
    if (e.parent === null && e.children.length === 0 && !ROOT_LEAF_KINDS.has(e.kind)) add(e.id, `\`${e.id}\` sits alone at the root: put it inside a schema group (only person/external may stay at the root).`)
    if (e.children.length > RULES.children) add(e.id, `\`${e.id}\` has ${e.children.length} children: at most ${RULES.children}. Add an intermediate group by function.`)
    if (e.depth > RULES.depth) add(e.id, `\`${e.id}\` is nested ${e.depth} levels deep: at most ${RULES.depth}.`)
    if (e.title.length > RULES.title) add(e.id, `title of \`${e.id}\` is ${e.title.length} chars: at most ${RULES.title}. Move the detail to description or metadata.`)
    if (e.description.length > RULES.description) add(e.id, `description of \`${e.id}\` is ${e.description.length} chars: at most ${RULES.description}. Long detail goes in metadata (shown on click).`)
    if (e.technology.length > RULES.technology) add(e.id, `technology of \`${e.id}\` is ${e.technology.length} chars: at most ${RULES.technology}.`)
  }
  for (const r of Object.values(model.relations)) {
    if (r.title.length > RULES.relation) {
      const m = source.indexOf(r.title)
      out.push({ message: `label '${r.title.slice(0, 40)}…' (${r.source} -> ${r.target}) is ${r.title.length} chars: at most ${RULES.relation}.`, line: m >= 0 ? source.slice(0, m).split('\n').length - 1 : 0, character: 1, file: 'diagram.c4' })
    }
  }
  for (const v of views) {
    const boxes = v.nodes.length
    if (boxes > RULES.viewNodes) add(null, `view \`${v.id}\` draws ${boxes} boxes: at most ${RULES.viewNodes}. Do not write views that expand everything (\`include *, x.*\`); the plugin makes one view per group.`)
  }
  return out
}

async function parseModel(source) {
  const first = await load({ 'prelude.c4': PRELUDE, 'diagram.c4': source })
  const errors = collectErrors(first)
  if (errors.some((e) => e.file === 'diagram.c4' || e.file === '')) {
    try { await first.dispose() } catch {}
    return { errors, model: null }
  }
  try {
    return { errors, model: summarize(await first.computedModel()) }
  } catch (e) {
    return { errors: [{ message: 'model: ' + String(e?.message ?? e), line: 0, character: 0, file: 'diagram.c4' }], model: null }
  } finally {
    try { await first.dispose() } catch {}
  }
}

/**
 * Parse and lay out one conversation diagram.
 * @param {string} source - the diagram's LikeC4 text (without the prelude).
 * @param {{direction?: string, expand?: string[]}} [options] - expand: groups unfolded in place.
 * @returns {Promise<{errors: any[], problems: any[], views: any[], schemas: any[], extras: any[], model: any}>}
 */
export async function compute(source, options = {}) {
  quiet()
  const empty = { problems: [], views: [], schemas: [], extras: [], model: null }
  const version = formatOf(source)
  if (version !== FORMAT_VERSION) {
    return { errors: [{ message: version === null ? `first line must be \`// ${FORMAT}\`` : `this format version is not supported: this plugin reads \`// ${FORMAT}\``, line: 0, character: 1, file: 'diagram.c4' }], ...empty, legacy: true }
  }
  let first = parsed.get(source)
  if (!first) {
    first = parseModel(source)
    parsed.set(source, first)
    if (parsed.size > 8) parsed.delete(parsed.keys().next().value)
  }
  const { errors: parseErrors, model } = await first
  const errors = [...parseErrors]
  if (!model) return { errors, ...empty }
  const expand = new Set(options.expand ?? [])
  const gen = generateViews(model, expand, source)
  let full = source + gen.text
  if (options.direction) full = orient(full, options.direction)
  const second = await load({ 'prelude.c4': PRELUDE, 'diagram.c4': full })
  let views = []
  try {
    views = await second.diagrams()
  } catch (e) {
    errors.push({ message: 'layout: ' + String(e?.message ?? e), line: 0, character: 0, file: 'diagram.c4' })
  }
  try { await second.dispose() } catch {}
  decorate(views, model, gen.viewOfElement, gen.generated, expand)
  // The implicit landscape view only matters when there is no group at all.
  const shown = gen.schemas.length > 0 ? views.filter((v) => v.id !== 'index') : views
  // Unfolded views are bigger on purpose: only the diagram itself is linted.
  const problems = lint(model, expand.size ? [] : shown, source)
  const schemas = gen.schemas.length > 0 ? gen.schemas : views.some((v) => v.id === 'index') ? [{ view: 'index', element: null, title: '∗' }] : []
  return { errors, problems, views, schemas, extras: gen.extras, model, viewOfElement: gen.viewOfElement }
}

// ── static SVG (message previews, written by the Host) ──────────────────────

const SVG_COLORS = {
  label: '#111827', secondary: '#6b7280', bg: '#ffffff', layer: '#f7f7f8', group: '#f1f1f3', border: '#d4d4d8',
  blocked: '#dc2626', deviation: '#ea580c', waiting: '#db2777', doing: '#2563eb', planned: '#7c3aed', impacted: '#b45309', done: '#16a34a', frozen: '#94a3b8',
}
export const STATE_LABELS = {
  en: { blocked: 'blocked', deviation: 'deviation', waiting: 'waiting for you', doing: 'in progress', planned: 'planned', impacted: 'impacted', done: 'done', frozen: 'frozen', new: 'new', removed: 'removed' },
  fr: { blocked: 'bloqué', deviation: 'écart', waiting: 'attend ta réponse', doing: 'en cours', planned: 'prévu', impacted: 'impacté', done: 'fait', frozen: 'gelé', new: 'nouveau', removed: 'supprimé' },
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const mix = (a, b, p) => '#' + hex(a).map((v, i) => Math.round(v * p + hex(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('')

/** Self-contained SVG of one decorated view (light theme). */
export function toSvg(view, { lang = 'en', title } = {}) {
  const L = STATE_LABELS[lang] ?? STATE_LABELS.en
  const C = SVG_COLORS
  const b = view.bounds
  const pad = 24
  const head = title ? 44 : 0
  const parts = []
  const nodes = view.nodes ?? []
  const groups = nodes.filter((n) => n.children?.length).sort((a, c) => (a.level ?? 0) - (c.level ?? 0))
  const leaves = nodes.filter((n) => !n.children?.length)
  for (const n of groups) {
    const col = n.state ? C[n.state] : C.border
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="16" fill="${C.group}" stroke="${col}" stroke-width="2" stroke-dasharray="10 6"/>`)
    parts.push(`<text x="${n.x + 16}" y="${n.y + 30}" font-size="22" font-weight="700" fill="${C.secondary}">${esc(n.title.toUpperCase() + (n.state ? '  · ' + L[n.state] : ''))}</text>`)
  }
  parts.push(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.secondary}"/></marker></defs>`)
  for (const e of view.edges ?? []) {
    const col = e.state ? C[e.state] : C.secondary
    const label = e.count > 1 ? `${e.count} ${lang === 'fr' ? 'liens' : 'links'}` : e.label ?? ''
    parts.push(`<path d="${edgePath(e.points)}" fill="none" stroke="${col}" stroke-width="2.5"${e.line === 'dotted' ? ' stroke-dasharray="3 6"' : ''} marker-end="url(#a)"/>`)
    const bb = e.labelBBox
    if (label && bb) {
      const w = Math.max(bb.width, label.length * 10.5) + 12
      parts.push(`<rect x="${bb.x - 6}" y="${bb.y - 3}" width="${w}" height="${Math.max(bb.height, 24) + 6}" rx="5" fill="${C.bg}" opacity=".9"/>`)
      parts.push(`<text x="${bb.x}" y="${bb.y + Math.max(bb.height, 24) * 0.78}" font-size="20" fill="${C.label}"${e.count > 1 ? ' font-style="italic"' : ''}>${esc(label)}</text>`)
    }
  }
  for (const n of leaves) {
    const { x, y, width: w, height: h } = n
    const st = n.state ?? n.rollup?.state
    const col = st ? C[st] : C.secondary
    const own = !!n.state
    const group = n.hidden > 0
    const fill = own ? mix(col, C.layer, 0.14) : group ? mix(GROUP_COLOR, C.layer, 0.08) : C.layer
    const stroke = own ? col : group ? GROUP_COLOR : st ? col : C.border
    const dash = n.state === 'planned' || n.state === 'frozen' ? ' stroke-dasharray="8 6"' : ''
    if (n.shape === 'storage' || n.shape === 'cylinder') {
      const ry = Math.min(18, h / 6)
      parts.push(`<path d="M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} L${x + w},${y + h - ry} A${w / 2},${ry} 0 0 1 ${x},${y + h - ry} Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`)
    } else if (n.shape === 'document') {
      const wv = Math.min(14, h / 8)
      parts.push(`<path d="M${x},${y} H${x + w} V${y + h - wv} C${x + w * 0.75},${y + h - 3 * wv} ${x + w * 0.25},${y + h + wv} ${x},${y + h - wv} Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`)
    } else {
      // A collapsed group is a stack of cards: it holds more than it shows.
      if (group) for (const d of [12, 6]) parts.push(`<rect x="${x + d}" y="${y + d}" width="${w}" height="${h}" rx="14" fill="${C.layer}" stroke="${GROUP_COLOR}" stroke-width="2" opacity="${d === 12 ? 0.5 : 0.8}"/>`)
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n.shape === 'person' ? 30 : 14}" fill="${fill}" stroke="${stroke}" stroke-width="${group ? 3.5 : 2.5}"${dash}/>`)
      if (group) parts.push(`<text x="${x + 16}" y="${y + h - 14}" font-size="20" font-weight="700" fill="${GROUP_COLOR}">⊕ ${n.hidden}</text>`)
    }
    const tl = wrap(n.title, Math.max(10, Math.floor(w / 16)), 2)
    const desc = wrap(textOf(n.description), Math.max(12, Math.floor(w / 11)), 2)
    const block = tl.length * 32 + desc.length * 24
    let cy = y + h / 2 - block / 2 + 30
    for (const line of tl) {
      parts.push(`<text x="${x + w / 2}" y="${cy}" text-anchor="middle" font-size="28" font-weight="600" fill="${C.label}">${esc(line)}</text>`)
      cy += 32
    }
    for (const line of desc) {
      parts.push(`<text x="${x + w / 2}" y="${cy + 2}" text-anchor="middle" font-size="19" fill="${C.secondary}">${esc(line)}</text>`)
      cy += 24
    }
    const pill = n.state ? L[n.state] + (n.marks?.length ? ' · ' + n.marks.map((m) => L[m]).join(' · ') : '') : n.rollup ? `${n.rollup.byState[n.rollup.state]} ${L[n.rollup.state]}${n.rollup.count > n.rollup.byState[n.rollup.state] ? ' +' + (n.rollup.count - n.rollup.byState[n.rollup.state]) : ''}` : n.marks?.length ? n.marks.map((m) => L[m]).join(' · ') : ''
    if (pill) {
      const pw = pill.length * 9.5 + 22
      parts.push(`<rect x="${x + w - pw - 10}" y="${y + 10}" width="${pw}" height="28" rx="14" fill="${own || !n.rollup ? col : C.bg}" stroke="${col}" stroke-width="2"/>`)
      parts.push(`<text x="${x + w - pw / 2 - 10}" y="${y + 29}" text-anchor="middle" font-size="16" font-weight="600" fill="${own || !n.rollup ? '#fff' : col}">${esc(pill)}</text>`)
    }
  }
  const vb = [b.x - pad, b.y - pad - head, b.width + pad * 2, b.height + pad * 2 + head]
  const heading = title ? `<text x="${b.x}" y="${b.y - pad + 4}" font-size="26" font-weight="700" fill="${C.label}">${esc(title)}</text>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${Math.round(vb[2] / 2)}" height="${Math.round(vb[3] / 2)}" font-family="Inter,system-ui,Helvetica,Arial,sans-serif"><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${C.bg}"/>${heading}${parts.join('')}</svg>`
}
