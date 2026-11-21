// Theme tokens and state colours.
import { STATES as VOCAB_STATES } from './vocab.js'
export { GROUP_COLOR } from './shared.js'

export const V = (name) => `var(--dsw-alias-${name})`
// Fixed hues: the theme has no info/accent palette.
const COLORS = {
  blocked: V('state-error-primary'),
  deviation: '#ea580c',
  waiting: '#db2777',
  doing: '#3b82f6',
  planned: '#8b5cf6',
  impacted: '#b45309',
  done: V('state-success-primary'),
  frozen: V('state-idle-primary'),
}
/** Ordered by the shared vocabulary's display precedence. */
export const STATES = VOCAB_STATES.map((state) => [state, COLORS[state]])
export const STATE_COLOR = new Map(STATES)
export const LEGEND = ['planned', 'doing', 'done', 'impacted', 'deviation', 'blocked', 'waiting']
