// What a click, a double-click or a footer chip does on a box, a frame or a link.
import { isGroup } from './zoom.js'

/**
 * - Click: the details of a box, a frame or a link, at once (no double-click wait).
 * - Double-click toggles a group in place: a collapsed group unfolds, the empty
 *   space of a group unfolded in place folds it back. A group that cannot
 *   unfold here zooms into its view; a grey neighbour flies to its view.
 * - Double-click any other empty space, including the frame the camera is
 *   in, fits (the stage handles what is not handled here).
 * - The footer chip `⊕ N` of a collapsed group unfolds it in one click; `↗ N`
 *   on a neighbour flies to its view.
 * Zooming into a group's own view: the wheel, the details' Zoom in, Shift+Enter.
 */
export function useActivation(st, flyTo, onToggle, setSelected, suppressClick) {
  const guard = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return false
    }
    return true
  }
  const canFly = (x) => !!x.drill && !!st.current.tree?.entries.has(x.drill)
  const outsideView = (id) => {
    const scope = st.current.tree?.entries.get(st.current.focus)?.frame?.id
    return !!scope && id !== scope && !id.startsWith(scope + '.')
  }
  /** The frame of the group the camera is in. */
  const isScope = (x) => st.current.tree?.entries.get(st.current.focus)?.frame?.id === x.id
  const onActivate = (x, e) => {
    if (!guard()) return
    if (x && x.points) {
      setSelected((cur) => (cur && cur.type === 'edge' && cur.item.id === x.id ? null : { type: 'edge', item: x }))
      return
    }
    if (e && e.detail > 1) return // second click of a double-click
    setSelected((cur) => (cur && cur.type === 'node' && cur.item.id === x.id ? null : { type: 'node', item: x }))
  }
  /** Zoom into a box's or frame's view; a collapsed group without one unfolds. False: nothing to do. */
  const zoomInto = (x) => {
    if (!x || isScope(x)) return false
    if (canFly(x)) return flyTo(x.drill)
    if (!isGroup(x) && x.unfold && onToggle) {
      onToggle(x.id)
      return true
    }
    return false
  }
  /** Double-click on a box or a frame; false: not handled (the stage fits the view). */
  const onOpen = (x) => {
    if (isGroup(x)) {
      // Only a group the user unfolded folds back; the frame the camera is in, or
      // one the agent drew open, leaves the double-click to the fit.
      if (!x.expanded || !onToggle) return false
      onToggle(x.id)
      return true
    }
    if (outsideView(x.id)) {
      if (canFly(x)) flyTo(x.drill)
    } else if (x.unfold && onToggle) onToggle(x.id)
    else if (canFly(x)) flyTo(x.drill)
    return true // a box keeps its double-click: never a surprise fit
  }
  const onFold = (x) => {
    if (!guard()) return
    onToggle(x.id)
  }
  /** The action of a collapsed group's footer chip, or null when it has none. */
  const chipOf = (x) => {
    if (isGroup(x) || !(x.hidden > 0)) return null
    if (outsideView(x.id)) return canFly(x) ? 'fly' : null
    return x.unfold && onToggle ? 'unfold' : canFly(x) ? 'fly' : null
  }
  const onChip = (x) => {
    if (!guard()) return
    const action = chipOf(x)
    if (action === 'unfold') onToggle(x.id)
    else if (action === 'fly') flyTo(x.drill)
  }

  return { canFly, outsideView, onActivate, onOpen, onFold, zoomInto, chipOf, onChip }
}
