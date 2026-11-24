// Theme tokens and state colours.
import { STATES as VOCAB_STATES, RELATION_KINDS } from '../core/vocab.js'
import { stepLabel } from '../core/shared.js'
export { GROUP_COLOR } from '../core/shared.js'

export const V = (name) => `var(--dshd-${name})`
// Blend fixed hues toward the theme foreground for readable light/dark cues.
const adaptive = (hue) => `color-mix(in srgb, ${hue} 78%, ${V('label-primary')})`
const COLORS = {
  blocked: V('state-error-primary'),
  deviation: adaptive('#0891b2'),
  waiting: adaptive('#db2777'),
  doing: adaptive('#3b82f6'),
  planned: adaptive('#8b5cf6'),
  impacted: adaptive('#d97706'),
  done: V('state-success-primary'),
  frozen: V('state-idle-primary'),
}
/** Ordered by the shared vocabulary's display precedence. */
export const STATES = VOCAB_STATES.map((state) => [state, COLORS[state]])
export const STATE_COLOR = new Map(STATES)
/**
 * Redundant, monochrome-safe state cues. One meaning per symbol across the
 * viewer: Δ is kept for observed changes, so a deviation is ≠.
 */
export const STATE_GLYPH = { blocked: '⊘', deviation: '≠', waiting: '‖', doing: '↻', planned: '◷', impacted: '↔', done: '✓', frozen: '❄' }
export const stateLabel = (state, t) => (state ? `${STATE_GLYPH[state]} ${t('state.' + state)}` : '')
export const LEGEND = ['planned', 'doing', 'done', 'impacted', 'deviation', 'blocked', 'waiting']

/**
 * Link meaning uses pattern, weight and arrowhead, never a state colour. A
 * merged edge of several kinds is dash-dotted, unlike any single kind.
 */
export function relationStyle(kind) {
  return {
    pattern: kind === 'async' ? '16 8' : kind === 'mixed' ? '10 4 2 4' : undefined,
    width: kind === 'data' ? 4 : 2.5,
    head: kind === 'async' ? 'open' : kind === 'data' ? 'double' : 'full',
  }
}

/** Provenance is a text cue, independent of state and relationship meaning. */
export function relationAssumed(edge) {
  return !!(edge?.assumedCount > 0 || edge?.marks?.includes('assumed') || edge?.tags?.includes('assumed'))
}
export function relationLabel(edge, index, dynamic, t) {
  const base = edge.count > 1 ? t('count.links', { n: edge.count }) : (edge.label ?? '')
  const label = dynamic ? `${stepLabel(edge.id, index)}. ${base}` : base
  return relationAssumed(edge) ? label.trimEnd() + (label.trim() ? ' ?' : '?') : label
}
/** Unlabelled inferred links still need a visible '?' without a new layout. */
export function relationLabelBox(edge) {
  if (edge.labelBBox) return edge.labelBBox
  if (!relationAssumed(edge) || !edge.points?.length) return null
  const points = edge.points
  const segments = Math.floor((points.length - 1) / 3)
  let middle
  if (segments > 0) {
    const i = Math.floor(segments / 2) * 3
    middle =
      segments % 2 === 0
        ? points[i]
        : [0, 1].map((axis) => (points[i][axis] + 3 * points[i + 1][axis] + 3 * points[i + 2][axis] + points[i + 3][axis]) / 8)
  } else {
    const a = points[Math.floor((points.length - 1) / 2)],
      b = points[Math.ceil((points.length - 1) / 2)]
    middle = [0, 1].map((axis) => (a[axis] + b[axis]) / 2)
  }
  return { x: middle[0] + 8, y: middle[1] - 24, width: 12, height: 24 }
}

/** Only encodings actually drawn in this view belong in its legend. */
export function viewLegend(view) {
  const states = new Set((view?.nodes ?? []).map((node) => node.state ?? node.rollup?.state))
  const kinds = new Set()
  for (const edge of view?.edges ?? []) {
    states.add(edge.state)
    kinds.add(edge.kind ?? 'call')
  }
  const assumed =
    (view?.nodes ?? []).some((node) => node.marks?.includes('assumed') || node.assumedCount > 0) ||
    (view?.edges ?? []).some(relationAssumed)
  // Outside frames can navigate too, even when they have no hidden children.
  const frame = view?.viewOf ? view.nodes.find((node) => node.id === view.viewOf && node.children?.length) : null
  const within = (id) => !frame || id === frame.id || id.startsWith(frame.id + '.')
  const groups = (view?.nodes ?? []).filter((node) => node.hidden > 0)
  return {
    states: VOCAB_STATES.filter((state) => states.has(state)),
    kinds: ['call', ...RELATION_KINDS, 'mixed'].filter((kind) => kinds.has(kind)),
    assumed,
    opens: groups.some((node) => within(node.id)),
    elsewhere:
      groups.some((node) => !within(node.id)) ||
      (view?.nodes ?? []).some((node) => !within(node.id) && node.drill && node.children?.length && !frame.id.startsWith(node.id + '.')),
  }
}
