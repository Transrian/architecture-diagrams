// Resolve click versus double-click without flashing the details panel.
import { useEffect, useRef } from 'react'
import { isGroup } from './zoom.js'

const DBL_MS = 250

export function useActivation(st, flyTo, onToggle, setSelected, suppressClick) {
  const guard = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return false
    }
    return true
  }
  // Click: the details of a box or a link. Double-click opens: a collapsed
  // group unfolds in place (or, in a view the agent wrote and for a
  // neighbour from another branch, the camera flies to its view); the empty
  // space of an unfolded group folds it back, that of the group the camera
  // zoomed into leaves it for the parent view.
  const pending = useRef(0) // a click waiting to know whether a double-click follows
  useEffect(() => () => clearTimeout(pending.current), [])
  const canFly = (x) => !!x.drill && !!st.current.tree?.entries.has(x.drill)
  const outsideView = (id) => {
    const scope = st.current.tree?.entries.get(st.current.focus)?.frame?.id
    return !!scope && id !== scope && !id.startsWith(scope + '.')
  }
  /** The frame of the zoomed-into group, when there is a parent view to go back to. */
  const leaves = (x) => {
    const here = st.current.tree?.entries.get(st.current.focus)
    return !!here?.parent && here.frame?.id === x.id
  }
  const opens = (x) => (isGroup(x) ? !!x.expanded || leaves(x) : !!x.unfold || canFly(x))
  const select = (x) => setSelected((cur) => (cur && cur.type === 'node' && cur.item.id === x.id ? null : { type: 'node', item: x }))
  const onActivate = (x, e) => {
    if (!guard()) return
    if (x && x.points) {
      setSelected((cur) => (cur && cur.type === 'edge' && cur.item.id === x.id ? null : { type: 'edge', item: x }))
      return
    }
    if (e && e.detail > 1) return // second click of a double-click
    clearTimeout(pending.current)
    // Wait for a possible double-click only where one does something, so the panel does not flash.
    if (opens(x)) pending.current = setTimeout(() => select(x), DBL_MS)
    else select(x)
  }
  /** Double-click on a box or a frame; false: not handled (the stage fits the view). */
  const onOpen = (x) => {
    clearTimeout(pending.current)
    if (isGroup(x)) {
      if (x.expanded) {
        onToggle(x.id)
        return true
      }
      // The frame of the group the camera zoomed into: back up to its parent.
      if (leaves(x) && flyTo(st.current.tree.entries.get(st.current.focus).parent)) return true
      return false
    }
    if (x.unfold) onToggle(x.id)
    else if (canFly(x)) flyTo(x.drill)
    return true
  }
  const onFold = (x) => {
    if (!guard()) return
    clearTimeout(pending.current)
    onToggle(x.id)
  }

  return { canFly, outsideView, onActivate, onOpen, onFold }
}
