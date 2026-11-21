/** Pure verdict formatting shared by the DSH host and the standalone CLI. */

export function errorReport({ rel, errors, maxErrors = 8, shown = '' }) {
  const lines = errors.slice(0, maxErrors).map((e) => `  ${rel}:${e.line + 1}:${e.character}  ${e.message}`)
  const hidden = errors.length - lines.length
  return [
    `[diagram] ${rel} does not parse${shown ? ` — ${shown}` : ''}. Fix them now:`,
    ...lines,
    ...(hidden > 0 ? [`  (+${hidden} more)`] : []),
    'Reminder: first line `// diagram v1`; tags go first inside braces; ids use letters/digits/_; no `specification` block needed.',
  ].join('\n')
}

export function refusalReport({ rel, problems, rules, maxErrors = 8 }) {
  const lines = problems.slice(0, maxErrors).map((p) => `  ${rel}:${p.line + 1}  ${p.message}`)
  const hidden = problems.length - lines.length
  return [
    `[diagram] ${rel} refused: too heavy for the user to read at a glance (not kept as a version). Fix it now:`,
    ...lines,
    ...(hidden > 0 ? [`  (+${hidden} more)`] : []),
    `Rules: architecture only (no task/proof boxes), every element inside a schema group except person/external, ≤${rules.children} children per group, ≤${rules.depth} levels, ≤${rules.viewNodes} boxes per view, titles ≤${rules.title} chars, detail in metadata.`,
  ].join('\n')
}

/** `icons` and `link` are optional, already formatted lines; no host state lives here. */
export function okReport({ result, version, icons, shown = 'and shown to the user', link = null }) {
  const byId = new Map(result.views.map((v) => [v.id, v]))
  const drill = Object.keys(result.viewOfElement ?? {}).length - result.schemas.filter((s) => s.element).length
  const schemas = result.schemas.map((s) => `${s.title} (${byId.get(s.view)?.nodes.length ?? 0} boxes)`).join(', ')
  const lines = [
    `[diagram] Diagram ${version !== undefined ? `v${version} ` : ''}valid${shown ? ` ${shown}` : ''}: ${schemas || 'no schema'}${drill > 0 ? `, ${drill} drill-down view(s)` : ''}${result.extras.length ? `, flows: ${result.extras.map((e) => e.title).join(', ')}` : ''}.`,
  ]
  if (icons) lines.push(icons)
  if (link != null) lines.push(link)
  return lines.join('\n')
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
