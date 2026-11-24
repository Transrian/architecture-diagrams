import { useState, useRef, useLayoutEffect } from 'react'
import { readPreference, writePreference } from './preferences.js'
export function useDirection() {
  const [direction, setDirection] = useState(() => {
    return readPreference('architecture-diagrams.direction') || 'TopBottom'
  })
  // Flows follow the shape of the stage (wide: left to right) until the user picks a direction for them.
  const [flowDirection, setFlowDirection] = useState(() => {
    const saved = readPreference('architecture-diagrams.flowDirection')
    return ['LeftRight', 'TopBottom'].includes(saved) ? saved : null
  })
  const area = useRef(null)
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return undefined
    const measure = () =>
      setAreaSize((cur) => (cur.w === el.clientWidth && cur.h === el.clientHeight ? cur : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [flow, setFlow] = useState(null) // dynamic view shown instead of the zoomable diagram
  const autoFlowDirection = areaSize.w > 1.3 * areaSize.h ? 'LeftRight' : 'TopBottom'
  const layoutDirection = flow ? (flowDirection ?? autoFlowDirection) : direction
  const flip = () => {
    const next = layoutDirection === 'LeftRight' ? 'TopBottom' : 'LeftRight'
    if (flow) {
      setFlowDirection(next)
      writePreference('architecture-diagrams.flowDirection', next)
      return
    }
    setDirection(next)
    writePreference('architecture-diagrams.direction', next)
  }
  return { area, flow, setFlow, layoutDirection, flip }
}
