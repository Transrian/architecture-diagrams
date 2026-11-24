import * as React from 'react'
import { activate } from './node-marks.js'
const h = React.createElement
import { V, STATES, STATE_COLOR, relationStyle, relationAssumed, relationLabel, relationLabelBox } from './theme.js'
import { EdgeLabel } from './edge-label.js'
import { edgePath } from '../core/shared.js'

export function EdgeView({ edge, index, dynamic, t, onSelect, selected }) {
  const state = edge.state
  const color = state ? STATE_COLOR.get(state) : V('label-secondary')
  const merged = edge.count > 1
  const assumed = relationAssumed(edge)
  const label = relationLabel(edge, index, dynamic, t)
  const bb = relationLabelBox(edge)
  const meaning = relationStyle(edge.kind)
  const marker = `archd-arrow-${meaning.head}-${state ?? 'default'}`
  const d = edgePath(edge.points)
  return h(
    'g',
    { className: 'archd-edge', onClick: activate(onSelect, edge) },
    h('path', { d, style: { fill: 'none', stroke: 'transparent', strokeWidth: 16 } }),
    selected ? h('path', {
      d, className: 'archd-edge-halo', 'aria-hidden': true,
      style: { fill: 'none', stroke: V('label-primary'), strokeWidth: meaning.width + 6,
        strokeLinecap: 'round', strokeLinejoin: 'round', pointerEvents: 'none' },
    }) : null,
    state === 'doing'
      ? h('path', {
          d,
          'aria-hidden': true,
          style: { fill: 'none', stroke: color, strokeWidth: meaning.width + 5, opacity: 0.2, strokeDasharray: meaning.pattern },
        })
      : null,
    h('path', {
      d,
      className: 'archd-edge-line' + (state === 'doing' ? ' archd-edge-run' : ''),
      markerEnd: `url(#${marker})`,
      style: { fill: 'none', stroke: color, strokeWidth: meaning.width, '--archd-edge-pattern': meaning.pattern },
    }),
    label && bb ? h(EdgeLabel, { label, box: bb, italic: merged || assumed, natural: merged }) : null,
  )
}

export function Markers() {
  const markers = []
  for (const [state, color] of [['default', V('label-secondary')], ...STATES]) {
    for (const head of ['full', 'open', 'double']) {
      const id = `archd-arrow-${head}-${state}`
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
