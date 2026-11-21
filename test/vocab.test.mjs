// Vocabulary contracts: pure source modules only, no generated engine or build needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { KINDS, RELATION_KINDS, STATES, MARKS } from '../src/vocab.js'
import { STATES as THEME_STATES, LEGEND } from '../src/theme.js'
import { en, fr, zh, standalone } from '../src/copy.js'
import { formatGuide } from '../prompt.js'

const languages = { en, fr, zh }
const keys = (copy) => Object.keys(copy).sort()

test('theme states follow the vocabulary precedence and all have a colour', () => {
  assert.deepEqual(THEME_STATES.map(([state]) => state), STATES)
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

test('standalone translation overrides have identical keys in every language', () => {
  for (const locale of Object.keys(languages)) assert.deepEqual(keys(standalone[locale]), keys(standalone.en), locale)
})

test('every language translates each vocabulary kind, state and mark', () => {
  for (const [locale, copy] of Object.entries(languages)) {
    for (const [prefix, values] of [['kind', KINDS], ['state', STATES], ['mark', MARKS], ['relation', ['call', ...RELATION_KINDS, 'mixed']]]) {
      for (const value of values) {
        const key = `${prefix}.${value}`
        assert.equal(typeof copy[key], 'string', `${locale}: ${key}`)
        assert.ok(copy[key].length > 0, `${locale}: ${key} is not empty`)
      }
    }
  }
})

test('the format guide teaches every vocabulary kind, state and mark', () => {
  const guide = formatGuide()
  const kinds = guide.split('\n').find((line) => line.startsWith('- kinds: '))
  assert.ok(kinds, 'the guide contains a kinds list')
  for (const kind of KINDS) {
    assert.ok(guide.includes(`\`${kind}\``) || new RegExp(`\\b${kind}\\b`).test(kinds), kind)
  }
  for (const tag of [...STATES, ...MARKS]) assert.match(guide, new RegExp(`#${tag}\\b`), tag)
})

test('the format guide teaches the two relation kinds and keeps data namespaces distinct', () => {
  assert.deepEqual(RELATION_KINDS, ['async', 'data'])
  const guide = formatGuide()
  const line = guide.split('\n').find((line) => line.startsWith('- relation kinds (optional): '))
  assert.ok(line, 'one compact relation-kind line')
  for (const kind of RELATION_KINDS) assert.ok(line.includes(`a -[${kind}]-> b`), kind)
  assert.match(line, /plain `->` is a call or use \(caller → callee\)/)
  assert.match(line, /producer → queue → consumer/)
  assert.match(line, /source → destination/)
  assert.ok(line.includes('`= data` declares an element'))
})

test('the README file-format table documents every state and mark', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const section = /^### File format\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/m.exec(readme)?.[1]
  assert.ok(section, 'the README contains the File format section')
  const relationKinds = section.split('\n').find((line) => line.startsWith('| relation kinds |'))
  assert.ok(relationKinds, 'the format table has a relation kinds row')
  for (const kind of RELATION_KINDS) assert.ok(relationKinds.includes(`-[${kind}]->`), kind)
  assert.ok(relationKinds.includes('`= data`'), 'element data and relation data are distinct')
  for (const [name, values] of [['states', STATES], ['marks', MARKS]]) {
    const row = section.split('\n').find((line) => line.startsWith(`| ${name} |`))
    assert.ok(row, `the format table has a ${name} row`)
    for (const value of values) assert.ok(row.includes(`\`#${value}\``), value)
  }
})
