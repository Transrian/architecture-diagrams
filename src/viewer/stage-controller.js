// Stage controller joins focused hooks; the component owns only DOM wiring.
import { useRef, useEffect, useCallback, useId } from 'react'
import { useIconVersion } from './iconpack.js'
import { useActivation } from './activation.js'
import { startFlight } from './flight.js'
import { useStageCamera } from './stage-camera.js'
import { useStageTransitions } from './stage-transitions.js'
import { useStageGestures } from './stage-gestures.js'
import { useStageSelection } from './stage-selection.js'
import { useKeyboardPan } from './stage-focus.js'
import { stageKeyboard } from './stage-keyboard.js'

export function useStageController(props) {
  const { tree, start, result, ctl, onFocus } = props
  const model = props.model ?? result?.model
  const stage = useRef(null)
  const camera = useStageCamera(stage, tree, start)
  const { st, bump, schedule, endMorph } = camera
  const transitions = useStageTransitions(st, bump)
  const { release, fadeContext, arrive, cancelFly } = transitions
  const flyTo = useCallback((target, onComplete, elementId) => startFlight(st.current, target, {
    endMorph, bump, fadeContext, onComplete, elementId,
  }), [])
  const s = st.current
  const entry = s.tree?.entries.get(s.focus)
  const view = entry?.view
  const selection = useStageSelection({ ...props, model, st, stage, view, cancelFly, flyTo, bump })
  const { setSelected, setSelectedEdge, requestReveal, setKeyboardActive } = selection
  const gestures = useStageGestures({
    stage, st, endMorph, cancelFly, release, fadeContext, arrive, schedule, setSelected, setKeyboardActive,
  })
  const accessibilityId = useId()
  useIconVersion() // redraw when icon shards arrive
  ctl.current = {
    flyTo,
    fit: () => flyTo(st.current.focus),
    has: (id) => !!st.current.tree?.entries.has(id),
    focus: () => stage.current?.focus({ preventScroll: true }),
    reveal: requestReveal,
  }
  // Camera context changes never discard the selected element identity.
  useEffect(() => {
    const s = st.current
    if (s.focus && s.focus !== s.reported) {
      s.reported = s.focus
      onFocus(s.focus)
      setSelectedEdge(null)
    }
  })
  const activation = useActivation(st, flyTo, props.onToggle, setSelected, gestures.suppressClick)
  const keyboard = stageKeyboard({
    ...props, ...selection, ...activation, st, stage, entry, view, accessibilityId, flyTo,
    expanded: props.expanded ?? [],
  })
  useKeyboardPan(st, stage, view, selection.keyboardActive ? keyboard.keyboardNode : null, bump)
  return { ...selection, ...gestures, ...activation, ...keyboard, st, stage, view, accessibilityId, flyTo, model }
}
