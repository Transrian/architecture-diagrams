// @ts-check
import { en, fr, zh } from './copy.js'

/** @typedef {string | {one: string, other: string, pluralParam?: string}} Template */
/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */
/** @type {Record<string, Record<string, Template>>} */
export const dictionaries = { en, fr, zh }

/** @param {string} lang @returns {Translator} */
export function translator(lang) {
  const dictionary = dictionaries[lang]
  const plurals = new Intl.PluralRules(lang)
  return (key, params) => {
    const entry = dictionary[key] ?? key
    const form = typeof entry === 'string' ? null : plurals.select(Number(params?.[entry.pluralParam ?? 'n']))
    const template = typeof entry === 'string' ? entry : entry[form === 'one' ? 'one' : 'other']
    return params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template
  }
}

/** @param {Record<string, number>} counts @param {Translator} t */
export function changeSummary(counts, t) {
  return t('changes.summary', Object.fromEntries(
    ['added', 'changed', 'moved', 'removed'].map((field) => [field, t('changes.' + field, { n: counts[field] })]),
  ))
}

/** @param {number} internal @param {number} external @param {Translator} t */
export function hiddenLinkSummary(internal, external, t) {
  return t('count.hiddenLinks', {
    internal: t('count.internalLinks', { n: internal }),
    external: t('count.externalLinks', { n: external }),
  })
}

/** @param {number} n @param {number} hidden @param {Translator} t */
export function traceSummary(n, hidden, t) {
  return t('trace.summary', { n, hidden: t('trace.notShown', { n: hidden }) })
}
