// WCAG relative luminance for opaque computed sRGB colours (including color-mix).
export function contrast(a, b) {
  const luminance = (color) => {
    const values = color.match(/[\d.]+/g).map(Number).slice(0, 3)
    const rgb = color.startsWith('color(') ? values : values.map((value) => value / 255)
    const linear = rgb.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
