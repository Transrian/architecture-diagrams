// The icon pack in the browser: the engine names an icon per box
// (node.icon); its SVG lives in one of the `client.icons-XX.js` chunks,
// loaded on first use and kept for the page's lifetime.
import * as React from 'react'
import { useSyncExternalStore } from 'react'
import { shardOf, shardFile } from './iconrules.js'
import { V } from './theme.js'

const h = React.createElement

let loader = null
/** The module loader's `require` (chunks load through `require.async`). */
export function setIconLoader(require) {
  loader = require
}

/** id → [viewBox, body, mode, bg?, fg?] */
const icons = new Map()
/** shard number → Promise */
const shards = new Map()
let version = 0
const listeners = new Set()
const notify = () => {
  version++
  for (const l of listeners) l()
}

function loadShard(n) {
  let p = shards.get(n)
  if (!p) {
    p = loader.async('./' + shardFile(n)).then((m) => {
      const data = m?.default ?? m
      for (const [id, e] of Object.entries(data ?? {})) icons.set(id, e)
    })
    p.catch((e) => {
      shards.delete(n)
      console.warn('[dsh-diagram] icon shard', n, e)
    })
    shards.set(n, p)
  }
  return p
}

/** Loads the shards of these icons; boxes re-render once they arrive. */
export function requestIcons(ids) {
  if (!loader) return
  const need = new Set()
  for (const id of ids) if (id && !icons.has(id)) need.add(shardOf(id))
  const pending = [...need].filter((n) => !shards.has(n))
  if (pending.length === 0) return
  Promise.allSettled(pending.map(loadShard)).then(notify)
}

/** Whether this icon is loaded (and so drawn). */
export const hasIcon = (id) => !!id && icons.has(id)

/** Icon ids drawn in a layout result. */
export function iconsOf(result) {
  const out = new Set()
  for (const v of result?.views ?? []) for (const n of v.nodes ?? []) if (n.icon) out.add(n.icon)
  return out
}

// ── theme ────────────────────────────────────────────────────────────────
// One-colour logos need the theme's lightness: a black logo would vanish on
// a dark tile. Read from the page background, followed live.
let tileLum = null
function readLum() {
  try {
    const value = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim() || getComputedStyle(document.body).backgroundColor
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const g = c.getContext('2d')
    g.fillStyle = '#fff'
    g.fillStyle = value
    g.fillRect(0, 0, 1, 1)
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data
    return lum(r, gr, b)
  } catch {
    return 1
  }
}
function lum(r, g, b) {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const hexLum = (hex) => lum(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

let watching = false
function watchTheme() {
  if (watching || typeof document === 'undefined') return
  watching = true
  tileLum = readLum()
  const recheck = () => {
    const next = readLum()
    if (Math.abs(next - tileLum) > 0.01) {
      tileLum = next
      notify()
    }
  }
  const mo = new MutationObserver(recheck)
  for (const el of [document.documentElement, document.body]) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', recheck)
}

/** The colour to draw a one-colour logo in: its own, or the text colour where it would not show. */
function monoColour(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return V('label-primary')
  if (tileLum === null) tileLum = readLum()
  // Contrast ratios overrate dark-on-dark: a light theme accepts a pale brand (Snowflake cyan), a dark one asks more.
  return contrast(hexLum(hex), tileLum) >= (tileLum > 0.4 ? 1.6 : 3) ? hex : V('label-primary')
}

/** Re-renders the caller when new icons arrive or the theme changes. */
export function useIconVersion() {
  watchTheme()
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, () => version)
}

/**
 * The icon of a box at (x, y), `size` wide. A product logo sits on a tile in
 * the theme's background colour; a one-colour logo is drawn in its own colour,
 * or the text colour where that would not show. A generic glyph is drawn
 * bare, in the secondary text colour, so a guess never looks like a product.
 */
export function IconMark({ id, x, y, size = 30 }) {
  const e = id ? icons.get(id) : undefined
  if (!e) return null
  const [viewBox, body, mode, colour] = e
  const inner = (pad, style) => h('svg', {
    x: x + pad, y: y + pad, width: size - pad * 2, height: size - pad * 2, viewBox,
    preserveAspectRatio: 'xMidYMid meet', overflow: 'visible', style,
    dangerouslySetInnerHTML: { __html: body },
  })
  if (mode === 'g') return h('g', { className: 'dshd-ico', 'aria-hidden': true }, inner(2, { fill: 'currentColor', color: V('label-secondary') }))
  const ink = mode === 'm' ? monoColour(colour) : undefined
  return h('g', { className: 'dshd-ico', 'aria-hidden': true },
    h('rect', { x, y, width: size, height: size, rx: size * 0.26, style: { fill: V('bg-base'), stroke: V('border-l2'), strokeWidth: 1 } }),
    inner(size * 0.17, ink ? { fill: ink, color: ink } : undefined))
}
