import { directionalNeighbour } from './navigation.js'
import { isGroup } from './zoom.js'
export function stageKeyboard({
  st, stage, entry, view, selected, keyboardFocus, keyboardActive, setKeyboardFocus, setKeyboardActive,
  accessibilityId, t, traceActive, onClearTrace, setSelected, onSearch, flyTo, zoomInto, expanded, onToggle, canFly,
}) {
  const scope = entry?.frame?.id ?? view?.viewOf ?? null
  // The enclosing scope frame is not a box to navigate to. Unfolded nested
  // frames and outside neighbours remain available alongside ordinary boxes.
  const keyboardNodes = (view?.nodes ?? []).filter((node) => node.id !== scope)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const firstKeyboardNode = keyboardNodes.find((node) => !scope || node.id.startsWith(scope + '.')) ?? keyboardNodes[0]
  const keyboardNode = (keyboardFocus?.view === view?.id && keyboardNodes.find((node) => node.id === keyboardFocus.id)) || firstKeyboardNode
  const focusId = keyboardActive ? keyboardNode?.id : null
  const optionId = (id) => accessibilityId + '-box-' + encodeURIComponent(id)
  const announcement = (node) => t('keyboard.focus', {
    title: node.title ?? node.id,
    kind: t('kind.' + node.kind),
    count: node.hidden ?? 0,
    state: node.state ? t('state.' + node.state) : t('states.none'),
  }) + (node.marks?.length ? ' · ' + node.marks.map((mark) => t('mark.' + mark)).join(', ') : '')
    + (node.assumedCount > 0 ? ' · ' + t('count.assumed', { n: node.assumedCount }) : '')
  const moveKeyboardFocus = (id) => {
    if (id) setKeyboardFocus({ view: view.id, id })
  }
  const onKeyDown = (event) => handleStageKey(event, {
    st, stage, entry, selected, setKeyboardActive, traceActive, onClearTrace, setSelected,
    onSearch, flyTo, zoomInto, expanded, onToggle, canFly, keyboardNodes, keyboardNode, moveKeyboardFocus,
  })
  return { keyboardNodes, keyboardNode, focusId, optionId, announcement, moveKeyboardFocus, onKeyDown }
}

function handleStageKey(e, {
  st, stage, entry, selected, setKeyboardActive, traceActive, onClearTrace, setSelected,
  onSearch, flyTo, zoomInto, expanded, onToggle, canFly, keyboardNodes, keyboardNode, moveKeyboardFocus,
}) {
  const s = st.current
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent?.isComposing) return
    // Native buttons/inputs in the detail panel keep their normal keymap.
    if (e.target !== e.currentTarget) {
      if (e.key === 'Escape' && selected && e.target.closest?.('.archd-detail')) {
        e.preventDefault()
        e.stopPropagation()
        if (traceActive) onClearTrace?.()
        else setSelected(null)
        stage.current?.focus({ preventScroll: true })
      }
      return
    }
    const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
    const changeGroup = ['+', '=', '-', ' ', 'Spacebar'].includes(e.key)
    if (!arrow && !changeGroup && !['Enter', 'Escape', 'Backspace', 'Home', 'End', 'f', 'F', '/'].includes(e.key)) return
    if (e.key === '/' && !onSearch) return
    // Escape only closes things; with nothing to close it is left alone (it never navigates).
    if (e.key === 'Escape' && !traceActive && !selected) return
    if (e.key === 'Backspace' && !entry?.parent) return
    e.preventDefault()
    e.stopPropagation()
    setKeyboardActive(true)
    if (arrow) {
      moveKeyboardFocus(directionalNeighbour(keyboardNodes, keyboardNode?.id, e.key))
      return
    }
    if (e.key === 'Home' || e.key === 'End') {
      moveKeyboardFocus(e.key === 'Home' ? keyboardNodes[0]?.id : keyboardNodes.at(-1)?.id)
      return
    }
    if (e.key === 'Escape') {
      if (traceActive) onClearTrace?.()
      else setSelected(null)
      return
    }
    if (e.key === 'Backspace') {
      flyTo(entry.parent)
      return
    }
    if (e.key === 'f' || e.key === 'F') {
      flyTo(s.focus)
      return
    }
    if (e.key === '/') {
      onSearch()
      return
    }
    if (!keyboardNode) return
    if (e.key === 'Enter') {
      // Shift+Enter zooms into the focused group (or unfolds it when it has no view of its own).
      if (e.shiftKey) zoomInto(keyboardNode)
      else setSelected({ type: 'node', item: keyboardNode })
      return
    }
    if (changeGroup && !e.repeat) changeKeyboardGroup(e.key, keyboardNode, expanded, onToggle, canFly, flyTo)
  }

function changeKeyboardGroup(key, keyboardNode, expanded, onToggle, canFly, flyTo) {
      // Controlled expansion wins over the previous layout while recomputing.
      const open = expanded.includes(keyboardNode.id)
      const toggle = key === ' ' || key === 'Spacebar'
      const fold = key === '-' || (toggle && open)
      if (fold) {
        // Never let '-' on a closed box expand it through a toggle API.
        if (open && keyboardNode.unfold && onToggle) onToggle(keyboardNode.id)
      } else if (!open && !isGroup(keyboardNode)) {
        if (keyboardNode.unfold && onToggle) onToggle(keyboardNode.id)
        else if (canFly(keyboardNode)) flyTo(keyboardNode.drill)
      }
      return
}
