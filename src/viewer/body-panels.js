import * as React from 'react'
import { V, STATE_COLOR, GROUP_COLOR, stateLabel } from './theme.js'
import { RelationSample } from './edge-view.js'
import { ComparisonBar } from './change-panel.js'
import { Explorer } from './explorer.js'
import { HelpPopover } from './help.js'
import { CloseButton } from './icons.js'
const h = React.createElement

export function BodyCrumbs({ content, tree, flowView, byId, leaveFlow, t, path, ctl }) {
  const viewTitle = (id) => (id === 'index' ? t('overview') : (byId.get(id)?.title ?? id))
  return h(
    React.Fragment,
    null,
    content !== null && tree && flowView
      ? h(
          'div',
          { className: 'dshd-crumbs' },
          h('b', null, h('span', { 'aria-hidden': true }, '▶ '), byId.get(flowView)?.title ?? flowView),
          h(
            'button',
            { type: 'button', className: 'dshd-leave', onClick: leaveFlow },
            h('span', { 'aria-hidden': true }, '× '),
            t('flow.leave'),
          ),
        )
      : null,
    content !== null && tree && !flowView
      ? h(
          'div',
          { className: 'dshd-crumbs' },
          ...path.flatMap((id, i) => {
            const last = i === path.length - 1
            const item = last
              ? h('b', { key: id }, viewTitle(id))
              : h('button', { key: id, type: 'button', onClick: () => ctl.current.flyTo?.(id) }, viewTitle(id))
            return i === 0 ? [item] : [h('span', { key: 's' + i }, '›'), item]
          }),
        )
      : null,
  )
}

export function BodyNotices({
  diagram,
  pick,
  t,
  changesEnabled,
  currentComparison,
  changesProjection,
  result,
  baseMode,
  chosenBase,
  history,
  setBaseMode,
  setChosenBase,
  navigationNote,
  selectedId,
  setSelectedId,
}) {
  const state = diagram
  return h(
    React.Fragment,
    null,
    state.errors.length > 0 && pick === null
      ? h(
          'div',
          { className: 'dshd-err', role: 'status' },
          t('errors'),
          h(
            'code',
            null,
            state.errors
              .slice(0, 4)
              .map((e) => `L${e.line + 1}:${e.character} ${e.message}`)
              .join('\n'),
          ),
        )
      : null,
    state.problems.length > 0 && pick === null
      ? h(
          'div',
          { className: 'dshd-err', role: 'status' },
          t('problems'),
          h(
            'code',
            null,
            state.problems
              .slice(0, 3)
              .map((e) => e.message)
              .join('\n'),
          ),
        )
      : null,
    changesEnabled
      ? h(ComparisonBar, {
          t,
          state: currentComparison,
          projection: changesProjection,
          model: result?.model,
          mode: baseMode,
          chosen: chosenBase,
          history,
          onMode: setBaseMode,
          onChosen: setChosenBase,
        })
      : null,
    navigationNote ? h('div', { className: 'dshd-sub', role: 'status' }, navigationNote) : null,
    selectedId && result?.model && !result.model.elements[selectedId]
      ? h(
          'div',
          { className: 'dshd-sub dshd-note', role: 'status' },
          h('span', null, t('selection.absent', { id: selectedId })),
          h(CloseButton, { t, onClick: () => setSelectedId(null) }),
        )
      : null,
  )
}

export function BodyWorkspace({
  exploring,
  result,
  flowView,
  currentView,
  t,
  docked,
  explorerToken,
  reveal,
  closeExplorer,
  area,
  content,
  diagram,
  expanded,
  helpOpen,
  helpId,
  closeHelp,
}) {
  return h(
    React.Fragment,
    null,
    h(
      'div',
      { className: 'dshd-workspace' },
      exploring && result?.model
        ? h(Explorer, {
            model: result.model,
            currentGroup: flowView ? null : currentView?.viewOf,
            t,
            docked,
            focusToken: explorerToken,
            onReveal: reveal,
            onClose: closeExplorer,
          })
        : null,
      h(
        'div',
        { ref: area, className: 'dshd-area' },
        content,
        // Over the stage corner, so the toolbar never shifts while a layout is computed.
        diagram.busy && expanded.length ? h('div', { className: 'dshd-busy', role: 'status' }, t('unfolding')) : null,
      ),
      helpOpen ? h(HelpPopover, { id: helpId, t, onClose: () => closeHelp(true) }) : null,
    ),
  )
}

export function BodyLegend({ legend, t, legendOpen, legendId, toggleLegend }) {
  return h(
    React.Fragment,
    null,
    h(
      'div',
      { className: 'dshd-legend' },
      h(
        'button',
        {
          type: 'button',
          className: 'dshd-btn dshd-legend-toggle',
          'aria-pressed': legendOpen,
          'aria-controls': legendId,
          onClick: toggleLegend,
        },
        h('span', { 'aria-hidden': true }, legendOpen ? '▾' : '▸'),
        t('legend'),
      ),
      h(
        'div',
        { id: legendId, className: 'dshd-legend-items', hidden: !legendOpen },
        ...legend.states.map((s) =>
          h(
            'span',
            { key: s, style: { color: STATE_COLOR.get(s) } },
            h('i', { className: 'dshd-dot', style: s === 'planned' ? { borderStyle: 'dashed' } : undefined }),
            h('span', { style: { color: V('label-secondary') } }, stateLabel(s, t)),
          ),
        ),
        ...legend.kinds.map((kind) => h('span', { key: 'relation.' + kind }, h(RelationSample, { kind }), t('relation.' + kind))),
        legend.opens ? h('span', { key: 'opens' }, h('b', { style: { color: GROUP_COLOR } }, '⊕'), t('legend.opens')) : null,
        legend.elsewhere ? h('span', { key: 'elsewhere' }, h('b', null, '↗'), t('legend.elsewhere')) : null,
        legend.assumed ? h('span', { key: 'assumed' }, '? ', t('mark.assumed')) : null,
      ),
    ),
  )
}
