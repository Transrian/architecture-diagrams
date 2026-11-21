// Dependency-free vocabulary shared by the engine, prompt and viewer.

/** Canonical element kinds (what the prompt teaches). */
export const KINDS = ['system', 'machine', 'service', 'component', 'data', 'doc', 'person', 'external', 'hardware']
/** First line of every diagram file. Files without it are not loaded. */
export const FORMAT = 'diagram v1'
/** Current format version. */
export const FORMAT_VERSION = 1
/** Kinds allowed at the root of the model without being a group. */
export const ROOT_LEAF_KINDS = new Set(['person', 'external'])
/** State tags, by display precedence (first wins, also for the roll-up). */
export const STATES = ['blocked', 'deviation', 'waiting', 'doing', 'planned', 'impacted', 'done', 'frozen']
/** Marks shown next to the state. */
export const MARKS = ['new', 'removed']

/** Readability rules shared with the prompt and viewer. */
export const RULES = {
  children: 7, // boxes inside one group
  roots: 8, // top-level elements (schemas + people/externals)
  depth: 6, // schema > up to 4 nested groups > leaf
  title: 32,
  description: 80,
  technology: 40,
  relation: 30,
  viewNodes: 16, // boxes drawn in one view
}
