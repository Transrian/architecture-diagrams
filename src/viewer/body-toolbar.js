import * as React from 'react'
import { DirIcon, SearchIcon, FitIcon, FoldAllIcon, HelpIcon } from './icons.js'

import { BodyTabs } from './body-tabs.js'
import { BodyVersions } from './body-versions.js'
import { toolbarTool } from './toolbar-tool.js'

const h = React.createElement
export function BodyToolbar(props) {
  const { t, tools, compact, flowView, result, exploring, closeExplorer, openExplorer,
    expanded, setExpanded, layoutDirection, flip, ctl, helpButton, helpOpen, helpId, closeHelp, setHelpOpen } = props
  const tool = (item) => toolbarTool(compact, item)
  const versions = h(BodyVersions, props)
  const horizontal = layoutDirection === 'LeftRight'
  const toolbar = h(
    'div',
    { className: 'archd-tools', ref: tools },
    versions,
    tool({
      key: 'explorer',
      name: t('explorer'),
      icon: SearchIcon,
      disabled: !result?.model,
      pressed: exploring,
      onClick: () => (exploring ? closeExplorer() : openExplorer()),
    }),
    flowView
      ? null
      : tool({ key: 'foldAll', name: t('foldAll'), icon: FoldAllIcon, disabled: !expanded.length, onClick: () => setExpanded([]) }),
    h(
      'button',
      {
        key: 'direction',
        type: 'button',
        className: 'archd-btn archd-tool archd-icon',
        title: t(horizontal ? 'direction.toVertical' : 'direction.toHorizontal'),
        'aria-label': t(horizontal ? 'direction.toVertical' : 'direction.toHorizontal'),
        onClick: flip,
      },
      h(DirIcon, { horizontal }),
    ),
    tool({ key: 'fit', name: t('fit'), icon: FitIcon, onClick: () => ctl.current.fit?.() }),
    tool({
      key: 'help',
      ref: helpButton,
      name: t('help'),
      text: null,
      icon: HelpIcon,
      pressed: helpOpen,
      controls: helpOpen ? helpId : undefined,
      onClick: () => (helpOpen ? closeHelp(false) : setHelpOpen(true)),
    }),
  )

  return h('div', { className: 'archd-bar' }, h(BodyTabs, props), toolbar)
}
