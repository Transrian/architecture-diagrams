/** Pure verdict formatting: what the agent reads after each check or render. */

export function errorReport({ rel, errors, maxErrors = 8 }) {
  const lines = errors.slice(0, maxErrors).map((e) => `  ${rel}:${e.line + 1}:${e.character}  ${e.message}`)
  const hidden = errors.length - lines.length
  return [
    `[diagram] ${rel} does not parse. Fix them now:`,
    ...lines,
    ...(hidden > 0 ? [`  (+${hidden} more)`] : []),
    'Reminder: first line `// diagram v1`; tags go first inside braces; ids use letters/digits/_; no `specification` block needed.',
  ].join('\n')
}

export function refusalReport({ rel, problems, rules, maxErrors = 8 }) {
  const lines = problems.slice(0, maxErrors).map((p) => `  ${rel}:${p.line + 1}  ${p.message}`)
  const hidden = problems.length - lines.length
  return [
    `[diagram] ${rel} refused: hard for the user to read (not kept as a version). Fix it now:`,
    ...lines,
    ...(hidden > 0 ? [`  (+${hidden} more)`] : []),
    'Rules: architecture only (no task/proof boxes), every element inside a schema group except person/external, ' +
      `titles ≤${rules.title} chars, description ≤${rules.description}, ` +
      `technology ≤${rules.technology}, relation label ≤${rules.relation}, detail in metadata.`,
  ].join('\n')
}

/** Optional notes are already formatted lines. */
export function okReport({ result, version, icons, changes, warning, unlabeled, advice }) {
  const byId = new Map(result.views.map((v) => [v.id, v]))
  const drill = Object.keys(result.viewOfElement ?? {}).length - result.schemas.filter((s) => s.element).length
  const schemas = result.schemas.map((s) => `${s.title} (${byId.get(s.view)?.nodes.length ?? 0} boxes)`).join(', ')
  const lines = [
    `[diagram] Diagram ${version !== undefined ? `v${version} ` : ''}valid: ${schemas || 'no schema'}` +
      (drill > 0 ? `, ${drill} drill-down view(s)` : '') +
      (result.extras.length ? `, flows: ${result.extras.map((e) => e.title).join(', ')}` : '') +
      '.',
  ]
  for (const note of [advice, changes, warning, unlabeled, icons]) if (note) lines.push(note)
  return lines.join('\n')
}

/** A concise summary, omitted for a source-only edit or an initial acceptance. */
export function changeLine(diff, { version } = {}) {
  if (!diff) return ''
  const { elements, relations } = diff
  if (![...Object.values(elements), ...Object.values(relations)].some((entries) => entries.length)) return ''
  const states = elements.changed.filter((entry) => entry.fields.includes('state')).length
  const other = elements.changed.filter((entry) => entry.fields.some((field) => field !== 'state')).length
  return (
    `Changes since ${version !== undefined ? `v${version}` : 'previous accepted version'}: ` +
    `+${elements.added.length} elements, −${elements.removed.length}` +
    (elements.moved.length ? `, ${elements.moved.length} moved` : '') +
    (other ? `, ${other} changed` : '') +
    (states ? `, ${states} state change${states === 1 ? '' : 's'}` : '') +
    `; links +${relations.added.length} −${relations.removed.length}` +
    (relations.changed.length ? `, ${relations.changed.length} changed` : '') +
    '.'
  )
}

/** D3: both thresholds are required. Deliberate cleanup remains accepted. */
export function lossLine(diff, { snapshot } = {}) {
  const removed = diff?.elements.removed ?? []
  if (removed.length < 5 || removed.length < diff.beforeCount * 0.25) return ''
  const ids = removed
    .slice(0, 8)
    .map((element) => element.id)
    .join(', ')
  const hidden = removed.length > 8 ? ` (+${removed.length - 8} more)` : ''
  return (
    `Warning: mass deletion — ${removed.length} of ${diff.beforeCount} elements removed: ${ids}${hidden}. ` +
    'If unintended (another agent may have rewritten the file), restore them from ' +
    (snapshot ? `<${snapshot}>` : 'the previous accepted version (history is disabled; no snapshot was saved)') +
    '.'
  )
}

/** Size targets exceeded: accepted, the agent decides whether the user wanted it. */
export function adviceLines({ rel, advisories, maxErrors = 5 }) {
  if (!advisories?.length) return ''
  const lines = advisories.slice(0, maxErrors).map((p) => `  ${rel}:${p.line + 1}  ${p.message}`)
  const hidden = advisories.length - lines.length
  return [
    'Advice: above the readability targets (accepted). Keep it if the user asked for this detail, else simplify:',
    ...lines,
    ...(hidden > 0 ? [`  (+${hidden} more)`] : []),
  ].join('\n')
}

/** Soft guidance only. */
export function unlabeledLine(model) {
  const count = Object.values(model?.relations ?? {}).filter(
    (relation) => !relation.title?.trim() && !relation.marks?.includes('assumed') && !relation.tags?.includes('assumed'),
  ).length
  return count
    ? `Note: ${count} unlabeled relation${count === 1 ? '' : 's'}; ` +
        'where known, prefer a business label for what flows or happens. ' +
        'Leave unknown details unspecified rather than inventing them.'
    : ''
}

/**
 * What the agent should know about automatic icons, in one line: technologies
 * no product matched, and icons taken from a title alone. Empty when all is clear.
 */
export function iconLine(report, max = 6) {
  if (!report) return ''
  const list = (items, fmt) => items.slice(0, max).map(fmt).join(', ') + (items.length > max ? ` (+${items.length - max})` : '')
  const parts = []
  if (report.unmatched?.length)
    parts.push(
      `technology with no product icon ${list(report.unmatched, (u) => `'${u.technology}' (${u.id})`)} ` +
        '— fine if it has none, else use its usual product name',
    )
  if (report.fromTitle?.length)
    parts.push(
      `taken from the title only ${list(report.fromTitle, (f) => `${f.id} → ${f.icon}`)} ` +
        '— write `icon none` where a title only looks like a product',
    )
  return parts.length ? `Icons: ${parts.join('; ')}.` : ''
}
