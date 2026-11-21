// Theme tokens and state colours.
import { STATES as VOCAB_STATES, RELATION_KINDS } from './vocab.js'
export { GROUP_COLOR } from './shared.js'

export const V = (name) => `var(--dsw-alias-${name})`
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
/** Redundant, monochrome-safe state cues. */
export const STATE_GLYPH = { blocked: '⊘', deviation: 'Δ', waiting: '‖', doing: '↻', planned: '◷', impacted: '↔', done: '✓', frozen: '❄' }
export const stateLabel = (state, t) => state ? `${STATE_GLYPH[state]} ${t('state.' + state)}` : ''
export const LEGEND = ['planned', 'doing', 'done', 'impacted', 'deviation', 'blocked', 'waiting']

/** Link meaning uses pattern, weight and arrowhead, never a state colour. */
export function relationStyle(kind) {
  return { pattern: kind === 'async' ? '16 8' : undefined, width: kind === 'data' ? 4 : 2.5, head: kind === 'async' ? 'open' : kind === 'data' ? 'double' : 'full' }
}

/** Only encodings actually drawn in this view belong in its legend. */
export function viewLegend(view) {
  const states = new Set((view?.nodes ?? []).map((node) => node.state ?? node.rollup?.state))
  const kinds = new Set()
  for (const edge of view?.edges ?? []) {
    states.add(edge.state)
    kinds.add(edge.kind ?? 'call')
  }
  return { states: VOCAB_STATES.filter((state) => states.has(state)), kinds: ['call', ...RELATION_KINDS, 'mixed'].filter((kind) => kinds.has(kind)) }
}
