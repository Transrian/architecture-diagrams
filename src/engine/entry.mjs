// Public engine entry shared by CLI and browser bundles.
import { FORMAT, FORMAT_VERSION } from '../core/vocab.js'
import { PRELUDE, formatOf, orient } from './vocabulary.mjs'
import { cachedParse, quiet } from './parse.mjs'
import { load, collectErrors } from './load.mjs'
import { iconReport } from './model.mjs'
import { generateViews, decorate } from './views.mjs'
import { lint, advise } from './lint.mjs'

export { KINDS, RELATION_KINDS, STATES, MARKS, RULES, FORMAT, FORMAT_VERSION, ROOT_LEAF_KINDS } from '../core/vocab.js'
export { PRELUDE, formatOf, stateOf, orient } from './vocabulary.mjs'
export { setIconIndex, modelOf, iconIndexFor, iconIds } from './parse.mjs'
export { iconReport } from './model.mjs'
export { lint, advise } from './lint.mjs'

/**
 * Parse and lay out one diagram.
 * @param {string} source - the diagram's LikeC4 text (without the prelude).
 * @param {{direction?: string, flowDirection?: string, expand?: string[]}} [options] - expand: groups unfolded in place.
 * Dynamic views use direction unless flowDirection is supplied; explicit autoLayout rules always win.
 * @returns {Promise<{errors: any[], problems: any[], advisories: any[], views: any[], schemas: any[], extras: any[], model: any}>}
 */
export async function compute(source, options = {}) {
  quiet()
  const empty = { problems: [], advisories: [], views: [], schemas: [], extras: [], model: null }
  const version = formatOf(source)
  if (version !== FORMAT_VERSION) {
    return {
      errors: [
        {
          message:
            version === null
              ? `first line must be \`// ${FORMAT}\``
              : `this format version is not supported: this viewer reads \`// ${FORMAT}\``,
          line: 0,
          character: 1,
          file: 'diagram.c4',
        },
      ],
      ...empty,
    }
  }
  const { errors: parseErrors, model } = await cachedParse(source)
  const errors = [...parseErrors]
  if (!model) return { errors, ...empty }
  const expand = new Set(options.expand ?? [])
  const gen = generateViews(model, expand, source)
  let full = source + gen.text
  if (options.direction || options.flowDirection) full = orient(full, options.direction, options.flowDirection)
  let second
  let views = []
  try {
    second = await load({ 'prelude.c4': PRELUDE, 'diagram.c4': full })
    const sourceLines = source.split('\n').length
    errors.push(
      ...collectErrors(second).map((error) =>
        error.line >= sourceLines ? { ...error, message: 'generated views: ' + error.message, line: 0, character: 1 } : error,
      ),
    )
    if (!errors.length) views = await second.diagrams()
  } catch (e) {
    errors.push({ message: 'layout: ' + String(e?.message ?? e), line: 0, character: 0, file: 'diagram.c4' })
  } finally {
    try {
      await second?.dispose()
    } catch {}
  }
  decorate(views, model, gen.viewOfElement, gen.generated, expand)
  // The implicit landscape view only matters when there is no group at all.
  const shown = gen.schemas.length > 0 ? views.filter((v) => v.id !== 'index') : views
  // Unfolded views are bigger on purpose: only the diagram itself is checked.
  const problems = lint(model, source)
  const advisories = expand.size ? [] : advise(model, shown, source)
  const schemas =
    gen.schemas.length > 0 ? gen.schemas : views.some((v) => v.id === 'index') ? [{ view: 'index', element: null, title: '∗' }] : []
  return {
    errors,
    problems,
    advisories,
    views,
    schemas,
    extras: gen.extras,
    model,
    viewOfElement: gen.viewOfElement,
    icons: iconReport(model),
  }
}
