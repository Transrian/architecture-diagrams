// The hand-written skill document: frontmatter, commands, readability limits
// and vocabulary must match the engine. The example needs the built engine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { KINDS, RELATION_KINDS, STATES, MARKS, RULES } from '../src/core/vocab.js'
import { compute } from '../skills/dsh-diagram/assets/engine.mjs'

const skill = await readFile(new URL('../skills/dsh-diagram/SKILL.md', import.meta.url), 'utf8')
const lines = skill.split('\n')
const line = (prefix) => lines.find((l) => l.startsWith(prefix))

test('the skill has Agent Skills frontmatter named after its directory', () => {
  const frontmatter = /^---\nname: ([a-z0-9]+(?:-[a-z0-9]+)*)\ndescription: ([^\n]+)\n---\n/.exec(skill)
  assert.ok(frontmatter, 'valid lowercase skill name and one-line description')
  assert.equal(frontmatter[1], 'dsh-diagram')
  assert.ok(frontmatter[2].length > 0 && frontmatter[2].length <= 1024)
})

test('the skill runs its own script by absolute path', () => {
  for (const command of ['render', 'check', 'serve']) assert.ok(skill.includes(`\`node <this skill's directory>/scripts/diagram.mjs ${command} <file>\``), command)
  assert.ok(skill.includes('list `.diagram/*.c4`'))
  assert.ok(skill.includes('`file://` link'))
})

test('the skill names no former host', () => {
  assert.doesNotMatch(skill, /\b(?:DSH|plugin|tab|conversation|subagent)\b/)
})

test('the skill example is a valid diagram', async () => {
  const examples = [...skill.matchAll(/^```\n(\/\/ diagram v1\n[\s\S]*?)^```$/gm)].map((m) => m[1])
  assert.ok(examples.length > 0, 'the skill contains a fenced example with a format header')
  for (const example of examples) {
    const result = await compute(example)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.problems, [])
  }
})

test('the skill quotes the engine readability limits', () => {
  assert.ok(skill.includes(`At most ${RULES.children} children per group and ${RULES.depth} levels`))
  assert.ok(skill.includes(`schema > up to ${RULES.depth - 2} nested groups > leaf`))
  assert.ok(skill.includes(`title ≤ ${RULES.title} chars, description ≤ ${RULES.description}, technology ≤ ${RULES.technology}, relation label ≤ ${RULES.relation}`))
  assert.equal(RULES.elements, undefined, 'there is no global element cap')
})

test('the skill teaches every vocabulary kind, state and mark', () => {
  const kinds = line('- kinds: ')
  assert.ok(kinds, 'the skill contains a kinds list')
  for (const kind of KINDS) {
    assert.ok(skill.includes(`\`${kind}\``) || new RegExp(`\\b${kind}\\b`).test(kinds), kind)
  }
  for (const tag of [...STATES, ...MARKS]) assert.match(skill, new RegExp(`#${tag}\\b`), tag)
})

test('assumed is a state-combinable provenance mark taught with optional source metadata', () => {
  assert.ok(MARKS.includes('assumed'))
  assert.ok(!STATES.includes('assumed'), 'inference is not progress/runtime state')
  assert.match(line('- state tags,'), /#assumed combine with a state/)
  assert.match(line('- state tags,'), /inferred it, did not see it in code, config or output/)
  assert.ok(line('- metadata: ').includes('optional `source`'))
})

test('the skill teaches the two relation kinds and keeps data namespaces distinct', () => {
  assert.deepEqual(RELATION_KINDS, ['async', 'data'])
  const kinds = line('- relation kinds (optional): ')
  assert.ok(kinds, 'one compact relation-kind line')
  for (const kind of RELATION_KINDS) assert.ok(kinds.includes(`a -[${kind}]-> b`), kind)
  assert.match(kinds, /plain `->` is a call or use \(caller → callee\)/)
  assert.match(kinds, /producer → queue → consumer/)
  assert.match(kinds, /source → destination/)
  assert.ok(kinds.includes('`= data` declares an element'))
})
