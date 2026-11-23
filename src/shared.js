// Pure helpers shared by the browser client (src/) and the engine (build/entry.mjs).
import { STATES } from './vocab.js'

// A scoped view can turn an outside frame into a card without an engine layout.
// Keep its hidden-content summary identical to an engine-generated card.
export function groupSummary(model, id) {
  const nested = []
  const walk = (parent) => {
    for (const child of model.elements[parent].children) {
      nested.push(child)
      walk(child)
    }
  }
  walk(id)
  const byState = {}
  let count = 0
  for (const child of nested) {
    const state = model.elements[child].state
    if (!state || state === 'frozen') continue
    byState[state] = (byState[state] ?? 0) + 1
    count++
  }
  const within = (value) => value === id || value.startsWith(id + '.')
  let internalLinks = 0, externalLinks = 0
  for (const relation of Object.values(model.relations)) {
    const source = within(relation.source), target = within(relation.target)
    if (source && target) internalLinks++
    else if (source || target) externalLinks++
  }
  return {
    hidden: nested.length,
    rollup: count ? { count, state: STATES.find((state) => byState[state]), byState } : undefined,
    assumedCount: nested.filter((child) => model.elements[child].marks.includes('assumed')).length,
    internalLinks, externalLinks,
  }
}

/** File-safe Session id. Keep the DSH resource's Session id itself unchanged. */
export const safeId = (id) => String(id).replace(/[^A-Za-z0-9_.-]/g, '_')

/** Numeric snapshot prefix first; deterministic name order breaks ties. */
export function bySnapshotIndex(a, b) {
  const index = (name) => Number.parseInt(name.split('/').pop(), 10) || 0
  return index(a) - index(b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** Plain text of a LikeC4 description (string or {txt|md}). */
export const textOf = (v) => (v == null ? '' : typeof v === 'string' ? v : v.txt ?? v.md ?? '')

/** Wide characters (CJK, kana, hangul, full-width forms): about 1.7 Latin characters each. */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
/** Punctuation that may not start a line, and punctuation that may not end one. */
const NO_START = /^[，。、：；！？）」』》〉】〕…·,.;:!?)\]}%]/
const NO_END = /[（「『《〈【〔(\[{]$/

/**
 * Width of a short label in "average Latin characters": a wide character
 * counts `wide` (1.7 by default), so pills and chips sized as `cols(s) * k`
 * fit Chinese.
 */
export function cols(s, wide = 1.7) {
  let n = 0
  for (const ch of String(s ?? '')) n += WIDE.test(ch) ? wide : 1
  return n
}

/**
 * Units a line may break between: words separated by spaces, and each wide
 * character on its own, since Chinese and Japanese break between characters
 * without spaces. `space` tells whether a space precedes the unit. Closing
 * punctuation stays with the unit before it, opening punctuation with the
 * unit after it.
 */
function units(text) {
  const out = []
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    let space = true
    let run = ''
    const push = (s) => {
      const prev = out[out.length - 1]
      if (prev && !space && (NO_START.test(s) || NO_END.test(prev.s))) prev.s += s
      else out.push({ s, space })
      space = false
    }
    for (const ch of word) {
      if (!WIDE.test(ch)) {
        run += ch
        continue
      }
      if (run) push(run)
      run = ''
      push(ch)
    }
    if (run) push(run)
  }
  return out
}

/**
 * Greedy wrap, ellipsis on overflow. A wide character counts 2 here: a full
 * line of them would otherwise touch the edges of the box.
 */
export function wrap(text, maxChars, maxLines) {
  const parts = units(text)
  const lines = []
  let line = ''
  let i = 0
  for (; i < parts.length; i++) {
    const { s, space } = parts[i]
    const next = line ? line + (space ? ' ' : '') + s : s
    if (cols(next, 2) > maxChars && line) {
      lines.push(line)
      line = s
      if (lines.length === maxLines) break
    } else line = next
  }
  if (lines.length < maxLines && line) {
    lines.push(line)
    i = parts.length
  }
  if (i < parts.length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/.?$/, '…')
  return lines
}

/** Cubic path through LikeC4's B-spline points. */
export function edgePath(points) {
  if (!points || points.length === 0) return ''
  let d = `M${points[0][0]},${points[0][1]}`
  let i = 1
  for (; i + 2 <= points.length - 1; i += 3) d += ` C${points[i][0]},${points[i][1]} ${points[i + 1][0]},${points[i + 1][1]} ${points[i + 2][0]},${points[i + 2][1]}`
  for (; i < points.length; i++) d += ` L${points[i][0]},${points[i][1]}`
  return d
}

/** Dynamic step ids encode causal stages; parallel branches share a number. */
export function stepLabel(edgeId, index) {
  const match = /^step-(\d+)(?::par\.(\d+))?$/.exec(String(edgeId ?? ''))
  if (!match || Number(match[1]) < 1 || (match[2] && Number(match[2]) < 1)) return String(index + 1)
  let branch = Number(match[2] ?? 0)
  let suffix = ''
  while (branch > 0) {
    branch--
    suffix = String.fromCharCode(97 + branch % 26) + suffix
    branch = Math.floor(branch / 26)
  }
  return String(Number(match[1])) + suffix
}

/** Accent of a group that can be unfolded or zoomed into (not a state hue). */
export const GROUP_COLOR = '#14b8a6'
