import * as React from 'react'
const h = React.createElement

/** SVG uses the installed font, not the engine's deterministic column estimate. */
export function FittedText({ text, width, ...props }) {
  const ref = React.useRef(null)
  const [shown, setShown] = React.useState(text)
  React.useLayoutEffect(() => {
    const element = ref.current
    const previous = element.textContent
    const measure = (value) => {
      element.textContent = value
      return element.getComputedTextLength()
    }
    let fitted = text
    if (measure(text) > Math.max(0, width)) {
      const chars = [...text]
      let low = 0, high = chars.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (measure(chars.slice(0, middle).join('').trimEnd() + '…') <= width) low = middle
        else high = middle - 1
      }
      fitted = measure('…') <= width ? chars.slice(0, low).join('').trimEnd() + '…' : ''
    }
    element.textContent = previous
    setShown(fitted)
  }, [text, width, props.style])
  return h('text', { ...props, ref, 'aria-label': text }, shown)
}
