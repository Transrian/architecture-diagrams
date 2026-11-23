// Provenance is orthogonal to state and link type; aggregation uses exact originals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compute, modelOf, STATES, MARKS, stateOf } from '../skills/dsh-diagram/assets/engine.mjs'
import { diffModels } from '../src/core/diff.js'

const inView = (result, scope) => result.views.find((view) => view.viewOf === scope)
const links = (model) => Object.values(model.relations)

const rollupSource = `// diagram v1
model {
  app = system 'App' {
    cluster = system 'Cluster' {
      #assumed
      plain = component 'Unverified' { #assumed }
      frozen = component 'Paused' { #frozen #assumed }
      deep = system 'Deep' {
        #frozen #assumed
        leaf = component 'Deep leaf' { #assumed }
      }
      confirmed = service 'Confirmed' { #done }
    }
    sink = service 'Sink'
    cluster.plain -> sink 'calls'
  }
}`
let rolled
const rollupResult = () => rolled ??= compute(rollupSource)

const aggregateSource = `// diagram v1
model {
  app = system 'App' {
    left = system 'Left' {
      emitter = service 'Emitter' {
        #planned #assumed
        metadata { source 'docs/design.md: publisher sketch' }
      }
      stable = service 'Stable'
    }
    right = system 'Right' {
      inbox = data 'Inbox'
      worker = service 'Worker' { #assumed }
    }
    left.emitter -[async]-> right.inbox 'known event' { #new }
    left.stable -[data]-> right.inbox 'inferred copy' {
      #frozen #assumed
      metadata {
        source 'docs/design.md: copy sketch'
        note 'Verify transfer configuration'
      }
    }
    left.stable -> right.worker 'retired call' { #removed #assumed }
    left.emitter -> right.worker 'plain call'
  }
}`
let aggregated
const aggregateResult = () => aggregated ??= compute(aggregateSource)

test('assumed is a mark, can stand alone and can combine with every state on elements and relations', async () => {
  assert.ok(MARKS.includes('assumed'))
  assert.ok(!STATES.includes('assumed'))
  assert.equal(stateOf(['assumed']), undefined)
  for (const state of [null, ...STATES]) {
    const tags = state ? `#${state} #assumed` : '#assumed'
    const source = `// diagram v1
model {
  app = system 'App' {
    inferred = component 'Inferred' { ${tags} }
    confirmed = service 'Confirmed'
    inferred -> confirmed 'calls' { ${tags} }
  }
}`
    const model = await modelOf(source)
    assert.ok(model, `valid tags: ${tags}`)
    assert.equal(model.elements['app.inferred'].state, state ?? undefined)
    assert.deepEqual(model.elements['app.inferred'].marks, ['assumed'])
    assert.equal(links(model)[0].state, state ?? undefined)
    assert.deepEqual(links(model)[0].marks, ['assumed'])
    assert.deepEqual(links(model)[0].metadata, {}, 'source provenance is optional')
  }
})

test('collapsed assumed counts include untagged/frozen descendants and exclude the group itself', async () => {
  const result = await rollupResult()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.problems, [])
  const cluster = inView(result, 'app').nodes.find((node) => node.id === 'app.cluster')
  assert.deepEqual(cluster.marks, ['assumed'])
  assert.equal(cluster.hidden, 5)
  assert.equal(cluster.assumedCount, 4, 'plain, frozen, deep group and deep leaf; not the cluster itself')
  assert.deepEqual(cluster.rollup, { count: 1, state: 'done', byState: { done: 1 } }, 'existing state rollup remains independent')
  const deep = inView(result, 'app.cluster').nodes.find((node) => node.id === 'app.cluster.deep')
  assert.equal(deep.assumedCount, 1)
  assert.equal(deep.state, 'frozen')
  assert.equal(deep.rollup, undefined, 'a no-state assumed descendant does not invent an active state')
})

test('unfolded frames do not claim hidden assumed descendants', async () => {
  const result = await compute(rollupSource, { expand: ['app.cluster'] })
  assert.deepEqual(result.errors, [])
  const cluster = inView(result, 'app').nodes.find((node) => node.id === 'app.cluster')
  assert.ok(cluster.children.length > 0)
  assert.equal(cluster.assumedCount, undefined)
  const deep = inView(result, 'app').nodes.find((node) => node.id === 'app.cluster.deep')
  assert.equal(deep.children.length, 0)
  assert.equal(deep.assumedCount, 1, 'the nested collapsed group still reports its own hidden descendants')
})

test('mixed aggregate marks/counts come from exact original relations in canonical mark order', async () => {
  const result = await aggregateResult()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.problems, [])
  const edge = inView(result, 'app').edges.find((edge) => edge.source === 'app.left' && edge.target === 'app.right')
  assert.equal(edge.count, 4)
  assert.equal(edge.assumedCount, 2)
  assert.deepEqual(edge.marks, ['new', 'removed', 'assumed'])
  assert.equal(edge.kind, 'mixed')
  assert.equal(edge.state, 'frozen')
  assert.equal(edge.mixed, true)
  const byTitle = Object.fromEntries(edge.relationList.map((relation) => [relation.title, relation]))
  assert.deepEqual(byTitle['known event'].marks, ['new'])
  assert.deepEqual(byTitle['inferred copy'].marks, ['assumed'])
  assert.deepEqual(byTitle['retired call'].marks, ['removed', 'assumed'])
  assert.deepEqual(byTitle['plain call'].marks, [])
  for (const view of result.views) {
    for (const edge of view.edges) {
      assert.equal(edge.assumedCount, edge.relationList.filter((relation) => relation.marks.includes('assumed')).length)
      assert.deepEqual(edge.marks, MARKS.filter((mark) => edge.relationList.some((relation) => relation.marks.includes(mark))))
    }
  }
})

test('assumed endpoints never infer assumed marks, counts or states onto an observed link', async () => {
  const source = `// diagram v1
model {
  app = system 'App' {
    left = service 'Left' { #assumed }
    right = service 'Right' { #planned #assumed }
    left -> right 'observed call'
  }
}`
  const result = await compute(source)
  assert.deepEqual(result.errors, [])
  const edge = inView(result, 'app').edges.find((edge) => edge.source === 'app.left' && edge.target === 'app.right')
  assert.deepEqual(edge.marks, [])
  assert.equal(edge.assumedCount, 0)
  assert.equal(edge.state, undefined)
  assert.deepEqual(edge.relationList[0].marks, [])
})

test('relation provenance and other metadata survive parse-only summaries and original-link details', async () => {
  const result = await aggregateResult()
  const parsed = await modelOf(aggregateSource)
  const original = links(parsed).find((relation) => relation.title === 'inferred copy')
  assert.deepEqual(original.metadata, { source: 'docs/design.md: copy sketch', note: 'Verify transfer configuration' })
  assert.equal(parsed.elements['app.left.emitter'].metadata.source, 'docs/design.md: publisher sketch')
  const edge = inView(result, 'app').edges.find((edge) => edge.source === 'app.left' && edge.target === 'app.right')
  const item = edge.relationList.find((relation) => relation.id === original.id)
  assert.deepEqual(item.metadata, original.metadata)
  assert.equal(item.sourceId, 'app.left.stable', 'endpoint identity remains separate from metadata.source provenance')
  assert.equal(item.targetId, 'app.right.inbox')
  assert.deepEqual(edge.relationList.find((relation) => relation.title === 'plain call').metadata, {})
})

test('source provenance changes are semantic relation edits, not new or removed links', async () => {
  const before = await modelOf(aggregateSource)
  const after = await modelOf(aggregateSource.replace('docs/design.md: copy sketch', 'config/transfer.yml: confirmed source'))
  const diff = diffModels(before, after)
  assert.deepEqual(diff.relations.added, [])
  assert.deepEqual(diff.relations.removed, [])
  assert.equal(diff.relations.changed.length, 1)
  assert.deepEqual(diff.relations.changed[0].fields, ['metadata'])
  assert.equal(diff.relations.changed[0].after.metadata.source, 'config/transfer.yml: confirmed source')
})
