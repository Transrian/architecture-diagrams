import { groupSummary } from '../core/shared.js'
import { MARKS } from '../core/vocab.js'
import { stateOf } from './vocabulary.mjs'
import { sourceIndex } from './scanner.mjs'
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
export function generateViews(model, expand = new Set(), source = '') {
  const scoped = new Map()
  for (const v of model.views) if (v.viewOf && !scoped.has(v.viewOf)) scoped.set(v.viewOf, v.id)
  const lines = []
  const viewOfElement = {}
  const taken = new Set(model.views.map((view) => view.id))
  const generated = new Set()
  for (const id of model.order) {
    const el = model.elements[id]
    if (el.children.length === 0) continue
    if (scoped.has(id)) {
      viewOfElement[id] = scoped.get(id)
      continue
    }
    const base = autoId(id)
    let vid = base
    for (let suffix = 2; taken.has(vid); suffix++) vid = `${base}_${suffix}`
    taken.add(vid)
    generated.add(vid)
    viewOfElement[id] = vid
    lines.push(
      `  view ${vid} of ${id} {`,
      `    title ${quote(el.title)}`,
      '    include *',
      ...unfoldedIn(model, expand, id).map((x) => `    include ${x}.*`),
      '  }',
    )
  }
  // computedModel() also reports LikeC4's implicit index: only real source
  // declarations tell whether the overview belongs to the user.
  const ownIndex = sourceIndex(source).viewIds.has('index')
  const top = ownIndex ? [] : unfoldedIn(model, expand, null)
  if (top.length) lines.push('  view index {', '    include *', ...top.map((x) => `    include ${x}.*`), '  }')
  // The implicit overview is generated too, unless explicitly replaced above.
  if (!ownIndex) generated.add('index')
  const schemas = model.order
    .filter((id) => model.elements[id].parent === null && model.elements[id].children.length > 0)
    .map((id) => ({ view: viewOfElement[id], element: id, title: model.elements[id].title }))
  const used = new Set(Object.values(viewOfElement))
  const extras = model.views
    .filter((v) => v.id !== 'index' && !used.has(v.id))
    .map((v) => ({ view: v.id, title: v.title ?? v.id, type: v.type }))
  return { text: lines.length ? `\nviews {\n${lines.join('\n')}\n}\n` : '', schemas, extras, viewOfElement, generated }
}

/** Adds state, marks, roll-up and merged-link info to the layouted views. */
export function decorate(views, model, viewOfElement, generated = new Set(), expand = new Set()) {
  for (const v of views) {
    // Explicitly distinguish generated views from user views with similar ids.
    v.generated = generated.has(v.id)
    for (const n of v.nodes) {
      const el = model.elements[n.id]
      n.state = el?.state ?? stateOf(n.tags)
      n.marks = el?.marks ?? []
      n.metadataPlain = el?.metadata ?? {}
      const ic = model.icons?.[n.id]
      n.icon = ic?.icon ?? null
      n.iconHow = ic?.how ?? 'none'
      n.drill = viewOfElement[n.id] && viewOfElement[n.id] !== v.id ? viewOfElement[n.id] : undefined
      // Can be unfolded / folded back in place: a group inside the scope of a generated view.
      n.unfold = !!el && el.children.length > 0 && generated.has(v.id) && (v.viewOf ? n.id.startsWith(v.viewOf + '.') : true)
      n.expanded = n.unfold && n.children.length > 0 && expand.has(n.id)
      if (el && el.children.length > 0 && n.children.length === 0) Object.assign(n, groupSummary(model, n.id))
    }
    for (const e of v.edges) {
      const rels = (e.relations ?? []).map((id) => model.relations[id]).filter(Boolean)
      e.count = rels.length
      e.relationList = rels.map((r) => ({
        id: r.id,
        source: model.elements[r.source]?.title ?? r.source,
        target: model.elements[r.target]?.title ?? r.target,
        sourceId: r.source,
        targetId: r.target,
        title: r.title,
        kind: r.kind,
        state: r.state,
        marks: r.marks,
        metadata: r.metadata,
      }))
      // LikeC4 can retain just one relation's tags on a merged edge. Aggregate
      // the original relations instead, including untagged links in `mixed`.
      e.state = rels.length ? stateOf(rels.map((r) => r.state)) : stateOf(e.tags)
      e.mixed = new Set(rels.map((r) => r.state)).size > 1
      e.marks = MARKS.filter((mark) => rels.some((relation) => relation.marks.includes(mark)))
      e.assumedCount = rels.filter((relation) => relation.marks.includes('assumed')).length
      // LikeC4 keeps the first original kind on a merged edge, which can hide
      // unlike semantics. Plain calls (null) also participate in this set.
      const kinds = new Set(rels.map((r) => r.kind))
      e.kind = kinds.size > 1 ? 'mixed' : rels.length ? rels[0].kind : null
    }
  }
}
