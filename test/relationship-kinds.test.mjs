// Relation semantics are modeled per original link, not copied from one aggregate member.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compute, modelOf, RELATION_KINDS, PRELUDE } from '../lib/likec4.mjs'
import { diffModels } from '../src/diff.js'

const source = `// diagram v1
model {
  app = system 'App' {
    left = system 'Left' { api = service 'API' }
    plain = system 'Plain' { api = service 'API' }
    uniform = system 'Uniform' { api = service 'API' }
    store = system 'Store' { records = data 'Records' }
    mixed = system 'Mixed' { api = service 'API' }
    partial = system 'Partial' { api = service 'API' }
    left.api -> plain.api 'calls once'
    left.api -> plain.api 'calls twice'
    left.api -[async]-> uniform.api 'event one' { #doing }
    left.api -[async]-> uniform.api 'event two' { #doing }
    left.api -[data]-> store.records 'copy one'
    left.api -[data]-> store.records 'copy two'
    left.api -[async]-> mixed.api 'event' { #done }
    left.api -[data]-> mixed.api 'copy' { #done }
    left.api -> partial.api 'call' { #planned }
    left.api -[async]-> partial.api 'message' { #done }
  }
}`
let result
const computed = () => result ??= compute(source)

test('relation kinds are declared without engine-specific styling', () => {
  assert.deepEqual(RELATION_KINDS, ['async', 'data'])
  for (const kind of RELATION_KINDS) assert.match(PRELUDE, new RegExp(`relationship ${kind} \\{\\}`))
  assert.doesNotMatch(PRELUDE, /relationship (?:async|data)\s*\{\s*(?:style|line|head|color)/)
})

test('relation summaries retain typed kinds, with null for plain calls', async () => {
  const result = await computed()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.problems, [])
  const byTitle = Object.fromEntries(Object.values(result.model.relations).map((relation) => [relation.title, relation]))
  assert.equal(byTitle['calls once'].kind, null)
  assert.equal(byTitle['event one'].kind, 'async')
  assert.equal(byTitle['copy one'].kind, 'data')
  assert.equal(byTitle['event one'].state, 'doing')
  assert.equal(result.model.elements['app.store.records'].kind, 'data', 'element/relationship namespaces remain distinct')
  assert.equal((await modelOf(source)).relations[byTitle['copy one'].id].kind, 'data', 'parse-only callers receive relation kinds')
})

test('uniform and mixed aggregates use every original kind, independently of mixed states', async () => {
  const result = await computed()
  const view = result.views.find((view) => view.viewOf === 'app')
  const edgeTo = (id) => view.edges.find((edge) => edge.source === 'app.left' && edge.target === 'app.' + id)
  assert.equal(edgeTo('plain').kind, null)
  assert.equal(edgeTo('uniform').kind, 'async')
  assert.equal(edgeTo('uniform').state, 'doing')
  assert.equal(edgeTo('uniform').mixed, false)
  assert.equal(edgeTo('store').kind, 'data')
  assert.equal(edgeTo('mixed').kind, 'mixed')
  assert.equal(edgeTo('mixed').state, 'done')
  assert.equal(edgeTo('mixed').mixed, false, 'same state does not imply same kind')
  assert.equal(edgeTo('partial').kind, 'mixed', 'plain calls count as a distinct kind')
  assert.equal(edgeTo('partial').state, 'planned')
  assert.equal(edgeTo('partial').mixed, true)
  assert.deepEqual(edgeTo('mixed').relationList.map((relation) => relation.kind), ['async', 'data'])
  assert.deepEqual(edgeTo('partial').relationList.map((relation) => relation.kind), [null, 'async'])
  for (const edge of view.edges) {
    for (const relation of edge.relationList) assert.equal(relation.kind, result.model.relations[relation.id].kind)
  }
})

test('semantic diffs flag changing a relation kind, not removing and re-adding a link', async () => {
  const before = await modelOf(source)
  const after = await modelOf(source.replace("left.api -> plain.api 'calls once'", "left.api -[async]-> plain.api 'calls once'"))
  const diff = diffModels(before, after)
  assert.equal(diff.relations.added.length, 0)
  assert.equal(diff.relations.removed.length, 0)
  assert.deepEqual(diff.relations.changed.map((relation) => relation.fields), [['kind']])
})

test('long typed relation labels report the matching original kind and endpoints', async () => {
  const title = 'This repeated relation label is deliberately too long'
  const source = `// diagram v1
model {
  app = system 'App' {
    api = service 'API'
    db = data 'Records'
    api -> db '${title}'
    api -[async]-> db '${title}'
    api -[data]-> db '${title}'
  }
}`
  const result = await compute(source)
  assert.deepEqual(result.errors, [])
  assert.equal(result.problems.length, 3)
  assert.deepEqual(result.problems.map((problem) => problem.line), [5, 6, 7])
})
