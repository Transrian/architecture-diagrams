// Icon pack generator, run by build.mjs. Merges several npm icon sets into
//   generated/icon-index.json   product name → icon id, bundled into the engine
//   shards (256 JSON objects)   icon id → SVG, one module-loader chunk each,
//                               loaded by the browser only for the icons shown
// Sources, by priority when two sets know the same product:
//   aws:, azure:, gcp:, tech:, bootstrap:  @likec4/icons (the ids LikeC4's `icon` accepts)
//   lobe:                                  @lobehub/icons-static-svg (AI products)
//   si:                                    simple-icons (brand logos, one colour)
//   selfhst:                               @iconify-json/selfhst (self-hosted and infra software)
// Nothing here reaches the network at run time: everything ships in the plugin.
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { iconKey, shardOf, SHARDS, PACK_VERSION, VENDORS, VENDOR_BARE, NAME_PREFIXES, CLOUD_SUFFIXES, ALIASES, GLYPHS, GLYPH_WORDS, TECH_WORDS, EXTENSIONS } from '../src/iconrules.js'

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
  const m = /<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(text.trim())
  if (!m) return null
  const attrs = {}
  for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2]
  let vb = attrs.viewBox?.trim().split(/[\s,]+/).map(Number)
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) {
    const w = Number.parseFloat(attrs.width)
    const h = Number.parseFloat(attrs.height)
    if (!(w > 0 && h > 0)) return null
    vb = [0, 0, w, h]
  }
  return { vb, body: m[2], attrs }
}

/** Drops what an inline icon must not carry; scopes ids so two icons on one page do not share gradients. */
function clean(body, scope) {
  let b = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(title|desc|metadata|script|foreignObject)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const ids = [...b.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  for (const id of new Set(ids)) {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const to = `${scope}-${id}`
    b = b.replace(new RegExp(`\\bid="${e}"`, 'g'), `id="${to}"`)
      .replace(new RegExp(`url\\(\\s*['"]?#${e}['"]?\\s*\\)`, 'g'), `url(#${to})`)
      .replace(new RegExp(`((?:xlink:)?href)="#${e}"`, 'g'), `$1="#${to}"`)
  }
  // A <style> inside an inline SVG applies to the whole page: scope its classes,
  // and drop rules that do not select a class (they would restyle other icons).
  if (/<style\b/i.test(b)) {
    const classes = new Set([...b.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))
    b = b.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) => {
      const rules = css.replace(/<!\[CDATA\[|\]\]>/g, '').match(/[^{}]+\{[^{}]*\}/g) ?? []
      const kept = rules.map((r) => {
        const [sel, decl] = r.split('{')
        const sels = sel.split(',').map((x) => x.trim()).filter((x) => /^\.[\w-]+$/.test(x) && classes.has(x.slice(1)))
        return sels.length ? `${sels.map((x) => `.${scope}-${x.slice(1)}`).join(',')}{${decl}` : ''
      }).join('')
      return kept ? open + kept + close : ''
    })
    b = b.replace(/\bclass="([^"]+)"/g, (_, c) => `class="${c.split(/\s+/).filter(Boolean).map((x) => `${scope}-${x}`).join(' ')}"`)
  }
  return b
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
  const keep = KEEP_ROOT.filter((k) => p.attrs[k] !== undefined && (mode === 'c' ? !(k === 'fill' && p.attrs[k] === 'currentColor') : k !== 'fill' && k !== 'opacity')).map((k) => `${k}="${p.attrs[k]}"`)
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
