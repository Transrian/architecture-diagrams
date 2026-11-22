// Baseline selection depends on displayed accepted source, not pending reads or layouts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveComparisonBase } from '../src/comparison.js'

const history = ['0001-first.c4', '0002-second.c4', '0003-third.c4']
const texts = { [history[0]]: 'First accepted source\n', [history[1]]: 'Second accepted source\n', [history[2]]: 'Third accepted source\n' }
function reader(files = texts) {
  const reads = []
  const read = async (name) => {
    reads.push(name)
    if (!Object.hasOwn(files, name)) throw new Error(`Missing snapshot: ${name}`)
    return files[name]
  }
  return { reads, read }
}

function frozen(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child)
    Object.freeze(value)
  }
  return value
}

test('absent displayed source or fewer than two snapshots has no history and performs no reads', async () => {
  const { read, reads } = reader()
  for (const options of [
    {},
    { source: { text: texts[history[0]], pick: null } },
    { history: [], source: { text: '', pick: null } },
    { history: [history[0]], source: { text: texts[history[0]], pick: null } },
    { history: [history[0]], source: { text: texts[history[0]], pick: history[0] }, mode: 'first' },
    { history, source: null },
    { history, source: undefined, mode: 'chosen', chosen: history[0] },
  ]) assert.deepEqual(await resolveComparisonBase(options, read), { phase: 'no-history' })
  assert.deepEqual(reads, [])
})

test('default previous mode follows the displayed snapshot predecessor', async () => {
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: texts[history[2]], pick: history[2] } }, read), {
    phase: 'ready', name: history[1], text: texts[history[1]],
  })
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: texts[history[1]], pick: history[1] } }, read), {
    phase: 'ready', name: history[0], text: texts[history[0]],
  })
  assert.deepEqual(reads, [history[1], history[0]], 'selected snapshots need only the predecessor source')
})

test('the first displayed snapshot has no previous version, never a fictitious first diff', async () => {
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: texts[history[0]], pick: history[0] } }, read), { phase: 'no-previous' })
  assert.deepEqual(reads, [])
})

test('an unknown displayed snapshot is missing rather than silently compared to latest', async () => {
  const { read, reads } = reader()
  for (const pick of ['0000-removed.c4', '']) {
    assert.deepEqual(await resolveComparisonBase({ history, source: { text: texts[history[2]], pick } }, read), { phase: 'missing' })
  }
  assert.deepEqual(reads, [])
})

test('live mode waits for latest accepted snapshot text, then reads the penultimate baseline', async () => {
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: ` \n${texts[history[2]]}\t `, pick: null } }, read), {
    phase: 'ready', name: history[1], text: texts[history[1]],
  })
  assert.deepEqual(reads, [history[2], history[1]])
})

test('live source newer than snapshot history waits instead of treating latest as previous', async () => {
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: 'A newly displayed accepted edit', pick: null } }, read), { phase: 'waiting' })
  assert.deepEqual(reads, [history[2]], 'no baseline read or invented diff during synchronization')
})

test('snapshot history newer than displayed accepted source also waits', async () => {
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: texts[history[1]], pick: null } }, read), { phase: 'waiting' })
  assert.deepEqual(reads, [history[2]])
})

test('invalid pending edits do not displace the last valid displayed text matching latest history', async () => {
  const { read, reads } = reader()
  const source = { text: texts[history[2]], pick: null }
  const pendingInvalidText = '// diagram v1\nmodel { broken ='
  assert.notEqual(pendingInvalidText, source.text)
  assert.deepEqual(await resolveComparisonBase({ history, source, pendingText: pendingInvalidText }, read), {
    phase: 'ready', name: history[1], text: texts[history[1]],
  })
  assert.deepEqual(reads, [history[2], history[1]])
})

test('a pending slider pick never overrides the displayed source/pick pair', async () => {
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: texts[history[1]], pick: history[1] }, pick: history[2] }, read), {
    phase: 'ready', name: history[0], text: texts[history[0]],
  })
  assert.deepEqual(reads, [history[0]])
})

test('explicit first comparison reads the first snapshot even when live history is not synchronized', async () => {
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase({ history, source: { text: 'Pending accepted layout', pick: null }, mode: 'first' }, read), {
    phase: 'ready', name: history[0], text: texts[history[0]],
  })
  assert.deepEqual(reads, [history[0]], 'explicit bases do not probe latest live text')
})

test('explicit first or chosen may compare the displayed version with itself', async () => {
  const { read, reads } = reader()
  const source = { text: texts[history[0]], pick: history[0] }
  for (const mode of ['first', 'chosen']) {
    assert.deepEqual(await resolveComparisonBase({ history, source, mode, chosen: history[0] }, read), {
      phase: 'ready', name: history[0], text: texts[history[0]],
    })
  }
  assert.deepEqual(reads, [history[0], history[0]])
})

test('chosen comparison requires an existing name and returns its original source text', async () => {
  const { read, reads } = reader()
  const source = { text: texts[history[1]], pick: history[1] }
  assert.deepEqual(await resolveComparisonBase({ history, source, mode: 'chosen', chosen: history[2] }, read), {
    phase: 'ready', name: history[2], text: texts[history[2]],
  })
  for (const chosen of [undefined, null, 'missing.c4']) {
    assert.deepEqual(await resolveComparisonBase({ history, source, mode: 'chosen', chosen }, read), { phase: 'missing' })
  }
  assert.deepEqual(reads, [history[2]])
})

test('unknown comparison modes throw RangeError without reading a snapshot', async () => {
  const { read, reads } = reader()
  await assert.rejects(resolveComparisonBase({ history, source: { text: '', pick: null }, mode: 'latest' }, read), RangeError)
  await assert.rejects(resolveComparisonBase({ mode: 'unknown' }, read), RangeError)
  assert.deepEqual(reads, [])
})

test('snapshot reader failures propagate unchanged for live verification and all baseline modes', async () => {
  const failure = new Error('Cannot read accepted snapshot')
  const read = async () => { throw failure }
  const source = { text: texts[history[2]], pick: history[2] }
  for (const options of [
    { history, source: { ...source, pick: null } },
    { history, source },
    { history, source, mode: 'first' },
    { history, source, mode: 'chosen', chosen: history[0] },
  ]) await assert.rejects(resolveComparisonBase(options, read), (error) => error === failure)
  const baselineFailure = async (name) => name === history[2] ? texts[name] : Promise.reject(failure)
  await assert.rejects(resolveComparisonBase({ history, source: { ...source, pick: null } }, baselineFailure), (error) => error === failure)
})

test('history order is authoritative and the resolver never mutates its arguments', async () => {
  const input = frozen({ history: [history[2], history[0], history[1]], source: { text: texts[history[1]], pick: history[1] }, mode: 'previous' })
  const before = structuredClone(input)
  const { read, reads } = reader()
  assert.deepEqual(await resolveComparisonBase(input, read), { phase: 'ready', name: history[0], text: texts[history[0]] })
  assert.deepEqual(await resolveComparisonBase({ ...input, mode: 'first' }, read), { phase: 'ready', name: history[2], text: texts[history[2]] })
  assert.deepEqual(input, before)
  assert.deepEqual(reads, [history[0], history[2]])
})
