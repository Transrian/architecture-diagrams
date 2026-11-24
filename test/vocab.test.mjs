// Vocabulary contracts: pure source modules only, no generated engine or build needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { KINDS, RELATION_KINDS, STATES, MARKS } from '../src/core/vocab.js'
import { STATES as THEME_STATES, LEGEND } from '../src/viewer/theme.js'
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
