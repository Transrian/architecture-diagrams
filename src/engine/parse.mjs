import { configureLogger } from '@likec4/log'
import ICON_INDEX from '../../build/generated/icon-index.json'
import { iconIndexFor as reduceIndex } from './iconmatch.js'
import { FORMAT_VERSION } from '../core/vocab.js'
import { PRELUDE, formatOf } from './vocabulary.mjs'
import { load, collectErrors } from './load.mjs'
import { summarize } from './model.mjs'
let iconIndex = ICON_INDEX
/** Replaces the icon index (offline HTML); cached parses used the previous one. */
export function setIconIndex(index) {
  iconIndex = index ?? ICON_INDEX
  parsed.clear()
}

let configured = false
export function quiet() {
  if (configured) return
  configured = true
  try {
    configureLogger({ sinks: {}, loggers: [{ category: 'likec4', sinks: [], lowestLevel: 'fatal' }], reset: true })
  } catch {}
}

const parsed = new Map()

async function parseModel(source) {
  let first
  let phase = 'parse'
  try {
    first = await load({ 'prelude.c4': PRELUDE, 'diagram.c4': source })
    const errors = collectErrors(first)
    if (errors.length) return { errors, model: null }
    phase = 'model'
    return { errors, model: summarize(await first.computedModel(), iconIndex) }
  } catch (e) {
    return {
      errors: [{ message: phase + ': ' + String(e?.message ?? e), line: 0, character: 0, file: 'diagram.c4' }],
      model: null,
      retryable: true,
    }
  } finally {
    try {
      await first?.dispose()
    } catch {}
  }
}

export function cachedParse(source) {
  let first = parsed.get(source)
  if (!first) {
    first = parseModel(source)
    parsed.set(source, first)
    // An older, evicted promise must never remove a newer entry for this text.
    const forget = () => {
      if (parsed.get(source) === first) parsed.delete(source)
    }
    first.then((result) => {
      if (result.retryable) forget()
    }, forget)
    if (parsed.size > 8) parsed.delete(parsed.keys().next().value)
  }
  return first
}

/** Parsed summary only, or null for invalid input: no generated views or layout. */
export async function modelOf(source) {
  quiet()
  if (formatOf(source) !== FORMAT_VERSION) return null
  const { errors, model } = await cachedParse(source)
  return errors.length ? null : model
}

/** The icon-index entries these sources use: the same icons with a fraction of the index. */
export async function iconIndexFor(sources) {
  const models = []
  for (const source of new Set(sources)) models.push(await modelOf(source))
  return reduceIndex(models, iconIndex)
}

/** Icon ids from the parsed model only: no generated views or Graphviz layout. */
export async function iconIds(source) {
  quiet()
  if (formatOf(source) !== FORMAT_VERSION) return new Set()
  const { errors, model } = await cachedParse(source)
  return new Set(
    errors.length || !model
      ? []
      : Object.values(model.icons)
          .map((i) => i.icon)
          .filter(Boolean),
  )
}
