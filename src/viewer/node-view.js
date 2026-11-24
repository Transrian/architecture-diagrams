import * as React from 'react'
const h = React.createElement
import { V, STATE_COLOR, GROUP_COLOR } from './theme.js'
import { FittedText } from './fitted-text.js'
import { IconMark, hasIcon } from './iconpack.js'
import { Shape, pillText, activate, dbl, Halo, ChangeBadge } from './node-marks.js'
import {
  headerLayout,
  labelLayout,
  footerParts,
  footerWidth,
  KIND_FONT,
  PILL_H,
  FOOTER_FONT,
  FOOTER_GAP,
  FOOTER_CHIP_PAD,
  FOOTER_CHIP_H,
} from './boxlayout.js'

export function NodeView({ node, change, t, onActivate, onOpen, onChip, chip, selected, focused, revealed, containsSelection, outside }) {
  const own = node.state
  const roll = node.rollup
  const group = node.hidden > 0
  const accent = group && !outside ? GROUP_COLOR : V('label-secondary')
  const state = own ?? roll?.state
  const color = state ? STATE_COLOR.get(state) : V('label-secondary')
  const fill = own
    ? `color-mix(in srgb, ${color} 14%, ${V('bg-layer-1')})`
    : group
      ? `color-mix(in srgb, ${outside ? V('bg-layer-2') : GROUP_COLOR} ${outside ? 70 : 9}%, ${V('bg-layer-1')})`
      : V('bg-layer-1')
  const edge = outside ? `color-mix(in srgb, ${V('label-secondary')} 55%, transparent)` : GROUP_COLOR
  const stroke = own ? color : group ? edge : state ? color : V('border-l2')
  const { x, y, width: w, height: hgt } = node
  const children = nodeLabels(node)
  const rect = !node.shape || node.shape === 'rectangle'
  const lid = node.shape === 'storage' || node.shape === 'cylinder'
  const person = node.shape === 'person'
  const icon = hasIcon(node.icon)
  const kindText = t('kind.' + node.kind) ?? node.kind ?? ''
  const head = headerLayout({ x, y, w, lid, person, icon, kindText, label: pillText(node, t), lidRy: Math.min(18, hgt / 6) })
  const cards =
    group && rect
      ? [12, 6].map((d) =>
          h('rect', {
            key: 'c' + d,
            x: x + d,
            y: y + d,
            width: w,
            height: hgt,
            rx: 14,
            style: { fill: V('bg-layer-1'), stroke: edge, strokeWidth: 2, opacity: d === 12 ? 0.45 : 0.75 },
          }),
        )
      : []
  return h(
    'g',
    {
      className: 'archd-node' + (group ? ' archd-openable' : ''),
      'data-element': node.id,
      'aria-label': node.title,
      onClick: activate(onActivate, node),
      onDoubleClick: dbl(onOpen, node),
    },
    ...cards,
    h(Halo, { node, selected, focused, revealed, containsSelection }),
    h(Shape, {
      node,
      stroke,
      fill,
      strokeWidth: group ? (outside ? 2.5 : 3.5) : 2.5,
      dashed: own === 'planned' || own === 'frozen',
      running: own === 'doing',
      glyph: !icon,
    }),
    icon ? h(IconMark, { id: node.icon, ...head.icon }) : null,
    nodeHeader(head, accent, group, own, color, node, kindText),
    group ? h(GroupFooter, { node, x, y: y + hgt - 14, w, accent, outside, t, chip: onChip ? chip : null, onChip }) : null,
    ...children,
    h(ChangeBadge, { node, change }),
  )
}

/**
 * `⊕ N` (or `↗ N`) is a chip when it does something: a click unfolds the
 * group in place, or flies to a neighbour's view. The state chips follow it.
 */
function GroupFooter({ node, x, y, w, accent, outside, t, chip, onChip }) {
  const parts = footerParts(node, w - 32, outside, !!chip)
  const [count, ...rest] = parts
  const countW = footerWidth(count.text) + (chip ? FOOTER_CHIP_PAD * 2 : 0)
  const restX = x + 16 + countW + FOOTER_GAP
  const label = chip ? t(chip === 'unfold' ? 'chip.unfold' : 'chip.goto', { n: node.hidden }) : null
  return h(
    React.Fragment,
    null,
    chip
      ? h(
          'g',
          {
            className: 'archd-chip archd-count-chip',
            'data-chip': chip,
            onClick: (e) => {
              e.stopPropagation()
              onChip(node)
            },
            onDoubleClick: (e) => e.stopPropagation(),
          },
          h('title', null, label),
          h('rect', {
            x: x + 12,
            y: y - FOOTER_CHIP_H + 7,
            width: countW,
            height: FOOTER_CHIP_H,
            rx: FOOTER_CHIP_H / 2,
            style: { fill: outside ? V('label-secondary') : GROUP_COLOR },
          }),
          h(
            'text',
            { x: x + 12 + FOOTER_CHIP_PAD, y, style: { fontSize: FOOTER_FONT, fontWeight: 700, fill: outside ? V('bg-base') : V('group-label') } },
            count.text,
          ),
        )
      : h('text', { className: 'archd-footer', x: x + 16, y, style: { fontSize: FOOTER_FONT, fontWeight: 700, fill: accent } }, count.text),
    rest.length
      ? h(
          'text',
          { className: 'archd-footer', x: chip ? restX - 4 : restX, y, style: { fontSize: FOOTER_FONT, fontWeight: 700 } },
          ...rest.map((part, i) =>
            h(
              'tspan',
              {
                key: i,
                dx: i ? FOOTER_GAP : undefined,
                style: { fill: part.kind === 'state' ? STATE_COLOR.get(part.state) : V('label-secondary') },
              },
              part.text,
            ),
          ),
        )
      : null,
  )
}

function nodeLabels(node) {
  return labelLayout(node).map((line, i) =>
    h(FittedText, {
      key: i,
      text: line.text,
      width: node.width - 32,
      x: node.x + node.width / 2,
      y: line.y,
      textAnchor: 'middle',
      style: { fontSize: line.title ? 28 : 19, fontWeight: line.title ? 600 : 400,
        fill: V(line.title ? 'label-primary' : 'label-secondary') },
    }),
  )
}

function nodeHeader(head, accent, group, own, color, node, kindText) {
  return h(
    React.Fragment,
    null,
    head.kind
      ? h(
          'text',
          {
            className: 'archd-kind',
            x: head.kind.x,
            y: head.kind.y,
            textAnchor: head.kind.anchor,
            style: { fontSize: KIND_FONT, fill: accent, fontWeight: group ? 700 : 400, letterSpacing: '.04em', textTransform: 'uppercase' },
          },
          kindText,
        )
      : null,
    head.pill
      ? h(
          'g',
          { className: 'archd-pill-mark' },
          h('rect', {
            x: head.pill.x,
            y: head.pill.y,
            width: head.pill.width,
            height: PILL_H,
            rx: PILL_H / 2,
            style: { fill: own ? color : node.marks?.length ? V('label-secondary') : color },
          }),
          h(
            'text',
            {
              x: head.pill.x + head.pill.width / 2,
              y: head.pill.y + PILL_H / 2 + head.pill.font * 0.36,
              textAnchor: 'middle',
              style: { fontSize: head.pill.font, fontWeight: 600, fill: V('bg-base') },
            },
            head.pill.text,
          ),
        )
      : null,
  )
}
