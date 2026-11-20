// SVG pieces of a laid-out view: boxes, group frames, edges, arrow markers.
import * as React from 'react'
import { V, STATES, STATE_COLOR, GROUP_COLOR } from './theme.js'
import { textOf, wrap, edgePath, cols } from './shared.js'

const h = React.createElement

function Shape({ node, stroke, fill, dashed, running, strokeWidth }) {
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
        h('circle', { cx: x + 28, cy: y + 26, r: 8, style: { fill: 'none', stroke, strokeWidth: 2 } }),
        h('path', { d: `M${x + 14},${y + 50} a14,11 0 0 1 28,0`, style: { fill: 'none', stroke, strokeWidth: 2 } }))
    default:
      return h('rect', { ...common, x, y, width: w, height: hgt, rx: 14 })
  }
}

function pillText(node, t) {
  if (node.state) return t('state.' + node.state) + (node.marks?.length ? ' · ' + node.marks.map((m) => t('mark.' + m)).join(' · ') : '')
  if (node.marks?.length) return node.marks.map((m) => t('mark.' + m)).join(' · ')
  return ''
}

const activate = (onActivate, node) => (e) => {
  e.stopPropagation()
  onActivate(node)
}

/**
 * A leaf, or a collapsed group. A collapsed group is drawn as a stack of
 * cards in the group accent, with how many elements it holds: it is the box
 * you click to unfold, or zoom into.
 */
export function NodeView({ node, t, onActivate, selected }) {
  const own = node.state
  const roll = node.rollup
  const group = node.hidden > 0
  const state = own ?? roll?.state
  const color = state ? STATE_COLOR.get(state) : V('label-secondary')
  const fill = own
    ? `color-mix(in srgb, ${color} 14%, ${V('bg-layer-1')})`
    : group ? `color-mix(in srgb, ${GROUP_COLOR} 9%, ${V('bg-layer-1')})` : V('bg-layer-1')
  const stroke = selected ? V('label-primary') : own ? color : group ? GROUP_COLOR : state ? color : V('border-l2')
  const { x, y, width: w, height: hgt } = node
  const cx = x + w / 2
  const desc = wrap(textOf(node.description), Math.max(12, Math.floor(w / 11)), 2)
  const titleLines = wrap(node.title, Math.max(10, Math.floor(w / 16)), 2)
  const block = titleLines.length * 32 + desc.length * 24
  // Below the kind label, even in a short box.
  let cy = Math.max(y + hgt / 2 - block / 2 + 28, y + 58)
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
  const pillW = cols(label) * 9.5 + 22
  const rect = !node.shape || node.shape === 'rectangle'
  const cards = group && rect
    ? [12, 6].map((d) => h('rect', { key: 'c' + d, x: x + d, y: y + d, width: w, height: hgt, rx: 14, style: { fill: V('bg-layer-1'), stroke: GROUP_COLOR, strokeWidth: 2, opacity: d === 12 ? 0.45 : 0.75 } }))
    : []
  // Collapsed group: how many elements are inside, and how many this conversation marks.
  const rollText = roll ? ` · ${t('count.state', { n: roll.byState[roll.state], state: t('state.' + roll.state) })}${roll.count > roll.byState[roll.state] ? ` +${roll.count - roll.byState[roll.state]}` : ''}` : ''
  return h('g', { className: 'dshd-node' + (group ? ' dshd-openable' : ''), onClick: activate(onActivate, node) },
    ...cards,
    h(Shape, { node, stroke, fill, strokeWidth: group ? 3.5 : 2.5, dashed: own === 'planned' || own === 'frozen', running: own === 'doing' }),
    h('text', { x: x + (node.shape === 'person' ? 50 : 16), y: y + (node.shape === 'storage' || node.shape === 'cylinder' ? 54 : 28), style: { fontSize: 15, fill: group ? GROUP_COLOR : V('label-secondary'), fontWeight: group ? 700 : 400, letterSpacing: '.04em', textTransform: 'uppercase' } }, t('kind.' + node.kind) ?? node.kind ?? ''),
    label ? h('g', null,
      h('rect', { x: x + w - pillW - 10, y: y + 10, width: pillW, height: 28, rx: 14, style: { fill: own ? color : node.marks?.length ? V('label-secondary') : color } }),
      h('text', { x: x + w - pillW / 2 - 10, y: y + 29, textAnchor: 'middle', style: { fontSize: 16, fontWeight: 600, fill: V('bg-base') } }, label)) : null,
    group ? h('text', { x: x + 16, y: y + hgt - 14, style: { fontSize: 20, fontWeight: 700 } },
      h('tspan', { style: { fill: GROUP_COLOR } }, `⊕ ${node.hidden}`),
      rollText ? h('tspan', { style: { fill: STATE_COLOR.get(roll.state) } }, rollText) : null) : null,
    ...children)
}

/**
 * Frame of a group drawn open. A group the user unfolded keeps the accent
 * and a "fold" chip in its corner.
 */
export function GroupView({ node, onActivate, onFold, selected, t }) {
  const state = node.state
  const unfolded = !!node.expanded
  const color = state ? STATE_COLOR.get(state) : unfolded ? GROUP_COLOR : V('border-l2')
  const { x, y, width: w, height: hgt } = node
  const chip = unfolded ? '− ' + t('fold') : ''
  const chipW = cols(chip) * 11 + 22
  return h('g', { className: 'dshd-node', onClick: activate(onActivate, node) },
    h('rect', {
      x, y, width: w, height: hgt, rx: 16, className: 'dshd-shape',
      style: {
        fill: unfolded ? `color-mix(in srgb, ${GROUP_COLOR} 6%, transparent)` : `color-mix(in srgb, ${V('bg-layer-2')} 55%, transparent)`,
        stroke: selected ? V('label-primary') : color, strokeWidth: unfolded ? 3 : 2, strokeDasharray: '10 6',
      },
    }),
    h('text', { x: x + 16, y: y + 30, style: { fontSize: 22, fontWeight: 700, fill: unfolded ? GROUP_COLOR : V('label-secondary'), letterSpacing: '.03em' } },
      (node.title ?? '').toUpperCase() + (state ? `  · ${t('state.' + state)}` : '')),
    unfolded && onFold ? h('g', {
      className: 'dshd-chip',
      onClick: (e) => {
        e.stopPropagation()
        onFold(node)
      },
    },
    h('rect', { x: x + w - chipW - 10, y: y + 8, width: chipW, height: 30, rx: 15, style: { fill: GROUP_COLOR } }),
    h('text', { x: x + w - chipW / 2 - 10, y: y + 29, textAnchor: 'middle', style: { fontSize: 18, fontWeight: 700, fill: '#fff' } }, chip)) : null)
}

export function EdgeView({ edge, index, dynamic, t, onSelect }) {
  const state = edge.state
  const color = state ? STATE_COLOR.get(state) : V('label-secondary')
  const merged = edge.count > 1
  const base = merged ? t('count.links', { n: edge.count }) : edge.label ?? ''
  const label = dynamic ? `${index + 1}. ${base}` : base
  const bb = edge.labelBBox
  const marker = state ? `dshd-arrow-${state}` : 'dshd-arrow'
  const d = edgePath(edge.points)
  return h('g', { className: 'dshd-edge', onClick: activate(onSelect, edge) },
    h('path', { d, style: { fill: 'none', stroke: 'transparent', strokeWidth: 16 } }),
    h('path', {
      d,
      className: state === 'doing' ? 'dshd-run' : undefined,
      markerEnd: edge.head === 'none' ? undefined : `url(#${marker})`,
      style: { fill: 'none', stroke: color, strokeWidth: 2.5, strokeDasharray: state === 'doing' ? undefined : edge.line === 'dotted' ? '3 6' : undefined },
    }),
    label && bb ? h('g', null,
      h('rect', { x: bb.x - 6, y: bb.y - 3, width: Math.max(bb.width, cols(label) * 10.5) + 12, height: Math.max(bb.height, 24) + 6, rx: 5, style: { fill: V('bg-base'), opacity: 0.9 } }),
      h('text', { x: bb.x, y: bb.y + Math.max(bb.height, 24) * 0.78, style: { fontSize: 20, fill: V('label-primary'), fontStyle: merged ? 'italic' : undefined } }, label)) : null)
}

export function Markers() {
  const one = (id, color) => h('marker', { key: id, id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
    h('path', { d: 'M0,0 L10,5 L0,10 z', style: { fill: color } }))
  return h('defs', null, one('dshd-arrow', V('label-secondary')), ...STATES.map(([name, color]) => one(`dshd-arrow-${name}`, color)))
}
