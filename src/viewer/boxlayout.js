// Pure layout of a box's header row (icon, kind label, state pill) and of a
// collapsed group's footer. Dependency-free so it is unit-tested without React.
import { STATES, STATE_GLYPH } from './theme.js'
import { cols } from '../core/shared.js'

export const KIND_FONT = 15
export const PILL_H = 28
/** Estimated rendered widths (the checks in the harness measure the real ones). */
const kindWidth = (text) => cols(text) * KIND_FONT * 0.74
const pillWidth = (text, font) => cols(text) * font * 0.62 + 22

/**
 * Header row of a box: icon (or person glyph), kind label, state/mark pill.
 * The pill never covers the icon or the kind label: it first shrinks a
 * little, then the kind label gives way (the shape, icon and details still
 * say the kind), and as a last resort the pill text is shortened with "…".
 * On a cylinder with a pill, the icon and kind move to the left of the lid.
 */
export function headerLayout({ x, y, w, lid, person, icon, kindText, label, lidRy = 18 }) {
  const ICON = 38
  const right = x + w - (lid ? 14 : 10)
  const pillY = lid ? y + Math.max(4, lidRy - PILL_H / 2 + 2) : y + 10
  // Without a pill the header keeps its usual places.
  let iconAt = lid ? { x: x + w / 2 - 15, y: y + 3, size: 30 } : { x: x + 10, y: y + 8, size: ICON }
  let kind = lid
    ? (icon ? null : { x: x + w / 2, y: y + 24, anchor: 'middle' })
    : { x: x + (icon ? 10 + ICON + 9 : person ? 50 : 16), y: y + (icon ? 32 : 28) }
  if (!label) return { icon: iconAt, kind, pill: null }
  if (lid) {
    iconAt = { x: x + 18, y: pillY, size: 28 }
    kind = icon ? null : { x: x + 20, y: pillY + 19 }
  }
  // Where the leading items end: icon, person glyph, then the kind label.
  const lead = lid ? (icon ? iconAt.x + iconAt.size : x + 14) : icon ? x + 10 + ICON : person ? x + 44 : x + 10
  const fits = (start, font) => right - pillWidth(label, font) >= start + 8
  const place = (font, text = label) => ({ x: right - pillWidth(text, font), y: pillY, width: pillWidth(text, font), font, text })
  if (kind && kindText) {
    const kindEnd = (kind.anchor === 'middle' ? kind.x + kindWidth(kindText) / 2 : kind.x + kindWidth(kindText))
    for (const font of [16, 14, 13]) if (fits(kindEnd, font)) return { icon: iconAt, kind, pill: place(font) }
  }
  for (const font of [16, 14, 13, 12, 11]) if (fits(lead, font)) return { icon: iconAt, kind: null, pill: place(font) }
  // Shorten the pill text until it fits after the leading items.
  const chars = [...label]
  for (let n = chars.length - 1; n >= 1; n--) {
    const text = chars.slice(0, n).join('').trimEnd() + '…'
    if (right - pillWidth(text, 11) >= lead + 8) return { icon: iconAt, kind: null, pill: place(11, text) }
  }
  return { icon: iconAt, kind: null, pill: place(11, '…') }
}

export const FOOTER_FONT = 18
export const FOOTER_GAP = 9
/** Inner padding on each side of the clickable `⊕ N` / `↗ N` chip. */
export const FOOTER_CHIP_PAD = 10
export const FOOTER_CHIP_H = 28
export const footerWidth = (text) => cols(text) * FOOTER_FONT * 0.6

/**
 * Footer of a collapsed group, at one fixed size on every card: `⊕ N` (or
 * `↗ N` for a neighbour; drawn as a clickable chip when `chip`), then up to
 * three state chips `glyph count` in their colour, by severity (the
 * vocabulary order: blocked, deviation, waiting… before done), `…` when more
 * states exist, and `?n` for assumed descendants. Chips that do not fit are
 * dropped from the right, so the most severe states are the last to go; the
 * details panel keeps the full breakdown.
 */
export function footerParts(node, width, outside, chip = false) {
  const parts = [{ text: `${outside ? '↗' : '⊕'} ${node.hidden}`, kind: 'count', chip }]
  const byState = node.rollup?.byState ?? {}
  const ranked = STATES.map(([state]) => state).filter((state) => byState[state] > 0)
  const chips = ranked.map((state) => ({ text: STATE_GLYPH[state] + byState[state], kind: 'state', state }))
  const assumed = node.assumedCount > 0 ? { text: '?' + node.assumedCount, kind: 'assumed' } : null
  const partWidth = (part) => footerWidth(part.text) + (part.chip ? FOOTER_CHIP_PAD * 2 : 0)
  const total = (list) => list.reduce((sum, part) => sum + partWidth(part), 0) + FOOTER_GAP * (list.length - 1)
  let shown = Math.min(3, chips.length)
  const build = (n, withAssumed) => [...parts, ...chips.slice(0, n), ...(n < chips.length ? [{ text: '…', kind: 'more' }] : []), ...(withAssumed && assumed ? [assumed] : [])]
  for (; shown >= 0; shown--) if (total(build(shown, true)) <= width) return build(shown, true)
  return total(build(0, false)) <= width ? build(0, false) : parts
}
