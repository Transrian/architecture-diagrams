// Match SVG advances without mutating live text and forcing layout per trial.
let canvas
const widths = new Map()

export function textMeasure(element) {
  const style = getComputedStyle(element)
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const spacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
  canvas ??= document.createElement('canvas').getContext('2d')
  const kerning = style.fontKerning
  const key = `${font}\u0000${spacing}\u0000${style.fontKerning}\u0000`
  return (text) => {
    const id = key + text
    if (!widths.has(id)) {
      canvas.font = font
      canvas.letterSpacing = spacing
      canvas.fontKerning = kerning
      widths.set(id, canvas.measureText(text).width)
      if (widths.size > 4096) widths.delete(widths.keys().next().value)
    }
    return widths.get(id)
  }
}
