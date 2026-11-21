// Export of the view on screen as a PNG image: the stage SVG with its
// theme resolved (CSS variables and classes do not follow an SVG out of the
// page), a title line and the legend of the states shown, rasterized at a
// sharp scale and downloaded.

const NS = 'http://www.w3.org/2000/svg'
const HEADER = 40
const FOOTER = 30
const PAD = 14

// Presentation properties the stylesheet or the theme may set.
const PROPS = ['fill', 'stroke', 'stop-color', 'stop-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'visibility', 'display']
const COLORS = new Set(['fill', 'stroke', 'stop-color'])

let probe = null
const known = new Map()
/** Any CSS colour as rgb()/rgba(), so the file reads the same in every viewer. */
function rgb(c) {
  if (!c || c === 'none' || c.startsWith('url(') || /^rgba?\(/.test(c)) return c
  let out = known.get(c)
  if (out) return out
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  probe.canvas.width = probe.canvas.height = 1
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = c
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  out = a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`
  known.set(c, out)
  return out
}

/** Copy of `svg` with every computed presentation property inlined; UI-only parts dropped. */
function standalone(svg) {
  const copy = svg.cloneNode(true)
  const walk = (src, dst) => {
    if (src.nodeType !== 1) return
    const cs = getComputedStyle(src)
    const style = []
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p)
      if (v) style.push(`${p}:${COLORS.has(p) ? rgb(v) : v}`)
    }
    dst.setAttribute('style', style.join(';'))
    dst.removeAttribute('class')
    if (src.tagName === 'text' && cs.textTransform === 'uppercase') {
      for (const n of dst.childNodes) if (n.nodeType === 3) n.nodeValue = n.nodeValue.toUpperCase()
    }
    const a = src.children
    const b = dst.children
    for (let i = 0; i < a.length; i++) walk(a[i], b[i])
  }
  walk(svg, copy)
  // The fold chips are controls, not content.
  const chips = [...svg.querySelectorAll('.dshd-chip')].map((el) => pathTo(svg, el))
  for (const path of chips.reverse()) nodeAt(copy, path)?.remove()
  return copy
}
const pathTo = (root, el) => {
  const path = []
  for (let n = el; n && n !== root; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n))
  return path
}
const nodeAt = (root, path) => path.reduce((n, i) => n?.children[i], root)

const el = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  if (text !== undefined) e.textContent = text
  return e
}

/**
 * The image: title line, the view as on screen, the legend of its states.
 * @param {SVGSVGElement} svg - the stage SVG
 * @param {{title: string, stamp: string, legend: {label: string, color: string, dashed?: boolean}[]}} meta
 */
export function composeSvg(svg, meta) {
  const root = svg.closest('.dshd-root') ?? svg
  const rs = getComputedStyle(root)
  const font = rs.fontFamily
  const fg = rgb(rs.color)
  const bgRaw = rs.backgroundColor
  const bg = !bgRaw || bgRaw === 'transparent' || /,\s*0\)$/.test(bgRaw) ? 'rgb(255,255,255)' : rgb(bgRaw)
  const muted = rgb(getComputedStyle(root.querySelector('.dshd-legend') ?? root).color)
  const line = rgb(getComputedStyle(root.querySelector('.dshd-bar') ?? root).borderBottomColor)
  // Crop to what is drawn inside the stage, with a margin.
  const box = svg.getBoundingClientRect()
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const g of svg.querySelectorAll(':scope > g')) {
    const r = g.getBoundingClientRect()
    if (!r.width && !r.height) continue
    x0 = Math.min(x0, r.left - box.left); y0 = Math.min(y0, r.top - box.top)
    x1 = Math.max(x1, r.right - box.left); y1 = Math.max(y1, r.bottom - box.top)
  }
  const M = 16
  const crop = x0 < x1
    ? { x: Math.max(0, x0 - M), y: Math.max(0, y0 - M), x2: Math.min(box.width, x1 + M), y2: Math.min(box.height, y1 + M) }
    : { x: 0, y: 0, x2: box.width, y2: box.height }
  const minW = 360 // room for the title line
  if (crop.x2 - crop.x < minW) {
    const grow = (minW - (crop.x2 - crop.x)) / 2
    crop.x = Math.max(0, crop.x - grow); crop.x2 = Math.min(box.width, crop.x2 + grow)
  }
  const w = Math.round(crop.x2 - crop.x)
  const hgt = Math.round(crop.y2 - crop.y)
  const footer = meta.legend.length ? FOOTER : 0
  const H = HEADER + hgt + footer
  const out = el('svg', { xmlns: NS, width: w, height: H, viewBox: `0 0 ${w} ${H}`, 'font-family': font })
  out.appendChild(el('rect', { x: 0, y: 0, width: w, height: H, fill: bg }))
  // Title (left) and date or version (right).
  out.appendChild(el('text', { x: PAD, y: 25, 'font-size': 15, 'font-weight': 600, fill: fg }, meta.title))
  out.appendChild(el('text', { x: w - PAD, y: 25, 'font-size': 12, fill: muted, 'text-anchor': 'end' }, meta.stamp))
  out.appendChild(el('line', { x1: 0, y1: HEADER - 0.5, x2: w, y2: HEADER - 0.5, stroke: line }))
  const view = standalone(svg)
  view.setAttribute('x', 0)
  view.setAttribute('y', HEADER)
  view.setAttribute('width', w)
  view.setAttribute('height', hgt)
  view.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.x2 - crop.x} ${crop.y2 - crop.y}`)
  view.setAttribute('overflow', 'hidden')
  out.appendChild(view)
  if (footer) {
    const y = HEADER + hgt
    out.appendChild(el('line', { x1: 0, y1: y + 0.5, x2: w, y2: y + 0.5, stroke: line }))
    const meter = document.createElement('canvas').getContext('2d')
    meter.font = `11px ${font}`
    let x = PAD
    for (const s of meta.legend) {
      const c = rgb(s.color)
      out.appendChild(el('rect', { x, y: y + 10, width: 10, height: 10, rx: 3, fill: c, 'fill-opacity': 0.25, stroke: c, 'stroke-width': 1.5, ...(s.dashed ? { 'stroke-dasharray': '2 1.5' } : {}) }))
      out.appendChild(el('text', { x: x + 15, y: y + 19, 'font-size': 11, fill: muted }, s.label))
      x += 15 + meter.measureText(s.label).width + 14
    }
  }
  return { svg: out, width: w, height: H }
}

/** Renders the composed SVG to a PNG blob, at least ~2000 px on the long side. */
export async function toPng({ svg, width, height }) {
  const text = new XMLSerializer().serializeToString(svg)
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('SVG rendering failed'))
      img.src = url
    })
    const scale = Math.max(2, Math.min(4, 2000 / Math.max(width, height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** File name: diagram-<title>-<yyyymmdd-hhmm>.<extension> */
export function fileName(title, date = new Date(), extension = 'png') {
  const slug = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'vue'
  const p = (n) => String(n).padStart(2, '0')
  return `diagram-${slug}-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.${extension}`
}
