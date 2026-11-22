// SVG pieces of a laid-out view: boxes, group frames, edges, arrow markers.
import * as React from 'react'
import { V, STATES, STATE_COLOR, GROUP_COLOR, relationStyle, stateLabel, relationAssumed, relationLabel, relationLabelBox } from './theme.js'
import { textOf, wrap, edgePath, cols } from './shared.js'
import { IconMark, hasIcon } from './iconpack.js'
import { changeBadge } from './changes.js'

const h = React.createElement

function Shape({ node, stroke, fill, dashed, running, strokeWidth, glyph = true }) {
  const { x, y, width: w, height: hgt } = node
  const common = {
    className: 'dshd-shape' + (running ? ' dshd-run' : ''),
    style: { fill, stroke, strokeWidth, strokeDasharray: dashed && !running ? '8 6' : undefined },
  }
  switch (node.shape) {
    case 'storage':
    case 'cylinder': {
      const ry = Math.min(18, hgt / 6)
      return h('g', null,
        h('path', { ...common, d: `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} L${x + w},${y + hgt - ry} A${w / 2},${ry} 0 0 1 ${x},${y + hgt - ry} Z` }),
        h('path', { d: `M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`, style: { fill: 'none', stroke, strokeWidth: 2 } }))
    }
    case 'document': {
      const wv = Math.min(14, hgt / 8)
      return h('path', { ...common, d: `M${x},${y} H${x + w} V${y + hgt - wv} C${x + w * 0.75},${y + hgt - 3 * wv} ${x + w * 0.25},${y + hgt + wv} ${x},${y + hgt - wv} Z` })
    }
    case 'person':
      return h('g', null,
        h('rect', { ...common, x, y, width: w, height: hgt, rx: 30 }),
        glyph && h('circle', { cx: x + 28, cy: y + 26, r: 8, style: { fill: 'none', stroke, strokeWidth: 2 } }),
        glyph && h('path', { d: `M${x + 14},${y + 50} a14,11 0 0 1 28,0`, style: { fill: 'none', stroke, strokeWidth: 2 } }))
    default:
      return h('rect', { ...common, x, y, width: w, height: hgt, rx: 14 })
  }
}

function pillText(node, t) {
  if (node.state) return stateLabel(node.state, t) + (node.marks?.length ? ' · ' + node.marks.map((m) => t('mark.' + m)).join(' · ') : '')
  if (node.marks?.length) return node.marks.map((m) => t('mark.' + m)).join(' · ')
  return ''
}

const activate = (onActivate, node) => (e) => {
  e.stopPropagation()
  onActivate(node, e)
}
/** Double-click: handled boxes stop it; the rest bubbles up to the stage (fit). */
const dbl = (onOpen, node) => (e) => {
  if (onOpen && onOpen(node)) e.stopPropagation()
}

/**
 * A leaf, or a collapsed group. A collapsed group is drawn as a stack of
 * cards with how many elements it holds. In the group accent when it belongs
 * to the current view (double-click unfolds it, the wheel zooms into it);
 * neutral grey when it is a neighbour drawn around the frame, which belongs
 * to another branch of the diagram (`outside`).
 */
function Halo({ node, selected, focused, revealed, containsSelection }) {
  const style = { fill: 'none', stroke: V('label-primary'), strokeWidth: 3, pointerEvents: 'none' }
  return h(React.Fragment, null,
    selected || focused || containsSelection ? h('rect', { x: node.x - 7, y: node.y - 7, width: node.width + 14, height: node.height + 14, rx: 21, className: 'dshd-halo' + (containsSelection ? ' dshd-contains-selection' : ''), style: { ...style, strokeDasharray: containsSelection ? '7 5' : undefined } }) : null,
    revealed ? h('rect', { key: revealed, x: node.x - 13, y: node.y - 13, width: node.width + 26, height: node.height + 26, rx: 25, className: 'dshd-reveal', style }) : null)
}

function ChangeBadge({ node, change }) {
  const text = changeBadge(node, change)
  if (!text) return null
  const width = cols(text) * 8.5 + 16
  const x = node.x + node.width - width
  const y = node.y - 28
  return h('g', { className: 'dshd-change-badge', style: { pointerEvents: 'none' } },
    h('rect', { x, y, width, height: 22, rx: 5, style: { fill: V('bg-base'), stroke: V('label-primary'), strokeWidth: 1.5 } }),
    h('text', { x: x + width / 2, y: y + 16, textAnchor: 'middle', style: { fill: V('label-primary'), fontSize: 14, fontWeight: 700 } }, text))
}

export function NodeView({ node, change, t, onActivate, onOpen, selected, focused, revealed, containsSelection, outside }) {
  const own = node.state
  const roll = node.rollup
  const group = node.hidden > 0
  const accent = group && !outside ? GROUP_COLOR : V('label-secondary')
  const state = own ?? roll?.state
  const color = state ? STATE_COLOR.get(state) : V('label-secondary')
  const fill = own
    ? `color-mix(in srgb, ${color} 14%, ${V('bg-layer-1')})`
    : group ? `color-mix(in srgb, ${outside ? V('bg-layer-2') : GROUP_COLOR} ${outside ? 70 : 9}%, ${V('bg-layer-1')})` : V('bg-layer-1')
  const edge = outside ? `color-mix(in srgb, ${V('label-secondary')} 55%, transparent)` : GROUP_COLOR
  const stroke = own ? color : group ? edge : state ? color : V('border-l2')
  const { x, y, width: w, height: hgt } = node
  const cx = x + w / 2
  const desc = wrap(textOf(node.description), Math.max(12, Math.floor(w / 11)), 2)
  const titleLines = wrap(node.title, Math.max(10, Math.floor(w / 16)), 2)
  const block = titleLines.length * 32 + desc.length * 24
  // Below the kind label, even in a short box.
  // An icon in the header row pushes the text a little lower.
  const iconRow = !!node.icon && node.shape !== 'storage' && node.shape !== 'cylinder'
  let cy = Math.max(y + hgt / 2 - block / 2 + 28, y + (iconRow ? 64 : 58))
  const children = []
  for (const line of titleLines) {
    children.push(h('text', { key: 't' + cy, x: cx, y: cy, textAnchor: 'middle', style: { fontSize: 28, fontWeight: 600, fill: V('label-primary') } }, line))
    cy += 32
  }
  for (const line of desc) {
    children.push(h('text', { key: 'd' + cy, x: cx, y: cy + 2, textAnchor: 'middle', style: { fontSize: 19, fill: V('label-secondary') } }, line))
    cy += 24
  }
  const label = pillText(node, t)
  const pillFont = Math.min(16, (w - 42) / Math.max(cols(label) * 0.6, 1))
  const pillW = cols(label) * pillFont * 0.6 + 22
  const rect = !node.shape || node.shape === 'rectangle'
  const lid = node.shape === 'storage' || node.shape === 'cylinder'
  const person = node.shape === 'person'
  // The icon: on the lid of a cylinder, else before the kind label (in place of a person's glyph).
  const icon = hasIcon(node.icon)
  const ICON = 38
  const iconAt = lid ? { x: x + w / 2 - 15, y: y + 3, size: 30 } : { x: x + 10, y: y + 8, size: ICON }
  const kindX = x + (icon && !lid ? 10 + ICON + 9 : person ? 50 : 16)
  const cards = group && rect
    ? [12, 6].map((d) => h('rect', { key: 'c' + d, x: x + d, y: y + d, width: w, height: hgt, rx: 14, style: { fill: V('bg-layer-1'), stroke: edge, strokeWidth: 2, opacity: d === 12 ? 0.45 : 0.75 } }))
    : []
  // Collapsed group: how many elements are inside, and how many this conversation marks.
  const rollText = roll ? ` · ${t('count.state', { n: roll.byState[roll.state], state: stateLabel(roll.state, t) })}${roll.count > roll.byState[roll.state] ? ` +${roll.count - roll.byState[roll.state]}` : ''}` : ''
  const assumedText = node.assumedCount > 0 ? ` · ?${node.assumedCount}` : ''
  const footer = `${outside ? '↗' : '⊕'} ${node.hidden}${rollText}${assumedText}`
  const footerFont = Math.min(20, (w - 32) / Math.max(cols(footer) * 0.56, 1))
  return h('g', { className: 'dshd-node' + (group ? ' dshd-openable' : ''), 'data-element': node.id, onClick: activate(onActivate, node), onDoubleClick: dbl(onOpen, node) },
    ...cards,
    h(Halo, { node, selected, focused, revealed, containsSelection }),
    h(Shape, { node, stroke, fill, strokeWidth: group ? (outside ? 2.5 : 3.5) : 2.5, dashed: own === 'planned' || own === 'frozen', running: own === 'doing', glyph: !icon }),
    icon ? h(IconMark, { id: node.icon, ...iconAt }) : null,
    // On a cylinder the kind goes on the lid, which the icon takes when there is one (the shape still says "data").
    lid && icon ? null : h('text', { x: lid ? x + w / 2 : kindX, y: y + (lid ? 24 : icon ? 32 : 28), textAnchor: lid ? 'middle' : undefined, style: { fontSize: 15, fill: accent, fontWeight: group ? 700 : 400, letterSpacing: '.04em', textTransform: 'uppercase' } }, t('kind.' + node.kind) ?? node.kind ?? ''),
    label ? h('g', null,
      h('rect', { x: x + w - pillW - 10, y: y + 10, width: pillW, height: 28, rx: 14, style: { fill: own ? color : node.marks?.length ? V('label-secondary') : color } }),
      h('text', { x: x + w - pillW / 2 - 10, y: y + 29, textAnchor: 'middle', style: { fontSize: pillFont, fontWeight: 600, fill: V('bg-base') } }, label)) : null,
    group ? h('text', { x: x + 16, y: y + hgt - 14, style: { fontSize: footerFont, fontWeight: 700 } },
      // ⊕: opens here; ↗: lives elsewhere (double-click flies there).
      h('tspan', { style: { fill: accent } }, `${outside ? '↗' : '⊕'} ${node.hidden}`),
      rollText ? h('tspan', { style: { fill: STATE_COLOR.get(roll.state) } }, rollText) : null,
      assumedText ? h('tspan', { style: { fill: V('label-secondary') } }, assumedText) : null) : null,
    ...children,
    h(ChangeBadge, { node, change }))
}

/**
 * Frame of a group drawn open. A group the user unfolded keeps the accent
 * and a "fold" chip in its corner; double-clicking its empty space folds it
 * back (nested frames and boxes catch their own double-clicks first).
 */
export function GroupView({ node, change, onActivate, onOpen, onFold, selected, focused, revealed, containsSelection, t }) {
  const state = node.state
  const unfolded = !!node.expanded
  const color = state ? STATE_COLOR.get(state) : unfolded ? GROUP_COLOR : V('border-l2')
  const { x, y, width: w, height: hgt } = node
  const chip = unfolded ? '− ' + t('fold') : ''
  const chipW = cols(chip) * 11 + 22
  const assumed = node.marks?.includes('assumed') ? t('mark.assumed') : ''
  const assumedW = cols(assumed) * 8.4 + 20
  const assumedX = x + w - assumedW - (unfolded && onFold ? chipW + 20 : 10)
  return h('g', { className: 'dshd-node', 'data-element': node.id, onClick: activate(onActivate, node), onDoubleClick: dbl(onOpen, node) },
    h(Halo, { node, selected, focused, revealed, containsSelection }),
    h('rect', {
      x, y, width: w, height: hgt, rx: 16, className: 'dshd-shape',
      style: {
        fill: unfolded ? `color-mix(in srgb, ${GROUP_COLOR} 6%, transparent)` : `color-mix(in srgb, ${V('bg-layer-2')} 55%, transparent)`,
        stroke: color, strokeWidth: unfolded ? 3 : 2, strokeDasharray: '10 6',
      },
    }),
    hasIcon(node.icon) ? h(IconMark, { id: node.icon, x: x + 12, y: y + 7, size: 32 }) : null,
    h('text', { x: x + (hasIcon(node.icon) ? 54 : 16), y: y + 31, style: { fontSize: 22, fontWeight: 700, fill: unfolded ? GROUP_COLOR : V('label-secondary'), letterSpacing: '.03em' } },
      (node.title ?? '').toUpperCase() + (state ? `  · ${stateLabel(state, t)}` : '')),
    assumed ? h('g', { className: 'dshd-assumed' },
      h('rect', { x: assumedX, y: y + 9, width: assumedW, height: 28, rx: 14, style: { fill: V('label-secondary') } }),
      h('text', { x: assumedX + assumedW / 2, y: y + 29, textAnchor: 'middle', style: { fontSize: 14, fontWeight: 600, fill: V('bg-base') } }, assumed)) : null,
    unfolded && onFold ? h('g', {
      className: 'dshd-chip',
      onClick: (e) => {
        e.stopPropagation()
        onFold(node)
      },
      onDoubleClick: (e) => e.stopPropagation(),
    },
    h('rect', { x: x + w - chipW - 10, y: y + 8, width: chipW, height: 30, rx: 15, style: { fill: GROUP_COLOR } }),
    h('text', { x: x + w - chipW / 2 - 10, y: y + 29, textAnchor: 'middle', style: { fontSize: 18, fontWeight: 700, fill: '#fff' } }, chip)) : null,
    h(ChangeBadge, { node, change }))
}

export function EdgeView({ edge, index, dynamic, t, onSelect }) {
  const state = edge.state
  const color = state ? STATE_COLOR.get(state) : V('label-secondary')
  const merged = edge.count > 1
  const assumed = relationAssumed(edge)
  const label = relationLabel(edge, index, dynamic, t)
  const bb = relationLabelBox(edge)
  const meaning = relationStyle(edge.kind)
  const marker = `dshd-arrow-${meaning.head}-${state ?? 'default'}`
  const d = edgePath(edge.points)
  return h('g', { className: 'dshd-edge', onClick: activate(onSelect, edge) },
    h('path', { d, style: { fill: 'none', stroke: 'transparent', strokeWidth: 16 } }),
    state === 'doing' ? h('path', { d, 'aria-hidden': true, style: { fill: 'none', stroke: color, strokeWidth: meaning.width + 5, opacity: 0.2, strokeDasharray: meaning.pattern } }) : null,
    h('path', {
      d,
      className: 'dshd-edge-line' + (state === 'doing' ? ' dshd-edge-run' : ''),
      markerEnd: `url(#${marker})`,
      style: { fill: 'none', stroke: color, strokeWidth: meaning.width, '--dshd-edge-pattern': meaning.pattern },
    }),
    label && bb ? h('g', null,
      h('rect', { x: bb.x - 6, y: bb.y - 3, width: Math.max(bb.width, cols(label) * 10.5) + 12, height: Math.max(bb.height, 24) + 6, rx: 5, style: { fill: V('bg-base'), opacity: 0.9 } }),
      h('text', { x: bb.x, y: bb.y + Math.max(bb.height, 24) * 0.78, style: { fontSize: 20, fill: V('label-primary'), fontStyle: merged || assumed ? 'italic' : undefined } }, label)) : null)
}

export function Markers() {
  const markers = []
  for (const [state, color] of [['default', V('label-secondary')], ...STATES]) {
    for (const head of ['full', 'open', 'double']) {
      const id = `dshd-arrow-${head}-${state}`
      markers.push(h('marker', { key: id, id, viewBox: '0 0 14 12', refX: 13, refY: 6, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' },
        h('path', { d: head === 'full' ? 'M1,1 L13,6 L1,11 Z' : head === 'open' ? 'M2,1 L13,6 L2,11' : 'M1,1 L7,6 L1,11 M7,1 L13,6 L7,11', style: { fill: head === 'full' ? color : 'none', stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round' } })))
    }
  }
  return h('defs', null, ...markers)
}

/** Small, neutral legend sample uses the same visual vocabulary as edges. */
export function RelationSample({ kind }) {
  const meaning = relationStyle(kind)
  return h('svg', { width: 38, height: 14, viewBox: '0 0 38 14', 'aria-hidden': true },
    h('path', { d: 'M1,7 H27', style: { stroke: 'currentColor', strokeWidth: meaning.width, strokeDasharray: meaning.pattern, fill: 'none' } }),
    h('path', { d: meaning.head === 'double' ? 'M23,2 L29,7 L23,12 M29,2 L35,7 L29,12' : 'M27,2 L35,7 L27,12' + (meaning.head === 'full' ? ' Z' : ''), style: { stroke: 'currentColor', strokeWidth: 1.5, fill: meaning.head === 'full' ? 'currentColor' : 'none' } }))
}
