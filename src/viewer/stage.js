// The zoomable canvas: focused hooks preserve the public control API.
import * as React from 'react'
import { useStageController } from './stage-controller.js'
import { StageScene, StageAccessibility, StageDetails } from './stage-view.js'

const h = React.createElement

export function ZoomStage(props) {
  const controller = useStageController(props)
  const { stage, dragging, view, accessibilityId, focusId, optionId, setKeyboardActive, moveKeyboardFocus,
    keyboardNode, onKeyDown, onPointerDown, onPointerMove, onPointerUp, suppressClick, flyTo, st } = controller

  return h(
    'div',
    {
      ref: stage,
      className: 'archd-stage' + (dragging ? ' archd-drag' : ''),
      tabIndex: 0,
      role: 'application',
      'aria-label': view?.title ?? view?.id,
      'aria-describedby': accessibilityId + '-help',
      'aria-activedescendant': focusId ? optionId(focusId) : undefined,
      onFocus: (e) => {
        if (e.target !== e.currentTarget) return
        setKeyboardActive(true)
        moveKeyboardFocus(keyboardNode?.id)
      },
      onBlur: () => setKeyboardActive(false),
      onKeyDown,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture: () => {
        setTimeout(() => {
          suppressClick.current = false
        }, 0)
      },
      // Boxes and unfolded frames stop the double-clicks they handle; the rest (empty space, other frames) fits the view.
      onDoubleClick: (e) => {
        if (!(e.target.closest && e.target.closest('.archd-detail'))) flyTo(st.current.focus)
      },
    },
    h(StageScene, { ...props, controller }),
    h(StageAccessibility, { ...props, controller }),
    h(StageDetails, { ...props, controller }),
  )
}
