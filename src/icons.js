import * as React from 'react'

const h = React.createElement

export function DirIcon({ horizontal }) {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block', transform: horizontal ? undefined : 'rotate(90deg)' } },
    h('rect', { x: 2, y: 9, width: 6, height: 6, rx: 1.5 }),
    h('rect', { x: 16, y: 9, width: 6, height: 6, rx: 1.5 }),
    h('path', { d: 'M8 12h6M12 9.5l2.5 2.5-2.5 2.5' }))
}

export function DownloadIcon() {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' } },
    h('path', { d: 'M12 4v11M7 10.5l5 5 5-5M5 20h14' }))
}

export function DiagramIcon(props) {
  const size = props?.size ?? 16
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('rect', { x: 3, y: 3, width: 7, height: 5, rx: 1.5 }),
    h('rect', { x: 14, y: 9.5, width: 7, height: 5, rx: 1.5 }),
    h('rect', { x: 3, y: 16, width: 7, height: 5, rx: 1.5 }),
    h('path', { d: 'M10 5.5h2a2 2 0 0 1 2 2V12M10 18.5h2a2 2 0 0 0 2-2V12' }))
}

export function DiagramTitle(props) {
  return props.t ? props.t('type.label') : 'Diagram'
}
