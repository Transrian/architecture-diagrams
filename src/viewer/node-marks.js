import * as React from 'react'
const h = React.createElement
import { V, stateLabel } from './theme.js'
import { cols } from '../core/shared.js'
import { changeBadge } from './changes.js'

export function Shape({ node, stroke, fill, dashed, running, strokeWidth, glyph = true }) {
  const { x, y, width: w, height: hgt } = node
  const common = {
    className: 'dshd-shape' + (running ? ' dshd-run' : ''),
    style: { fill, stroke, strokeWidth, strokeDasharray: dashed && !running ? '8 6' : undefined },
  }
  switch (node.shape) {
    case 'storage':
    case 'cylinder': {
      const ry = Math.min(18, hgt / 6)
      return h(
        'g',
        null,
        h('path', {
          ...common,
          d:
            `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} ` +
            `L${x + w},${y + hgt - ry} A${w / 2},${ry} 0 0 1 ${x},${y + hgt - ry} Z`,
        }),
        h('path', { d: `M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`, style: { fill: 'none', stroke, strokeWidth: 2 } }),
      )
    }
    case 'document': {
      const wv = Math.min(14, hgt / 8)
      return h('path', {
        ...common,
        d:
          `M${x},${y} H${x + w} V${y + hgt - wv} ` +
          `C${x + w * 0.75},${y + hgt - 3 * wv} ${x + w * 0.25},${y + hgt + wv} ${x},${y + hgt - wv} Z`,
      })
    }
    case 'person':
      return h(
        'g',
        null,
        h('rect', { ...common, x, y, width: w, height: hgt, rx: 30 }),
        glyph && h('circle', { cx: x + 28, cy: y + 26, r: 8, style: { fill: 'none', stroke, strokeWidth: 2 } }),
        glyph && h('path', { d: `M${x + 14},${y + 50} a14,11 0 0 1 28,0`, style: { fill: 'none', stroke, strokeWidth: 2 } }),
      )
    default:
      return h('rect', { ...common, x, y, width: w, height: hgt, rx: 14 })
  }
}

export function pillText(node, t) {
  if (node.state) return stateLabel(node.state, t) + (node.marks?.length ? ' · ' + node.marks.map((m) => t('mark.' + m)).join(' · ') : '')
  if (node.marks?.length) return node.marks.map((m) => t('mark.' + m)).join(' · ')
  return ''
}

export const activate = (onActivate, node) => (e) => {
  e.stopPropagation()
  onActivate(node, e)
}
/** Double-click: handled boxes stop it; the rest bubbles up to the stage (fit). */
export const dbl = (onOpen, node) => (e) => {
  if (onOpen && onOpen(node)) e.stopPropagation()
}

/**
 * A leaf, or a collapsed group. A collapsed group is drawn as a stack of
 * cards with how many elements it holds. In the group accent when it belongs
 * to the current view (double-click unfolds it, the wheel zooms into it);
 * neutral grey when it is a neighbour drawn around the frame, which belongs
 * to another branch of the diagram (`outside`).
 */
export function Halo({ node, selected, focused, revealed, containsSelection }) {
  const style = { fill: 'none', stroke: V('label-primary'), strokeWidth: 3, pointerEvents: 'none' }
  return h(
    React.Fragment,
    null,
    selected || focused || containsSelection
      ? h('rect', {
          x: node.x - 7,
          y: node.y - 7,
          width: node.width + 14,
          height: node.height + 14,
          rx: 21,
          className: 'dshd-halo' + (containsSelection ? ' dshd-contains-selection' : ''),
          style: { ...style, strokeDasharray: containsSelection ? '7 5' : undefined },
        })
      : null,
    // The reveal pulse runs on the halo itself: one ring, never stacked outlines.
    revealed
      ? h('rect', {
          key: revealed,
          x: node.x - 7,
          y: node.y - 7,
          width: node.width + 14,
          height: node.height + 14,
          rx: 21,
          className: 'dshd-reveal',
          style,
        })
      : null,
  )
}

export function ChangeBadge({ node, change }) {
  const text = changeBadge(node, change)
  if (!text) return null
  const width = cols(text) * 8.5 + 16
  const x = node.x + node.width - width
  const y = node.y - 28
  return h(
    'g',
    { className: 'dshd-change-badge', style: { pointerEvents: 'none' } },
    h('rect', { x, y, width, height: 22, rx: 5, style: { fill: V('bg-base'), stroke: V('label-primary'), strokeWidth: 1.5 } }),
    h(
      'text',
      { x: x + width / 2, y: y + 16, textAnchor: 'middle', style: { fill: V('label-primary'), fontSize: 14, fontWeight: 700 } },
      text,
    ),
  )
}
