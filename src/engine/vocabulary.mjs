import { KINDS, RELATION_KINDS, STATES, MARKS } from '../core/vocab.js'
import { orientationPoints } from './scanner.mjs'
const FORMAT_RE = /^\s*\/\/\s*diagram\s+v(\d+)\b/
/** Format version declared on the first line, or null. */
export function formatOf(source) {
  const first =
    String(source ?? '')
      .split('\n')
      .find((l) => l.trim() !== '') ?? ''
  const m = FORMAT_RE.exec(first)
  return m ? Number(m[1]) : null
}
export const PRELUDE = `specification {
${KINDS.map((kind) => {
  const shape = { data: 'storage', doc: 'document', person: 'person' }[kind]
  const shapeRule = shape ? `      shape ${shape}\n` : ''
  return `  element ${kind} {\n    style {\n      size small\n${shapeRule}    }\n  }`
}).join('\n')}
${RELATION_KINDS.map((kind) => `  relationship ${kind} {}`).join('\n')}
${[...STATES, ...MARKS].map((t) => `  tag ${t}`).join('\n')}
}
`

/** Canonical state of a tag list (highest precedence), or undefined. */
export function stateOf(tags) {
  return STATES.find((s) => (tags ?? []).includes(s))
}

/**
 * Give every view without its own `autoLayout` rule the requested direction.
 * The rule is inserted right before the view's closing brace, on the same
 * line, so reported line numbers stay those of the original text.
 * @param {string} src
 * @param {'TopBottom'|'LeftRight'|'BottomTop'|'RightLeft'} dir
 */
export function orient(src, dir) {
  const inserts = orientationPoints(src)
  let out = src
  for (const at of inserts.reverse()) out = out.slice(0, at) + ` autoLayout ${dir} ` + out.slice(at)
  return out
}
