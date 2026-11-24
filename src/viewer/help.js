// The "?" popover: mouse gestures and keyboard shortcuts of the diagram, localized.
// Its content describes the shipped behaviour; keep it in step with stage.js,
// activation.js, the screen-reader `keyboard.help` text and the README.
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { CloseButton } from './icons.js'

const h = React.createElement

const MOUSE = ['click', 'chip', 'dblGroup', 'dblOpen', 'dblEmpty', 'wheel', 'drag']

/** Keys shown for each keyboard row; `key.*` entries are translated key names. */
const KEYS = [
  ['tab', ['Tab']],
  ['arrows', ['← ↑ → ↓']],
  ['homeEnd', ['key.home', 'key.end']],
  ['enter', ['key.enter']],
  ['zoomIn', ['key.shift', 'key.enter']],
  ['toggle', ['+', '−', 'key.space']],
  ['up', ['key.backspace']],
  ['escape', ['key.escape']],
  ['fit', ['f']],
  ['explorer', ['/']],
]

export function HelpPopover({ id, t, onClose }) {
  const scroll = useRef(null)
  const [more, setMore] = useState(false)
  const measure = () => {
    const el = scroll.current
    if (el) setMore(el.scrollHeight - el.scrollTop > el.clientHeight + 1)
  }
  useEffect(() => {
    scroll.current?.focus({ preventScroll: true })
    const observer = new ResizeObserver(measure)
    observer.observe(scroll.current)
    return () => observer.disconnect()
  }, [])
  const key = (name) => h('kbd', { key: name }, name.startsWith('key.') ? t(name) : name)
  return h('section', { id, className: 'archd-help', role: 'dialog', 'aria-label': t('help.title') },
    h('div', { className: 'archd-panel-head' }, h('strong', null, t('help.title')), h(CloseButton, { t, onClick: onClose })),
    h('div', { ref: scroll, className: 'archd-help-scroll', onScroll: measure, tabIndex: 0 },
      h('h5', null, t('help.mouse')),
      h('dl', null, ...MOUSE.flatMap((row) => [
        h('dt', { key: 'g' + row }, t('help.gesture.' + row)),
        h('dd', { key: 'd' + row }, t('help.do.' + row)),
      ])),
      h('h5', null, t('help.keyboard')),
      h('dl', null, ...KEYS.flatMap(([row, keys]) => [
        h('dt', { key: 'g' + row }, ...keys.flatMap((name, i) => (i ? [' ', key(name)] : [key(name)]))),
        h('dd', { key: 'd' + row }, t('help.do.' + row)),
      ]))),
    more ? h('span', { className: 'archd-help-more', 'aria-hidden': true }, '↓') : null)
}
