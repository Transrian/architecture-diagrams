// Vocabulary contracts: pure source modules only, no generated engine or build needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { KINDS, RELATION_KINDS, STATES, MARKS } from '../src/core/vocab.js'
import { STATES as THEME_STATES, LEGEND } from '../src/viewer/theme.js'
import { translator, changeSummary, hiddenLinkSummary, traceSummary } from '../src/viewer/translation.js'
import { en, fr, zh } from '../src/viewer/copy.js'

const languages = { en, fr, zh }
const keys = (copy) => Object.keys(copy).sort()

test('theme states follow the vocabulary precedence and all have a colour', () => {
  assert.deepEqual(
    THEME_STATES.map(([state]) => state),
    STATES,
  )
  for (const [state, colour] of THEME_STATES) {
    assert.equal(typeof colour, 'string', `${state} has a theme colour`)
    assert.ok(colour.length > 0, `${state} has a non-empty theme colour`)
  }
})

test('the legend only references vocabulary states', () => {
  for (const state of LEGEND) assert.ok(STATES.includes(state), state)
})

test('UI translations have identical keys in every language', () => {
  for (const [locale, copy] of Object.entries(languages)) assert.deepEqual(keys(copy), keys(en), locale)
})

test('every language translates each vocabulary kind, state and mark', () => {
  for (const [locale, copy] of Object.entries(languages)) {
    for (const [prefix, values] of [
      ['kind', KINDS],
      ['state', STATES],
      ['mark', MARKS],
      ['relation', ['call', ...RELATION_KINDS, 'mixed']],
    ]) {
      for (const value of values) {
        const key = `${prefix}.${value}`
        assert.equal(typeof copy[key], 'string', `${locale}: ${key}`)
        assert.ok(copy[key].length > 0, `${locale}: ${key} is not empty`)
      }
    }
  }
})

test('every language translates provenance metadata', () => {
  for (const [locale, copy] of Object.entries(languages)) {
    assert.equal(typeof copy['meta.source'], 'string', locale)
    assert.ok(copy['meta.source'].length > 0)
  }
})

test('the README file-format table documents every state and mark', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const section = /^### File format\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/m.exec(readme)?.[1]
  assert.ok(section, 'the README contains the File format section')
  const relationKinds = section.split('\n').find((line) => line.startsWith('| relation kinds |'))
  assert.ok(relationKinds, 'the format table has a relation kinds row')
  for (const kind of RELATION_KINDS) assert.ok(relationKinds.includes(`-[${kind}]->`), kind)
  assert.ok(relationKinds.includes('`= data`'), 'element data and relation data are distinct')
  const metadata = section.split('\n').find((line) => line.startsWith('| metadata |'))
  assert.ok(metadata.includes('optional `source`'), 'provenance is optional, not a required confidence schema')
  for (const [name, values] of [
    ['states', STATES],
    ['marks', MARKS],
  ]) {
    const row = section.split('\n').find((line) => line.startsWith(`| ${name} |`))
    assert.ok(row, `the format table has a ${name} row`)
    for (const value of values) assert.ok(row.includes(`\`#${value}\``), value)
  }
})


test('UI counts use locale plural rules and keep placeholder coverage', () => {
  for (const [lang, singular, plural] of [['en', '1 result', '2 results'], ['fr', '1 résultat', '2 résultats'], ['zh', '1 个结果', '2 个结果']]) {
    const t = translator(lang)
    assert.equal(t('search.results', { n: 1 }), singular)
    assert.equal(t('search.results', { n: 2 }), plural)
    assert.ok(t('outline.hidden', { n: 1 }).includes(lang === 'en' ? '1 hidden element' : lang === 'fr' ? '1 élément masqué' : '1 个隐藏元素'))
    for (const n of [0, 1, 2]) {
      for (const key of ['count.assumed', 'trace.summary', 'trace.hidden', 'changes.removedList', 'chip.unfold', 'chip.goto', 'count.links'])
        assert.ok(!/[{}]/.test(t(key, { n, hidden: 0 })), `${lang}/${key}/${n}`)
      assert.ok(!/[{}]/.test(t('keyboard.focus', { count: n, title: 'Box', kind: 'group', state: 'planned' })))
    }
  }
  assert.equal(traceSummary(1, 1, translator('fr')), '1 élément, dont 1 non affiché individuellement dans cette vue')
  assert.equal(traceSummary(2, 2, translator('en')), '2 elements, 2 not shown individually in this view')
  assert.equal(translator('fr')('search.results', { n: 1_000_000 }), '1000000 résultats', 'many uses the other form')
  assert.equal(translator('en')('search.results', { n: 0 }), '0 results')
  assert.equal(translator('fr')('search.results', { n: 0 }), '0 résultat', 'French treats zero as singular')
  assert.equal(changeSummary({ added: 1, changed: 2, moved: 1, removed: 2 }, translator('fr')),
    '+1 ajouté · Δ2 modifiés · ↷1 déplacé · −2 retirés')
  assert.equal(hiddenLinkSummary(1, 2, translator('en')), '1 hidden internal link · 2 external links')
  assert.equal(translator('en')('count.assumedLinks', { n: 1, total: 1 }), '1 of 1 link assumed')
  for (const [lang, copy] of Object.entries(languages))
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value === 'string') continue
      const placeholders = (form) => [...form.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
      assert.deepEqual(placeholders(value.one), placeholders(value.other), `${lang}/${key} plural placeholders`)
    }
})

test('French copy uses a narrow non-breaking space before double punctuation', () => {
  for (const [key, entry] of Object.entries(fr)) {
    for (const value of typeof entry === 'string' ? [entry] : Object.values(entry)) {
      assert.doesNotMatch(value, /(^|[^\u202f])[:;?!]/u, `fr/${key}: ${value}`)
      assert.doesNotMatch(value, /[ \u00a0]\u202f[:;?!]/u, `fr/${key}: no duplicate spacing`)
    }
  }
})

test('theme labels own their punctuation and Chinese Explorer terminology is consistent', () => {
  assert.equal(translator('en')('header.themeValue', { value: 'Auto' }), 'Theme: Auto')
  assert.equal(translator('fr')('header.themeValue', { value: 'Auto' }), 'Thème\u202f: Auto')
  assert.equal(translator('zh')('header.themeValue', { value: '自动' }), '主题：自动')
  assert.equal(zh.explorer, '探索器')
  for (const key of ['keyboard.help', 'help.do.explorer', 'help.do.escape']) {
    assert.ok(zh[key].includes(zh.explorer), key)
    assert.ok(!zh[key].includes('浏览器'), key)
  }
})
