import * as React from 'react'
const h = React.createElement

/** A toolbar tool: label and icon, icon only when compact; the full name stays in aria-label and title. */
export const toolbarTool = (
  compact,
  { key, name, text = name, icon, title, pressed, disabled, onClick, className, ref, controls, glyph },
) =>
  h(
    'button',
    {
      key,
      ref,
      type: 'button',
      className: 'dshd-btn dshd-tool' + (compact || !text ? ' dshd-icon' : '') + (className ? ' ' + className : ''),
      'aria-label': name,
      title: title ?? name,
      'aria-pressed': pressed,
      'aria-controls': controls,
      disabled,
      onClick,
    },
    icon ? h(icon) : null,
    glyph ? h('span', { 'aria-hidden': true }, glyph) : null,
    compact || !text ? null : h('span', null, text),
  )
