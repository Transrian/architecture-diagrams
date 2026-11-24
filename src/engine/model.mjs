import { textOf } from '../core/shared.js'
import { STATES, MARKS } from '../core/vocab.js'
import { resolveIcons } from './iconmatch.js'
import { stateOf } from './vocabulary.mjs'
/** Plain, serializable summary of the parsed model. */
export function summarize(cm, iconIndex) {
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
      icon: raw.icon ?? raw.style?.icon ?? null,
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
    const meta = {}
    for (const [k, v] of Object.entries(raw.metadata ?? {})) meta[k] = Array.isArray(v) ? v.join(', ') : String(v)
    const tags = raw.tags ?? []
    relations[r.id] = {
      id: r.id,
      source: raw.source?.model ?? r.source?.id,
      target: raw.target?.model ?? r.target?.id,
      title: raw.title ?? r.title ?? '',
      kind: raw.kind ?? null,
      metadata: meta,
      tags,
      state: stateOf(tags),
      marks: MARKS.filter((m) => tags.includes(m)),
    }
  }
  const views = []
  for (const v of cm.views()) views.push({ id: v.id, type: v.$view?._type, viewOf: v.$view?.viewOf ?? null, title: v.$view?.title ?? null })
  const model = { elements, order, relations, views }
  model.icons = resolveIcons(model, iconIndex)
  return model
}

/**
 * What the agent may want to know about the icons: technologies no product
 * matched, and icons picked from a title alone (a codename can look like a
 * product: "Phoenix").
 */
export function iconReport(model) {
  const unmatched = []
  const fromTitle = []
  for (const id of model?.order ?? []) {
    const el = model.elements[id]
    const r = model.icons?.[id]
    if (!r) continue
    if (el.technology && r.how !== 'explicit' && r.how !== 'technology' && r.how !== 'none')
      unmatched.push({ id, technology: el.technology })
    if (r.how === 'title') fromTitle.push({ id, title: el.title, icon: r.icon })
  }
  return { unmatched, fromTitle }
}
