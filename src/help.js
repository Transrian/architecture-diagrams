// The "?" popover: mouse gestures and keyboard shortcuts of the diagram, localized.
// Its content describes the shipped behaviour; keep it in step with stage.js,
// activation.js, the screen-reader `keyboard.help` text and the README.
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { CloseButton } from './icons.js'

const h = React.createElement

const MOUSE = ['click', 'dblGroup', 'dblOpen', 'dblFrame', 'dblEmpty', 'wheel', 'drag']

/** Keys shown for each keyboard row; `key.*` entries are translated key names. */
const KEYS = [
  ['tab', ['Tab']],
  ['arrows', ['← ↑ → ↓']],
  ['homeEnd', ['key.home', 'key.end']],
  ['enter', ['key.enter']],
  ['toggle', ['+', '−', 'key.space']],
  ['escape', ['key.escape']],
  ['fit', ['f']],
  ['search', ['/']],
]

export function HelpPopover({ id, t, onClose }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
  const key = (name) => h('kbd', { key: name }, name.startsWith('key.') ? t(name) : name)
  return h('section', { ref, id, className: 'dshd-help', role: 'dialog', 'aria-label': t('help.title'), tabIndex: -1 },
    h('div', { className: 'dshd-panel-head' }, h('strong', null, t('help.title')), h(CloseButton, { t, onClick: onClose })),
    h('h5', null, t('help.mouse')),
    h('dl', null, ...MOUSE.flatMap((row) => [
      h('dt', { key: 'g' + row }, t('help.gesture.' + row)),
      h('dd', { key: 'd' + row }, t('help.do.' + row)),
    ])),
    h('h5', null, t('help.keyboard')),
    h('dl', null, ...KEYS.flatMap(([row, keys]) => [
      h('dt', { key: 'g' + row }, ...keys.flatMap((name, i) => (i ? [' ', key(name)] : [key(name)]))),
      h('dd', { key: 'd' + row }, t('help.do.' + row)),
    ])))
}
