import { textMeasure } from './text-metrics.js'
import * as React from 'react'
import { V } from './theme.js'
const h = React.createElement
const MIN_COMPRESSION = 0.85

/** Graphviz reserves 14px text; its '[...]' box cannot fit a translated count. */
export function EdgeLabel({ label, box, italic, natural }) {
  const ref = React.useRef(null)
  const lines = label.split('\n')
  const rowHeight = box.height / lines.length
  const fontSize = Math.min(14, rowHeight * 0.8)
  const [layout, setLayout] = React.useState({ rows: lines.map((text) => ({ text })), width: box.width, truncated: false })
  React.useLayoutEffect(() => {
    const elements = [...ref.current.querySelectorAll('tspan')]
    let width = box.width
    const rows = lines.map((value, i) => {
      const element = elements[i] ?? elements[0]
      const measure = textMeasure(element)
      let text = value
      let length = measure(text)
      if (natural) width = Math.max(width, length + 4)
      else if (length * MIN_COMPRESSION > box.width) {
        const chars = [...text]
        let low = 0, high = chars.length
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          if (measure(chars.slice(0, middle).join('').trimEnd() + '…') * MIN_COMPRESSION <= box.width) low = middle
          else high = middle - 1
        }
        text = chars.slice(0, low).join('').trimEnd() + '…'
        length = measure(text)
        if (length * MIN_COMPRESSION > box.width) text = ''
      }
      return { text, length: !natural && length > box.width && text ? box.width : undefined }
    })
    setLayout({ rows, width, truncated: rows.some((row, i) => row.text !== lines[i]) })
  }, [label, box.width, fontSize, italic, natural])
  const centre = box.x + box.width / 2
  return h('g', { className: 'archd-edge-label' },
    layout.truncated ? h('title', null, label) : null,
    h('rect', { x: centre - layout.width / 2, y: box.y, width: layout.width, height: box.height,
      rx: 3, style: { fill: V('bg-base'), opacity: 0.9 } }),
    h('text', { ref, textAnchor: 'middle', 'aria-label': label,
      style: { fontSize, fill: V('label-primary'), fontStyle: italic ? 'italic' : undefined } },
      ...layout.rows.map((line, i) => h('tspan', {
        key: i, x: centre, y: box.y + rowHeight * (i + 0.5) + fontSize * 0.35,
        textLength: line.length, lengthAdjust: line.length ? 'spacingAndGlyphs' : undefined,
      }, line.text)),
    ),
  )
}
