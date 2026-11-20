// Picks the icon of every element, deterministically, from the generated
// index (build/icons.mjs) and the hand-written rules (iconrules.js). Pure:
// used by the engine on the Host and in the browser, and by the tests.
//
// Order, first hit wins:
//   1. `icon` written in the diagram (LikeC4 id), or `icon none`
//   2. the technology field, matched against product names
//   3. the title, matched more strictly; a file name by its extension
//   4. a generic glyph from the words of technology + title (queue, cache, DNS…)
//   5. a glyph of the element kind (leaves only)
// Cloud services ("Lambda", "Functions") resolve when the element or one of
// its groups names the vendor (AWS, Azure, GCP).
import { iconKey, VENDORS, GLYPH_WORDS, KIND_GLYPHS, EXTENSIONS } from './iconrules.js'

const MAX_GRAM = 5
const VERSION = /^v?\d+([.\-]\d+)*[a-z]?$/i

/** Words of a label, as keys; version numbers dropped. */
export function tokens(text) {
  return String(text ?? '')
    .split(/[\s\-_/\\:()[\]{}'"`’,;|&@!?<>=~*]+/)
    .map((w) => w.replace(/\.+$/, ''))
    .filter((w) => w && !VERSION.test(w))
    .map(iconKey)
    .filter(Boolean)
}

/** Parts of a technology field: "Kafka, Avro" or "Python / FastAPI" name two things. */
const parts = (tech) => String(tech ?? '').split(/\s*[,;|&]\s*|\s+\/\s+|\s\+\s/).filter((p) => p.trim())

/** Looks a word sequence up; `strict`: a common-word product only as the whole label. */
function lookup(keys, index, generic, vendors, strict) {
  const n = keys.length
  for (let len = Math.min(MAX_GRAM, n); len >= 1; len--) {
    for (let i = 0; i + len <= n; i++) {
      let k = keys.slice(i, i + len).join('')
      if (/^\d+$/.test(k)) continue
      // "Inferentia2", "OAuth2": the name without its trailing number.
      const bare = k.replace(/\d+$/, '')
      const forms = bare !== k && bare.length >= 3 ? [k, bare] : [k]
      let id = null
      for (const f of forms) {
        for (const v of vendors) {
          id = index.vendor?.[v]?.[f]
          if (id) return id
        }
        id = index.brand?.[f]
        if (id) {
          k = f
          break
        }
      }
      if (!id) continue
      const common = generic.has(k)
      if (!common) return id
      if (strict ? i === 0 && len === n : i === 0) return id
    }
  }
  return null
}

/** Vendors named by a text (`aws`, `azure`, `gcp`). */
function vendorsOf(text) {
  const keys = tokens(text)
  const grams = new Set(keys)
  for (let i = 0; i + 1 < keys.length; i++) grams.add(keys[i] + keys[i + 1])
  for (let i = 0; i + 2 < keys.length; i++) grams.add(keys[i] + keys[i + 1] + keys[i + 2])
  return Object.entries(VENDORS).filter(([, v]) => v.words.some((w) => grams.has(w))).map(([name]) => name)
}

const GLYPH_OF = new Map()
for (const [id, words] of GLYPH_WORDS) for (const w of words) if (!GLYPH_OF.has(w)) GLYPH_OF.set(w, id)
const GLYPH_RANK = new Map(GLYPH_WORDS.map(([id], i) => [id, i]))

/** Generic glyph from the words of a label (the most specific family wins). */
function glyphOf(text) {
  const keys = tokens(text)
  let best = null
  const consider = (k) => {
    const id = GLYPH_OF.get(k)
    if (id && (best === null || GLYPH_RANK.get(id) < GLYPH_RANK.get(best))) best = id
  }
  for (let len = 1; len <= 3; len++) for (let i = 0; i + len <= keys.length; i++) consider(keys.slice(i, i + len).join(''))
  return best
}

/** Product icon of one label, or null. `field`: 'technology' or 'title'. */
export function matchLabel(text, index, { field = 'technology', vendors = [], generic } = {}) {
  const gen = generic ?? new Set(index.generic ?? [])
  const list = field === 'technology' ? parts(text) : [text]
  for (const p of list) {
    const id = lookup(tokens(p), index, gen, vendors, field !== 'technology')
    if (id) return id
  }
  return null
}

const CLOUD_PREFIX = /^(aws|azure|gcp):/

/**
 * Icon of every element of a summarized model.
 * @param {{elements: Record<string, any>, order: string[]}} model
 * @param {any} index - generated icon index
 * @returns {Record<string, {icon: string|null, how: 'explicit'|'technology'|'title'|'file'|'word'|'kind'|'none'}>}
 */
export function resolveIcons(model, index) {
  const generic = new Set(index?.generic ?? [])
  const out = {}
  const ctx = {} // id → vendors in scope
  for (const id of model.order) {
    const el = model.elements[id]
    const own = vendorsOf(`${el.technology} ${el.title}`)
    if (el.icon && CLOUD_PREFIX.test(el.icon)) own.push(el.icon.split(':')[0])
    const vendors = [...new Set([...own, ...(el.parent ? ctx[el.parent] ?? [] : [])])]
    ctx[id] = vendors
    if (el.icon === 'none') {
      out[id] = { icon: null, how: 'none' }
      continue
    }
    if (el.icon && /^[a-z]+:[-\w]+$/.test(el.icon)) {
      out[id] = { icon: el.icon, how: 'explicit' }
      continue
    }
    if (!index) {
      out[id] = { icon: null, how: 'none' }
      continue
    }
    let icon = el.technology ? matchLabel(el.technology, index, { field: 'technology', vendors, generic }) : null
    if (icon) {
      out[id] = { icon, how: 'technology' }
      continue
    }
    icon = matchLabel(el.title, index, { field: 'title', vendors, generic })
    if (icon) {
      out[id] = { icon, how: 'title' }
      continue
    }
    const ext = /^[^\s]+\.([a-z0-9]+)$/i.exec(el.title.trim())?.[1]?.toLowerCase()
    const target = ext ? EXTENSIONS[ext] : undefined
    icon = target ? index.brand?.[target.slice(1)] ?? null : null
    if (icon) {
      out[id] = { icon, how: 'file' }
      continue
    }
    const leaf = el.children.length === 0
    if (el.kind === 'person' || !leaf) {
      out[id] = { icon: null, how: 'none' }
      continue
    }
    icon = glyphOf(`${el.technology} ${el.title}`)
    if (icon) {
      out[id] = { icon, how: 'word' }
      continue
    }
    icon = KIND_GLYPHS[el.kind] ?? null
    out[id] = { icon, how: icon ? 'kind' : 'none' }
  }
  return out
}
