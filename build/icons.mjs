// Icon pack generator, run by build.mjs. Merges several npm icon sets into
//   generated/icon-index.json   product name → icon id, bundled into the engine
//   shards (256 JSON objects)   icon id → SVG, one icons-NNN.js chunk each,
//                               loaded by the browser only for the icons shown
// Sources, by priority when two sets know the same product:
//   aws:, azure:, gcp:, tech:, bootstrap:  @likec4/icons (the ids LikeC4's `icon` accepts)
//   lobe:                                  @lobehub/icons-static-svg (AI products)
//   si:                                    simple-icons (brand logos, one colour)
//   selfhst:                               @iconify-json/selfhst (self-hosted and infra software)
// Nothing here reaches the network at run time: everything ships in the skill.
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { iconKey, shardOf, SHARDS, PACK_VERSION, VENDORS, VENDOR_BARE, NAME_PREFIXES, CLOUD_SUFFIXES, ALIASES, GLYPHS, GLYPH_WORDS, TECH_WORDS, EXTENSIONS } from '../src/core/iconrules.js'

const require = createRequire(import.meta.url)
const NM = new URL('./node_modules/', import.meta.url)
const LIKEC4_SETS = ['aws', 'azure', 'gcp', 'tech', 'bootstrap']

// ── common words: a product named like one ("Spark", "Vault") only matches a
//    technology field or a whole title, never a word inside a longer title.
function commonWords() {
  const lists = require('wordlist-english')
  const out = new Set()
  for (const tier of ['10', '20', '35', '40', '50']) {
    for (const variant of ['english', 'english/american', 'english/british']) for (const w of lists[`${variant}/${tier}`] ?? []) out.add(iconKey(w))
  }
  for (const w of TECH_WORDS) out.add(w)
  for (const [, words] of GLYPH_WORDS) for (const w of words) out.add(w)
  return out
}

// ── SVG text → { vb, body, attrs } ───────────────────────────────────────────
const KEEP_ROOT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity']
function parseSvg(text) {
  const start = /<svg\b/i.exec(text)
  const close = /<\/svg>\s*$/i.exec(text)
  const tag = start && svgTag(text, start.index)
  if (!tag || tag.invalid || !close || close.index < tag.end) return null
  const attrs = Object.fromEntries(staticAttrs(tag.attrs))
  let vb = attrs.viewBox?.trim().split(/[\s,]+/).map(Number)
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) {
    const w = Number.parseFloat(attrs.width)
    const h = Number.parseFloat(attrs.height)
    if (!(w > 0 && h > 0)) return null
    vb = [0, 0, w, h]
  }
  return { vb, body: text.slice(tag.end, close.index), attrs }
}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', tab: '\t', newline: '\n' }
function decodeEntities(s) {
  return s.replace(/&#(x[\da-f]+|\d+);?|&(amp|quot|apos|lt|gt|colon|tab|newline);/gi, (_, numeric, named) => {
    if (named) return ENTITIES[named.toLowerCase()]
    const n = numeric[0].toLowerCase() === 'x' ? Number.parseInt(numeric.slice(1), 16) : Number(numeric)
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd'
  })
}

// Read one complete tag, not attribute-looking text inside another quoted value.
// Malformed/unterminated attributes fail closed; accepted values are re-quoted.
function svgTag(source, at) {
  const m = /^<(\/?)([a-z][\w:.-]*)/i.exec(source.slice(at))
  if (!m) return null
  let i = at + m[0].length
  const tag = { name: m[2], closing: !!m[1], attrs: [] }
  const invalid = () => ({ invalid: true, end: source.indexOf('>', i) < 0 ? source.length : source.indexOf('>', i) + 1 })
  while (i < source.length) {
    const space = /^\s*/.exec(source.slice(i))[0]
    i += space.length
    if (source[i] === '>' || source.slice(i, i + 2) === '/>') {
      tag.selfClosing = source[i] === '/'
      tag.end = i + (tag.selfClosing ? 2 : 1)
      return tag
    }
    if (!space || tag.closing) return invalid()
    const name = /^[a-z_:][\w:.-]*/i.exec(source.slice(i))?.[0]
    if (!name) return invalid()
    i += name.length
    i += /^\s*/.exec(source.slice(i))[0].length
    if (source[i++] !== '=') return invalid()
    i += /^\s*/.exec(source.slice(i))[0].length
    const quote = source[i] === '"' || source[i] === "'" ? source[i++] : null
    const start = i
    if (quote) {
      while (i < source.length && source[i] !== quote) i++
      if (i === source.length) return { invalid: true, end: i }
    } else {
      while (i < source.length && !/[\s>]/.test(source[i]) && source.slice(i, i + 2) !== '/>') i++
      if (i === start || /["'<=`]/.test(source.slice(start, i))) return invalid()
    }
    tag.attrs.push([name, decodeEntities(source.slice(start, i))])
    if (quote) i++
  }
  return { invalid: true, end: source.length }
}

// A raster MIME label alone is not enough: require base64 and the file signature.
function localUrl(value) {
  const url = value.trim()
  if (/^#[^\s"<>`\\]+$/.test(url)) return url
  const m = /^data:image\/(png|gif|jpe?g|webp);base64,([a-z\d+/]+={0,2})$/i.exec(url)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.toString('base64').replace(/=+$/, '') !== m[2].replace(/=+$/, '')) return null
  const type = m[1].toLowerCase()
  const good = type === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : type === 'gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
      : type === 'webp' ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  return good ? url : null
}

// Balanced scanning also preserves local ids containing parentheses. They must
// be quoted when written back as CSS, even if an upstream icon omitted quotes.
function cssUrls(css, transform) {
  const re = /\burl\s*\(/gi
  let out = ''
  let copied = 0
  let m
  while ((m = re.exec(css))) {
    let i = re.lastIndex
    while (/\s/.test(css[i] ?? '') && i < css.length) i++
    const quote = css[i] === '"' || css[i] === "'" ? css[i++] : null
    const start = i
    let url
    if (quote) {
      while (i < css.length && css[i] !== quote) i++
      if (i === css.length) return null
      url = css.slice(start, i++)
      while (/\s/.test(css[i] ?? '') && i < css.length) i++
      if (css[i] !== ')') return null
    } else {
      let depth = 1
      for (; i < css.length; i++) {
        if (css[i] === '(') depth++
        if (css[i] === ')' && --depth === 0) break
      }
      if (i === css.length) return null
      url = css.slice(start, i).trim()
    }
    const safe = transform(url)
    if (safe === null) return null
    out += css.slice(copied, m.index) + `url(${/[\s()"']/.test(safe) ? `"${safe}"` : safe})`
    copied = re.lastIndex = i + 1
  }
  return out + css.slice(copied)
}

function staticCss(source) {
  let css = decodeEntities(source.replace(/<!\[CDATA\[|\]\]>/g, ''))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:([\da-f]{1,6})\s?|([^\r\n])|\r?\n)/gi, (_, hex, char) => {
      const n = hex ? Number.parseInt(hex, 16) : 0
      return hex ? n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd' : char ?? ''
    })
  // No imports, active CSS, or image functions accepting a bare remote string.
  if (/[<>@\\]/.test(css) || /\b(?:expression|image(?:-set)?|cross-fade|src|paint|var|env|attr)\s*\(|(?:-moz-binding|behavior)\s*:/i.test(css)) return null
  return cssUrls(css, localUrl)
}

function staticAttrs(attrs) {
  const seen = new Set()
  return attrs.flatMap(([name, value]) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    if (/^(?:.*:)?on/i.test(key) || /^(?:xmlns(?::.*)?|xml:base|srcset)$/.test(key)) return []
    if (/(?:^|:)(?:href|src)$/.test(key)) value = localUrl(value)
    else if (key === 'style' || /url\s*\(|\\/i.test(value)) value = staticCss(value)
    return value === null ? [] : [[name, value]]
  })
}

// Only static SVG elements. In particular no scripts, foreign HTML, animations
// (including animate/set targeting href), or unknown namespace/HTML elements.
const STATIC_TAGS = new Set(('svg g defs symbol switch view use a path rect circle ellipse line polygon polyline text tspan textPath image ' +
  'linearGradient radialGradient stop pattern clipPath mask marker filter style ' +
  'feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight ' +
  'feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset ' +
  'fePointLight feSpecularLighting feSpotLight feTile feTurbulence').toLowerCase().split(' '))

/** Keeps static, offline SVG; scopes ids/classes so icons cannot restyle each other. */
export function clean(body, scope) {
  const tokens = []
  const blocked = []
  const stack = []
  for (let i = 0; i < body.length;) {
    if (body.startsWith('<!--', i)) {
      const end = body.indexOf('-->', i + 4)
      i = end < 0 ? body.length : end + 3
      continue
    }
    if (body[i] !== '<') {
      const end = body.indexOf('<', i)
      if (!blocked.length) tokens.push(body.slice(i, end < 0 ? body.length : end).replace(/\s+/g, ' '))
      i = end < 0 ? body.length : end
      continue
    }
    const tag = svgTag(body, i)
    if (!tag) { i++; if (!blocked.length) tokens.push('&lt;'); continue }
    i = tag.end
    if (tag.invalid) continue
    const name = tag.name.toLowerCase()
    if (blocked.length) {
      if (tag.closing) {
        const at = blocked.lastIndexOf(name)
        if (at >= 0) blocked.length = at
      } else if (!tag.selfClosing) blocked.push(name)
      continue
    }
    if (!STATIC_TAGS.has(name)) {
      if (!tag.closing && !tag.selfClosing) blocked.push(name)
      continue
    }
    if (tag.closing) {
      const at = stack.findLastIndex((t) => t.name.toLowerCase() === name)
      if (at >= 0) while (stack.length > at) tokens.push({ name: stack.pop().name, closing: true })
      continue
    }
    tag.attrs = staticAttrs(tag.attrs)
    if (name === 'style' && !tag.selfClosing) {
      const close = /<\/style\s*>/gi
      close.lastIndex = i
      const end = close.exec(body)
      const css = end ? staticCss(body.slice(i, end.index)) : null
      i = end ? close.lastIndex : body.length
      if (css) tokens.push({ ...tag, css })
    } else {
      tokens.push(tag)
      if (!tag.selfClosing) stack.push(tag)
    }
  }
  while (stack.length) tokens.push({ name: stack.pop().name, closing: true })
  const ids = new Map()
  const classes = new Set()
  for (const token of tokens) for (const [name, value] of token.attrs ?? []) {
    if (name.toLowerCase() === 'id') ids.set(value, `${scope}-${value}`)
    if (name.toLowerCase() === 'class') for (const c of value.split(/\s+/).filter(Boolean)) classes.add(c)
  }
  const urls = (s) => cssUrls(s, (url) => ids.has(url.slice(1)) ? '#' + ids.get(url.slice(1)) : url) ?? s
  return tokens.map((token) => {
    if (typeof token === 'string') return token
    if (token.closing) return `</${token.name}>`
    const attrs = token.attrs.map(([name, value]) => {
      const key = name.toLowerCase()
      if (key === 'id') value = ids.get(value)
      else if (key === 'class') value = value.split(/\s+/).filter(Boolean).map((c) => `${scope}-${c}`).join(' ')
      else if (/(?:^|:)href$/.test(key) && ids.has(value.slice(1))) value = '#' + ids.get(value.slice(1))
      else value = urls(value)
      return ` ${name}="${escapeAttr(value)}"`
    }).join('')
    if (token.css !== undefined) {
      // Only selectors for classes defined by this icon may reach the page.
      const rules = token.css.match(/[^{}]+\{[^{}]*\}/g) ?? []
      const css = rules.map((rule) => {
        const [selector, declarations] = rule.split('{')
        const selectors = selector.split(',').map((s) => s.trim()).filter((s) => /^\.[\w-]+$/.test(s) && classes.has(s.slice(1)))
        return selectors.length ? `${selectors.map((s) => `.${scope}-${s.slice(1)}`).join(',')}{${urls(declarations)}` : ''
      }).join('')
      return css ? `<style${attrs}>${css}</style>` : ''
    }
    return `<${token.name}${attrs}${token.selfClosing ? '/>' : '>'}`
  }).join('').trim()
}

const scopeOf = (id) => 'i' + shardOf(id).toString(36) + id.replace(/[^a-z0-9]/gi, '').slice(-10)

/** A colour literal as `rrggbb`, or null (none, currentColor, gradients, unknown names). */
const NAMED = { black: '000000', white: 'ffffff' }
function hexOf(c) {
  c = c.trim().toLowerCase()
  if (NAMED[c]) return NAMED[c]
  let m = /^#([0-9a-f]{3})$/.exec(c)
  if (m) return m[1].split('').map((x) => x + x).join('')
  m = /^#([0-9a-f]{6})$/.exec(c)
  if (m) return m[1]
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(c)
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')
  return null
}
const PAINT = /((?:fill|stroke|stop-color)\s*(?:=\s*"|:\s*))([^";}]+)/g
const SHAPES = /<(path|circle|rect|polygon|polyline|ellipse|line|text)\b([^>]*)>/g

/**
 * The one colour a logo is drawn in, or null when it has several (or a
 * gradient). Such a logo is redrawn in its colour, or in the text colour
 * where that colour would not show on the theme (a black logo on a dark tile).
 */
function soleColour(body, rootFill) {
  if (/url\(|<image\b/i.test(body)) return null
  const colours = new Set()
  for (const m of body.matchAll(PAINT)) {
    const v = m[2].trim().toLowerCase()
    if (v === 'none' || v === 'transparent' || v === 'currentcolor') continue
    const hx = hexOf(v)
    if (!hx) return null
    colours.add(hx)
  }
  // Shapes with no fill of their own take the root's, black by default.
  const implicit = [...body.matchAll(SHAPES)].some((m) => !/\bfill\s*=|fill\s*:/.test(m[2]))
  if (implicit) {
    if (colours.size > 0 && /<g\b/.test(body)) return null // a group may set their fill: too unsure
    const r = rootFill && rootFill !== 'currentColor' ? hexOf(rootFill) : '000000'
    if (!r) return null
    colours.add(r)
  }
  return colours.size === 1 ? [...colours][0] : null
}

/**
 * One pack entry: [viewBox, body, mode, colour?]. Modes: c colour logo, m one
 * colour (`colour`, or the text colour when absent), g generic glyph.
 */
function entry(id, svg, mode, colour) {
  const p = parseSvg(svg)
  if (!p) return null
  let body = clean(p.body, scopeOf(id))
  if (mode === 'c') {
    const sole = soleColour(body, p.attrs.fill)
    if (sole) {
      mode = 'm'
      colour = '#' + sole
      body = body.replace(PAINT, (all, pre, v) => (hexOf(v) === sole ? pre + 'currentColor' : all))
    }
  }
  const keep = KEEP_ROOT.filter((k) => p.attrs[k] !== undefined && (mode === 'c' ? !(k === 'fill' && p.attrs[k] === 'currentColor') : k !== 'fill' && k !== 'opacity')).map((k) => {
    const value = cssUrls(p.attrs[k], (url) => url.startsWith('#') ? `#${scopeOf(id)}-${url.slice(1)}` : url)
    return `${k}="${escapeAttr(value)}"`
  })
  if (mode !== 'c' && p.attrs.fill === 'none') keep.push('fill="none"')
  if (keep.length) body = `<g ${keep.join(' ')}>${body}</g>`
  if (!body) return null
  const [x, y, w, h] = p.vb
  const out = [`${x} ${y} ${w} ${h}`, body, mode]
  if (colour) out.push(colour)
  return { data: out, wide: w / h > 1.6 || h / w > 2.2 }
}

// ── reading the sets ─────────────────────────────────────────────────────────
async function likec4Set(set) {
  const dir = new URL(`@likec4/icons/${set}/`, NM)
  const names = (await readdir(dir)).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => f.slice(0, -3)).sort()
  const out = []
  for (const name of names) {
    const mod = await import(new URL(name + '.js', dir).href)
    out.push({ name, svg: renderToStaticMarkup(createElement(mod.default)) })
  }
  return out
}

async function simpleIcons() {
  const base = new URL('simple-icons/', NM)
  const data = JSON.parse(await readFile(new URL('data/simple-icons.json', base), 'utf8'))
  const list = Array.isArray(data) ? data : data.icons
  const out = []
  for (const i of list) {
    const slug = i.slug ?? iconKey(i.title)
    let svg
    try {
      svg = await readFile(new URL(`icons/${slug}.svg`, base), 'utf8')
    } catch {
      continue
    }
    out.push({ name: slug, title: i.title, aka: i.aliases?.aka ?? [], hex: i.hex, svg })
  }
  return out
}

async function lobeIcons() {
  const dir = new URL('@lobehub/icons-static-svg/icons/', NM)
  const out = []
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.svg')).sort()) {
    const name = f.slice(0, -4)
    if (/-text(-\w+)?$/.test(name)) continue // wordmarks
    out.push({ name, svg: await readFile(new URL(f, dir), 'utf8') })
  }
  return out
}

async function selfhst() {
  const j = JSON.parse(await readFile(new URL('@iconify-json/selfhst/icons.json', NM), 'utf8'))
  const out = []
  for (const [name, icon] of Object.entries(j.icons)) {
    if (/-(dark|light)$/.test(name)) continue // theme variants of the same logo
    const w = icon.width ?? j.width ?? 16
    const h = icon.height ?? j.height ?? 16
    out.push({ name, svg: `<svg viewBox="${icon.left ?? 0} ${icon.top ?? 0} ${w} ${h}">${icon.body}</svg>` })
  }
  return out
}

// ── keys ─────────────────────────────────────────────────────────────────────
/** Keys of one name, with whether every word of it is a common word. */
function keysOf(words, common) {
  const ws = words.map(iconKey).filter(Boolean)
  const out = []
  const push = (list) => {
    if (!list.length) return
    const key = list.join('')
    if (!key) return
    out.push({ key, generic: list.every((w) => common.has(w)) })
    if (key.length > 4 && key.endsWith('js')) {
      const bare = [...list]
      bare[bare.length - 1] = bare[bare.length - 1].replace(/js$/, '')
      if (!bare[bare.length - 1]) bare.pop()
      if (bare.length) out.push({ key: bare.join(''), generic: bare.every((w) => common.has(w)) })
    }
  }
  push(ws)
  let rest = ws
  while (rest.length > 1 && NAME_PREFIXES.includes(rest[0])) {
    rest = rest.slice(1)
    push(rest)
  }
  return out
}
const splitName = (s) => String(s).split(/[\s\-_/.]+/).filter(Boolean)

export async function generateIcons({ log = () => {} } = {}) {
  const common = commonWords()
  /** id → { data, wide } */
  const icons = new Map()
  /** key → candidates { id, rank, wide, generic } */
  const brand = new Map()
  const vendor = { aws: new Map(), azure: new Map(), gcp: new Map() }
  const offer = (map, key, cand) => {
    if (!key) return
    let l = map.get(key)
    if (!l) map.set(key, (l = []))
    l.push(cand)
  }
  const add = (id, e) => {
    if (e) icons.set(id, e)
    return e
  }

  // LikeC4 sets: every icon ships (the agent may name any of them).
  for (const set of LIKEC4_SETS) {
    const list = await likec4Set(set)
    log(`icons: ${set} ${list.length}`)
    for (const { name, svg } of list) {
      const id = `${set}:${name}`
      const e = add(id, entry(id, svg, set === 'bootstrap' ? 'g' : 'c'))
      if (!e || set === 'bootstrap') continue
      if (set === 'tech') {
        const iconVariant = name.endsWith('-icon')
        const words = splitName(iconVariant ? name.slice(0, -5) : name)
        // tech:aws-s3 and the like: the vendor's own set comes first.
        const rank = /^(aws|amazon|azure|google-cloud)-/.test(name) ? 60 : 10
        for (const k of keysOf(words, common)) offer(brand, k.key, { id, rank, sub: iconVariant ? 0 : 1, wide: e.wide, generic: k.generic })
        continue
      }
      // Cloud service icons.
      const v = set
      let words = splitName(name)
      while (words.length > 1 && ['aws', 'amazon', 'azure', 'microsoft', 'google'].includes(words[0])) words = words.slice(1)
      const forms = new Set()
      const ks = keysOf(words, common)
      for (const k of ks) forms.add(k.key)
      for (const f of [...forms]) {
        for (const suf of CLOUD_SUFFIXES) if (f.endsWith(suf) && f.length > suf.length + 2) forms.add(f.slice(0, -suf.length))
      }
      for (const f of [...forms]) if (f.length > 4 && f.endsWith('s') && !f.endsWith('ss')) forms.add(f.slice(0, -1))
      if (v === 'gcp') for (const f of [...forms]) if (f.startsWith('cloud') && f.length > 8) forms.add(f.slice(5))
      const full = ks[0]?.key
      for (const f of forms) {
        offer(vendor[v], f, { id, rank: 0, sub: f === full ? 0 : 1, wide: false, generic: false })
        for (const p of VENDORS[v].prefixes) offer(brand, p + f, { id, rank: 0, sub: f === full ? 0 : 1, wide: false, generic: false })
      }
      // A bare one-word service name ("Fargate"), when it is not a common word.
      if (words.length === 1 && full && !common.has(full)) offer(brand, full, { id, rank: 50, sub: 0, wide: false, generic: false })
    }
  }

  // Lobe (AI products): colour variant first, then the one-colour logo.
  const lobe = await lobeIcons()
  log(`icons: lobe ${lobe.length}`)
  const lobePending = new Map()
  for (const { name, svg } of lobe) {
    const m = /^(.*?)(-color|-brand-color|-brand)?$/.exec(name)
    const base = m[1]
    const sub = { '-color': 0, undefined: 1, '-brand-color': 2, '-brand': 3 }[m[2]] ?? 4
    const colour = m[2] === '-color' || m[2] === '-brand-color'
    const id = `lobe:${name}`
    lobePending.set(id, () => entry(id, svg, colour ? 'c' : 'm'))
    for (const k of keysOf(splitName(base), common)) offer(brand, k.key, { id, rank: 20, sub, wide: false, generic: k.generic })
  }

  // Simple Icons: one colour per brand.
  const si = await simpleIcons()
  log(`icons: simple-icons ${si.length}`)
  const siPending = new Map()
  for (const i of si) {
    const id = `si:${i.name}`
    const hex = /^[0-9a-f]{6}$/i.test(i.hex ?? '') ? '#' + i.hex : undefined
    siPending.set(id, () => entry(id, i.svg, 'm', hex))
    // Other names ("aka") only when long enough to be unambiguous ("VM" is not VictoriaMetrics).
    for (const title of [i.title, ...i.aka.filter((a) => iconKey(a).length >= 4)]) for (const k of keysOf(splitName(title), common)) offer(brand, k.key, { id, rank: 30, sub: title === i.title ? 0 : 1, wide: false, generic: k.generic })
    offer(brand, iconKey(i.name), { id, rank: 30, sub: 2, wide: false, generic: common.has(iconKey(i.name)) })
  }

  // selfh.st: self-hosted and infrastructure software.
  const sh = await selfhst()
  log(`icons: selfhst ${sh.length}`)
  const shPending = new Map()
  for (const { name, svg } of sh) {
    const id = `selfhst:${name}`
    shPending.set(id, () => entry(id, svg, 'c'))
    for (const k of keysOf(splitName(name), common)) offer(brand, k.key, { id, rank: 40, sub: 0, wide: false, generic: k.generic })
  }

  const pending = new Map([...lobePending, ...siPending, ...shPending])
  /** Materializes an icon of a lazily read set; returns whether it exists. */
  const ensure = (id) => {
    if (icons.has(id)) return true
    const make = pending.get(id)
    if (!make) return false
    const e = make()
    if (!e) return false
    icons.set(id, e)
    return true
  }

  // Pick one icon per key: square before wordmark, then set priority, then the preferred variant.
  const pick = (cands) => {
    const sorted = [...cands].sort((a, b) => (a.wide - b.wide) || (a.rank - b.rank) || (a.sub - b.sub) || (a.id.length - b.id.length) || (a.id < b.id ? -1 : 1))
    for (const c of sorted) if (ensure(c.id)) return { id: c.id, rank: c.rank, wide: c.wide, generic: cands.some((x) => x.generic) }
    return null
  }
  const out = { brand: {}, generic: [], vendor: { aws: {}, azure: {}, gcp: {} } }
  const picked = new Map()
  for (const [key, cands] of brand) {
    const p = pick(cands)
    if (p) picked.set(key, p)
  }
  // "apachekafka" follows "kafka" when a better set knows the short name.
  for (const [key, p] of picked) {
    for (const pre of NAME_PREFIXES) {
      if (!key.startsWith(pre) || key.length <= pre.length + 1) continue
      const short = picked.get(key.slice(pre.length))
      if (short && (short.wide - p.wide || short.rank - p.rank) < 0) picked.set(key, { ...short, generic: p.generic })
    }
  }
  for (const [key, p] of picked) {
    out.brand[key] = p.id
    if (p.generic) out.generic.push(key)
  }
  for (const v of Object.keys(vendor)) for (const [key, cands] of vendor[v]) {
    const p = pick(cands)
    if (p) out.vendor[v][key] = p.id
  }

  // Aliases override names.
  const missing = []
  const target = (t, map) => {
    if (t.startsWith('=')) return map[t.slice(1)] ?? out.brand[t.slice(1)]
    return ensure(t) ? t : undefined
  }
  // Two letters or less are never unambiguous, unless a rule says so (VENDOR_BARE).
  const generic = new Set([...out.generic, ...Object.keys(out.brand).filter((k) => k.length <= 2)])
  for (const [k, t] of Object.entries(ALIASES.brand)) {
    const id = target(t, out.brand)
    if (!id) missing.push(`brand ${k} → ${t}`)
    else {
      out.brand[k] = id
      if (common.has(k) || k.length <= 2) generic.add(k)
      else generic.delete(k)
    }
  }
  for (const v of Object.keys(vendor)) for (const [k, t] of Object.entries(ALIASES[v] ?? {})) {
    const id = target(t, out.vendor[v])
    if (!id) {
      missing.push(`${v} ${k} → ${t}`)
      continue
    }
    out.vendor[v][k] = id
    for (const p of VENDORS[v].prefixes) {
      out.brand[p + k] = id
      generic.delete(p + k)
    }
  }
  for (const v of Object.keys(VENDOR_BARE)) for (const k of VENDOR_BARE[v]) {
    const id = out.vendor[v][k]
    if (!id) {
      missing.push(`bare ${v} ${k}`)
      continue
    }
    out.brand[k] = id
    generic.delete(k)
  }
  out.generic = [...generic].filter((k) => out.brand[k]).sort()
  for (const g of GLYPHS) if (!icons.has(g)) missing.push(`glyph ${g}`)
  for (const [ext, t] of Object.entries(EXTENSIONS)) if (!out.brand[t.slice(1)]) missing.push(`extension .${ext} → ${t}`)
  if (missing.length) log(`icons: ${missing.length} rule target(s) not in the pack: ${missing.join(', ')}`)

  // Shards: every LikeC4 icon, plus the icons some key resolves to.
  const shards = Array.from({ length: SHARDS }, () => ({}))
  for (const [id, e] of [...icons].sort((a, b) => (a[0] < b[0] ? -1 : 1))) shards[shardOf(id)][id] = e.data
  const index = { v: PACK_VERSION, shards: SHARDS, ...out }
  const total = shards.reduce((n, s) => n + JSON.stringify(s).length, 0)
  log(`icons: ${icons.size} icons in ${SHARDS} shards (${(total / 1e6).toFixed(1)} MB), ${Object.keys(out.brand).length} product keys`)
  return { index, shards, missing }
}
