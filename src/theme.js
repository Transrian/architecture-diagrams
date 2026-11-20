// Theme tokens and state colours.
export { GROUP_COLOR } from './shared.js'

export const V = (name) => `var(--dsw-alias-${name})`
/** Ordered by precedence (same order as the engine). Fixed hues: the theme has no info/accent palette. */
export const STATES = [
  ['blocked', V('state-error-primary')],
  ['deviation', '#ea580c'],
  ['waiting', '#db2777'],
  ['doing', '#3b82f6'],
  ['planned', '#8b5cf6'],
  ['impacted', '#b45309'],
  ['done', V('state-success-primary')],
  ['frozen', V('state-idle-primary')],
]
export const STATE_COLOR = new Map(STATES)
export const LEGEND = ['planned', 'doing', 'done', 'impacted', 'deviation', 'blocked', 'waiting']
