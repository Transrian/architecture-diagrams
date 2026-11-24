import * as React from 'react'
const h = React.createElement
import { V, STATE_COLOR, GROUP_COLOR, stateLabel } from './theme.js'
import { cols } from '../core/shared.js'
import { IconMark, hasIcon } from './iconpack.js'
import { activate, dbl, Halo, ChangeBadge } from './node-marks.js'

/**
 * Frame of a group drawn open. A group the user unfolded keeps the accent
 * and a "fold" chip in its corner; double-clicking its empty space folds it
 * back (nested frames and boxes catch their own double-clicks first).
 */
export function GroupView({ node, change, onActivate, onOpen, onFold, onChip, chip, selected, focused, revealed, containsSelection, t }) {
  const state = node.state
  const unfolded = !!node.expanded
  const color = state ? STATE_COLOR.get(state) : unfolded ? GROUP_COLOR : V('border-l2')
  const { x, y, width: w, height: hgt } = node
  const action = unfolded && onFold ? 'fold' : chip === 'fly' && onChip ? 'fly' : null
  const chipText = action === 'fold' ? '⊖ ' + t('fold') : action === 'fly' ? t('goto') + ' ↗' : ''
  const chipW = cols(chipText) * 11 + 22
  const assumed = node.marks?.includes('assumed') ? t('mark.assumed') : ''
  const assumedW = cols(assumed) * 8.4 + 20
  const assumedX = x + w - assumedW - (action ? chipW + 20 : 10)
  return h(
    'g',
    { className: 'archd-node', 'data-element': node.id, onClick: activate(onActivate, node), onDoubleClick: dbl(onOpen, node) },
    h(Halo, { node, selected, focused, revealed, containsSelection }),
    h('rect', {
      x,
      y,
      width: w,
      height: hgt,
      rx: 16,
      className: 'archd-shape',
      style: {
        fill: unfolded ? `color-mix(in srgb, ${GROUP_COLOR} 6%, transparent)` : `color-mix(in srgb, ${V('bg-layer-2')} 55%, transparent)`,
        stroke: color,
        strokeWidth: unfolded ? 3 : 2,
        strokeDasharray: '10 6',
      },
    }),
    hasIcon(node.icon) ? h(IconMark, { id: node.icon, x: x + 12, y: y + 7, size: 32 }) : null,
    h(
      'text',
      {
        x: x + (hasIcon(node.icon) ? 54 : 16),
        y: y + 31,
        style: { fontSize: 22, fontWeight: 700, fill: unfolded ? GROUP_COLOR : V('label-secondary'), letterSpacing: '.03em' },
      },
      (node.title ?? '').toUpperCase() + (state ? `  · ${stateLabel(state, t)}` : ''),
    ),
    groupChips({ node, x, y, w, action, chipText, chipW, assumed, assumedW, assumedX, onFold, onChip }),
    h(ChangeBadge, { node, change }),
  )
}


function groupChips({ node, x, y, w, action, chipText, chipW, assumed, assumedW, assumedX, onFold, onChip }) {
  return h(React.Fragment, null,
    assumed
      ? h(
          'g',
          { className: 'archd-assumed' },
          h('rect', { x: assumedX, y: y + 9, width: assumedW, height: 28, rx: 14, style: { fill: V('label-secondary') } }),
          h(
            'text',
            { x: assumedX + assumedW / 2, y: y + 29, textAnchor: 'middle', style: { fontSize: 14, fontWeight: 600, fill: V('bg-base') } },
            assumed,
          ),
        )
      : null,
    action
      ? h(
          'g',
          {
            className: 'archd-chip' + (action === 'fly' ? ' archd-count-chip' : ''),
            'data-chip': action,
            onClick: (e) => {
              e.stopPropagation()
              if (action === 'fold') onFold(node)
              else onChip(node)
            },
            onDoubleClick: (e) => e.stopPropagation(),
          },
          h('rect', {
            x: x + w - chipW - 10,
            y: y + 8,
            width: chipW,
            height: 30,
            rx: 15,
            style: { fill: action === 'fly' ? V('label-secondary') : GROUP_COLOR },
          }),
          h(
            'text',
            { x: x + w - chipW / 2 - 10, y: y + 29, textAnchor: 'middle', style: { fontSize: 18, fontWeight: 700, fill: '#fff' } },
            chipText,
          ),
        )
      : null
  )
}
