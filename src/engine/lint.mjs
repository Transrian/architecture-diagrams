import { RULES, ROOT_LEAF_KINDS } from '../core/vocab.js'
import { sourceIndex } from './scanner.mjs'
function diagnostics(source) {
  const out = []
  const positions = sourceIndex(source)
  const add = (id, message) =>
    out.push({
      message,
      line: id ? positions.lineOf(id) : 0,
      character: 1,
      file: 'diagram.c4',
      element: id,
    })
  return { out, positions, add }
}

/** Readability problems: the CLI refuses a diagram that has any. */
export function lint(model, source) {
  const { out, positions, add } = diagnostics(source)
  for (const id of model.order) {
    const e = model.elements[id]
    if (e.parent === null && e.children.length === 0 && !ROOT_LEAF_KINDS.has(e.kind))
      add(e.id, `\`${e.id}\` sits alone at the root: put it inside a schema group (only person/external may stay at the root).`)
    if (e.title.length > RULES.title)
      add(e.id, `title of \`${e.id}\` is ${e.title.length} chars: at most ${RULES.title}. Move the detail to description or metadata.`)
    if (e.description.length > RULES.description)
      add(
        e.id,
        `description of \`${e.id}\` is ${e.description.length} chars: at most ${RULES.description}. ` +
          'Long detail goes in metadata (shown on click).',
      )
    if (e.technology.length > RULES.technology)
      add(e.id, `technology of \`${e.id}\` is ${e.technology.length} chars: at most ${RULES.technology}.`)
  }
  for (const r of Object.values(model.relations)) {
    if (r.title.length > RULES.relation) {
      out.push({
        message: `label '${r.title.slice(0, 40)}…' (${r.source} -> ${r.target}) is ${r.title.length} chars: at most ${RULES.relation}.`,
        line: positions.relationLine(r),
        character: 1,
        file: 'diagram.c4',
      })
    }
  }
  return out
}

/** Size targets: reported in the verdict, never a reason to refuse. */
export function advise(model, views, source) {
  const { out, add } = diagnostics(source)
  const els = model.order.map((id) => model.elements[id])
  const roots = els.filter((e) => e.parent === null)
  if (roots.length > RULES.roots) add(null, `${roots.length} top-level elements: target ${RULES.roots}. Group them into schemas.`)
  const deepest = (e) => Math.max(e.depth, ...e.children.map((id) => deepest(model.elements[id])))
  for (const e of els) {
    if (e.children.length > RULES.children)
      add(e.id, `\`${e.id}\` has ${e.children.length} children: target ${RULES.children}. Add an intermediate group by function.`)
    // Named once at the last allowed level, not once per deeper element.
    if (e.depth === RULES.depth && e.children.length) add(e.id, `\`${e.id}\` nests ${deepest(e)} levels deep: target ${RULES.depth}.`)
  }
  for (const v of views) {
    const boxes = v.nodes.length
    if (boxes > RULES.viewNodes)
      add(
        null,
        `view \`${v.id}\` draws ${boxes} boxes: target ${RULES.viewNodes}. ` +
          'Do not write views that expand everything (`include *, x.*`); the viewer makes one view per group.',
      )
  }
  return out
}
