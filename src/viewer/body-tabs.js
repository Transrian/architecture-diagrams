import * as React from 'react'
import { useEffect } from 'react'
const h = React.createElement

export function BodyTabs({ schemas, extras, flowView, path, chooseSchema, enterFlow, t, root, width }) {
  const tabs =
    schemas.length > 1 || extras.length
      ? schemas.map((b) =>
          h(
            'button',
            {
              key: b.view,
              type: 'button',
              className: 'dshd-tab',
              'data-label': b.title,
              'aria-current': !flowView && path.includes(b.view) ? 'true' : undefined,
              onClick: () => chooseSchema(b.view),
            },
            b.title,
          ),
        )
      : []
  const flows = extras.map((b) =>
    h(
      'button',
      {
        key: b.view,
        type: 'button',
        className: 'dshd-tab dshd-flow',
        'data-label': '▶ ' + b.title,
        'aria-current': flowView === b.view ? 'true' : undefined,
        onClick: () => enterFlow(b.view),
      },
      h('span', null, h('span', { 'aria-hidden': true }, '▶ '), b.title),
    ),
  )
  const views =
    tabs.length || flows.length
      ? h(
          'nav',
          {
            className: 'dshd-views',
            'aria-label': t('views'),
            // A vertical wheel scrolls the tab row sideways.
            onWheel: (event) => {
              if (!event.deltaX && event.currentTarget.scrollWidth > event.currentTarget.clientWidth)
                event.currentTarget.scrollLeft += event.deltaY
            },
          },
          ...tabs,
          tabs.length && flows.length ? h('span', { key: 'sep', className: 'dshd-sep', 'aria-hidden': true }) : null,
          ...flows,
        )
      : h('div', { className: 'dshd-views' })
  const currentTab = flowView ?? path.find((id) => schemas.some((b) => b.view === id))
  useEffect(() => {
    // Keep the current tab in sight without scrolling any other ancestor.
    const row = root.current?.querySelector('.dshd-views')
    const tab = row?.querySelector('[aria-current=true]')
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return
    const left = tab.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft) row.scrollLeft = left - 8
    else if (left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + tab.offsetWidth - row.clientWidth + 8
  }, [currentTab, width])

  return views
}
