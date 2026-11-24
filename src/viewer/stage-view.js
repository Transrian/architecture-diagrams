import * as React from 'react'
import { useMemo } from 'react'
import { Markers } from './edge-view.js'
import { NodeDetail, EdgeDetail } from './details.js'
import { renderLevel } from './render.js'
import { endpointUnfolds } from './relations.js'
import { projectTrace } from './trace.js'
import { isGroup } from './zoom.js'

const h = React.createElement

export function StageScene({ controller, t, traceResult, changes }) {
  const { st, selected, revealed, containingId, focusId, onOpen, onFold, chipOf, onChip, moveKeyboardFocus, onActivate } = controller
  const s = st.current
  const traceCache = useMemo(() => new WeakMap(), [traceResult])
  const changedRelations = useMemo(
    () =>
      new Set([
        ...(changes?.relations.added ?? []).map((relation) => relation.id),
        ...(changes?.relations.changed ?? []).map((relation) => relation.after.id),
      ]),
    [changes],
  )
  if (s.tree && s.cam && s.size.w) {
    const entry = s.tree.entries.get(s.focus) ?? s.tree.root
    const ctx = {
      tree: s.tree,
      size: s.size,
      t,
      onOpen,
      onFold,
      chipOf,
      onChip,
      onActivate: (item, event) => {
        if (!item.points) moveKeyboardFocus(item.id)
        onActivate(item, event)
      },
      selectedId: selected?.type === 'node' ? selected.item.id : null,
      selectedEdge: selected?.type === 'edge' ? { view: entry.view.id, id: selected.item.id } : null,
      focusId,
      revealed,
      containingId,
      changes,
      changedRelations,
      cand: s.cand,
      leaving: s.leaving,
      arriving: s.arriving,
      morph: s.morph,
      contextFade: s.contextFade,
      traceOf: traceResult
        ? (view) => {
            if (!traceCache.has(view)) traceCache.set(view, projectTrace(traceResult, view))
            return traceCache.get(view)
          }
        : null,
    }
    // Accessible boxes live outside the visual SVG: role=img would otherwise
    // hide descendant controls from assistive technology.
    return h('svg', { 'aria-hidden': true, focusable: false }, h(Markers), ...renderLevel(ctx, entry, s.cam, false, entry.id))
  }
  return null
}

export function StageAccessibility({ controller, t }) {
  const { accessibilityId, view, keyboardNodes, optionId, selected, announcement, keyboardActive, keyboardNode } = controller
  return h(React.Fragment, null,
    h('span', { id: accessibilityId + '-help', className: 'archd-sr-only' }, t('keyboard.help')),
    h(
      'div',
      { role: 'listbox', className: 'archd-sr-only', 'aria-label': view?.title ?? view?.id },
      ...keyboardNodes.map((node) =>
        h(
          'div',
          {
            key: node.id,
            id: optionId(node.id),
            role: 'option',
            'aria-selected': selected?.type === 'node' && selected.item.id === node.id,
          },
          announcement(node),
        ),
      ),
    ),
    h(
      'div',
      { className: 'archd-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
      keyboardActive && keyboardNode ? announcement(keyboardNode) : '',
    )
  )
}

export function StageDetails({ controller, expanded = [], t, changes, onToggle, onReveal, onTrace, traceMode }) {
  const { st, selected, setSelected, model, view, canFly, flyTo, outsideView, onFold } = controller
  const s = st.current
  const sheet = s.size.w > 0 && s.size.w < 600
  const endpointGroups = selected?.type === 'edge' && onToggle ? endpointUnfolds(selected.item, model, view, expanded) : []
  const unfoldEndpoints = endpointGroups.length
    ? () => {
        // The helper excludes outside endpoints, open groups and the scope frame.
        // Close the panel before recomputing so repeated clicks cannot fold them.
        setSelected(null)
        for (const id of endpointGroups) onToggle(id)
      }
    : null
  return h(React.Fragment, null,
    selected?.type === 'node'
      ? h(NodeDetail, {
          node: selected.item,
          t,
          sheet,
          change: changes && Object.hasOwn(changes.nodes, selected.item.id) ? changes.nodes[selected.item.id] : null,
          onReveal: !view?.nodes.some((node) => node.id === selected.item.id) && onReveal ? () => onReveal(selected.item.id) : null,
          onTrace: onTrace ? (mode) => onTrace(selected.item.id, mode) : null,
          traceMode,
          onClose: () => setSelected(null),
          onEnter: canFly(selected.item) ? () => flyTo(selected.item.drill) : null,
          // A neighbour drawn around the frame: its view is in another branch.
          elsewhere: outsideView(selected.item.id),
          onUnfold: !isGroup(selected.item) && selected.item.unfold && onToggle ? () => onToggle(selected.item.id) : null,
          onFold: selected.item.expanded ? () => onFold(selected.item) : null,
        })
      : null,
    selected?.type === 'edge'
      ? h(EdgeDetail, { edge: selected.item, model, view, t, sheet, onClose: () => setSelected(null), onUnfoldEndpoints: unfoldEndpoints })
      : null
  )
}
