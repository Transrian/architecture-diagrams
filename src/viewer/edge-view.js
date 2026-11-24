import * as React from 'react'
import { activate } from './node-marks.js'
const h = React.createElement
import { V, STATES, STATE_COLOR, relationStyle, relationAssumed, relationLabel, relationLabelBox } from './theme.js'
import { edgePath, cols } from '../core/shared.js'

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
  return h(
    'g',
    { className: 'dshd-edge', onClick: activate(onSelect, edge) },
    h('path', { d, style: { fill: 'none', stroke: 'transparent', strokeWidth: 16 } }),
    state === 'doing'
      ? h('path', {
          d,
          'aria-hidden': true,
          style: { fill: 'none', stroke: color, strokeWidth: meaning.width + 5, opacity: 0.2, strokeDasharray: meaning.pattern },
        })
      : null,
    h('path', {
      d,
      className: 'dshd-edge-line' + (state === 'doing' ? ' dshd-edge-run' : ''),
      markerEnd: `url(#${marker})`,
      style: { fill: 'none', stroke: color, strokeWidth: meaning.width, '--dshd-edge-pattern': meaning.pattern },
    }),
    label && bb
      ? h(
          'g',
          null,
          h('rect', {
            x: bb.x - 6,
            y: bb.y - 3,
            width: Math.max(bb.width, cols(label) * 10.5) + 12,
            height: Math.max(bb.height, 24) + 6,
            rx: 5,
            style: { fill: V('bg-base'), opacity: 0.9 },
          }),
          h(
            'text',
            {
              x: bb.x,
              y: bb.y + Math.max(bb.height, 24) * 0.78,
              style: { fontSize: 20, fill: V('label-primary'), fontStyle: merged || assumed ? 'italic' : undefined },
            },
            label,
          ),
        )
      : null,
  )
}

export function Markers() {
  const markers = []
  for (const [state, color] of [['default', V('label-secondary')], ...STATES]) {
    for (const head of ['full', 'open', 'double']) {
      const id = `dshd-arrow-${head}-${state}`
      markers.push(
        h(
          'marker',
          { key: id, id, viewBox: '0 0 14 12', refX: 13, refY: 6, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' },
          h('path', {
            d: head === 'full' ? 'M1,1 L13,6 L1,11 Z' : head === 'open' ? 'M2,1 L13,6 L2,11' : 'M1,1 L7,6 L1,11 M7,1 L13,6 L7,11',
            style: { fill: head === 'full' ? color : 'none', stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round' },
          }),
        ),
      )
    }
  }
  return h('defs', null, ...markers)
}

/** Small, neutral legend sample uses the same visual vocabulary as edges. */
export function RelationSample({ kind }) {
  const meaning = relationStyle(kind)
  return h(
    'svg',
    { width: 38, height: 14, viewBox: '0 0 38 14', 'aria-hidden': true },
    h('path', {
      d: 'M1,7 H27',
      style: { stroke: 'currentColor', strokeWidth: meaning.width, strokeDasharray: meaning.pattern, fill: 'none' },
    }),
    h('path', {
      d: meaning.head === 'double' ? 'M23,2 L29,7 L23,12 M29,2 L35,7 L29,12' : 'M27,2 L35,7 L27,12' + (meaning.head === 'full' ? ' Z' : ''),
      style: { stroke: 'currentColor', strokeWidth: 1.5, fill: meaning.head === 'full' ? 'currentColor' : 'none' },
    }),
  )
}
