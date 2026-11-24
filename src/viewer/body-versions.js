import * as React from 'react'
import { toolbarTool } from './toolbar-tool.js'
const h = React.createElement

function Timeline({ history, pick, setPick, compact, t, diagram }) {
  const last = history.length - (diagram.unsaved ? 0 : 1)
  const idx = pick === null ? last : history.indexOf(pick)
  const setIdx = (i) => setPick(i >= last || i < 0 ? null : history[i])
  const label = pick === null ? t(diagram.unsaved ? 'unsaved' : diagram.live ? 'live' : 'latest') : `v${Number.parseInt(pick, 10)}`

  return last > 0
            ? h(
                'div',
                { className: 'archd-time' },
                compact
                  ? null
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'archd-btn archd-icon',
                        title: t('older'),
                        'aria-label': t('older'),
                        disabled: idx <= 0,
                        onClick: () => setIdx(idx - 1),
                      },
                      '‹',
                    ),
                h('input', {
                  type: 'range',
                  min: 0,
                  max: last,
                  value: idx,
                  'aria-label': t('version'),
                  'aria-valuetext': label,
                  onChange: (e) => setIdx(Number(e.target.value)),
                }),
                compact
                  ? null
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'archd-btn archd-icon',
                        title: t('newer'),
                        'aria-label': t('newer'),
                        disabled: pick === null,
                        onClick: () => setIdx(idx + 1),
                      },
                      '›',
                    ),
                h('span', null, label),
              )
            : null
}

export function BodyVersions(props) {
  const { history, changesEnabled, compact, t, diagram, setChangesEnabled } = props
  if (diagram.phase === 'empty') return null
  const tool = (item) => toolbarTool(compact, item)
  const showChanges = changesEnabled || history.length >= 2 || (diagram.unsaved && history.length > 0)
  const versions =
    history.length > 1 || diagram.unsaved || showChanges
      ? h(
          'div',
          { key: 'versions', className: 'archd-versions', role: 'group', 'aria-label': t('versions') },
          h(Timeline, props),
          showChanges
            ? tool({
                key: 'changes',
                name: t('changes'),
                glyph: 'Δ',
                text: t('changes'),
                pressed: changesEnabled,
                title: !diagram.source ? t('changes.unavailable') : t('changes'),
                disabled: !changesEnabled && !diagram.source,
                onClick: () => setChangesEnabled((value) => !value),
              })
            : null,
        )
      : null
  return versions
}
