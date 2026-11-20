// Pure helpers shared by the browser client (src/) and the engine (build/entry.mjs).

/** Plain text of a LikeC4 description (string or {txt|md}). */
export const textOf = (v) => (v == null ? '' : typeof v === 'string' ? v : v.txt ?? v.md ?? '')

/**
 * Width of a short label in "average Latin characters": wide (CJK, full-width)
 * characters count 1.7, so pills and chips sized as `cols(s) * k` fit Chinese.
 */
export function cols(s) {
  let n = 0
  for (const ch of String(s ?? '')) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 1.7 : 1
  return n
}

/** Greedy word wrap, ellipsis on overflow. */
export function wrap(text, maxChars, maxLines) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines = []
  let line = ''
  let i = 0
  for (; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (next.length > maxChars && line) {
      lines.push(line)
      line = words[i]
      if (lines.length === maxLines) break
    } else line = next
  }
  if (lines.length < maxLines && line) {
    lines.push(line)
    i = words.length
  }
  if (i < words.length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/.?$/, '…')
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

/** Accent of a group that can be unfolded or zoomed into (not a state hue). */
export const GROUP_COLOR = '#14b8a6'
