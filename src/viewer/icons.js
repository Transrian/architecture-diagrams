import * as React from 'react'

const h = React.createElement

export function DirIcon({ horizontal }) {
  return h(
    'svg',
    {
      width: 14,
      height: 14,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      style: { display: 'block', transform: horizontal ? undefined : 'rotate(90deg)' },
    },
    h('rect', { x: 2, y: 9, width: 6, height: 6, rx: 1.5 }),
    h('rect', { x: 16, y: 9, width: 6, height: 6, rx: 1.5 }),
    h('path', { d: 'M8 12h6M12 9.5l2.5 2.5-2.5 2.5' }),
  )
}

/** A 14 px toolbar glyph drawn with the current text colour. */
const glyph = (...children) =>
  h(
    'svg',
    {
      width: 14,
      height: 14,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block', flexShrink: 0 },
    },
    ...children,
  )

export function SearchIcon() {
  return glyph(h('circle', { cx: 10.5, cy: 10.5, r: 6 }), h('path', { d: 'M15 15l5.5 5.5' }))
}

export function FitIcon() {
  return glyph(h('path', { d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' }))
}

export function FoldAllIcon() {
  return glyph(h('path', { d: 'M7 4l5 5 5-5M7 20l5-5 5 5M4 12h16' }))
}

export function HelpIcon() {
  return glyph(
    h('circle', { cx: 12, cy: 12, r: 9 }),
    h('path', { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14' }),
    h('path', { d: 'M12 17.5h.01' }),
  )
}

/** The one close control of the viewer: details, panels, notices and errors. */
export function CloseButton({ t, onClick, className }) {
  return h(
    'button',
    { type: 'button', className: 'dshd-x' + (className ? ' ' + className : ''), 'aria-label': t('close'), title: t('close'), onClick },
    '×',
  )
}
