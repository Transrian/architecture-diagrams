// Verdict formatting and accepted-version history. Needs the built engine (RULES).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { errorReport, refusalReport, okReport } from '../src/cli/report.mjs'
import { ensureIgnored, lastSnapshot, differsFromLastSnapshot, snapshot, GITIGNORE } from '../src/cli/history.mjs'
import { RULES } from '../skills/dsh-diagram/assets/engine.mjs'

test('parse and refusal reports keep locations and truncation', () => {
  const errors = [
    { line: 2, character: 4, message: 'Unexpected token' },
    { line: 8, character: 0, message: 'Expected closing brace' },
  ]
  assert.equal(errorReport({ rel: '.diagram/S.c4', errors, maxErrors: 1 }), [
    '[diagram] .diagram/S.c4 does not parse. Fix them now:',
    '  .diagram/S.c4:3:4  Unexpected token',
    '  (+1 more)',
    'Reminder: first line `// diagram v1`; tags go first inside braces; ids use letters/digits/_; no `specification` block needed.',
  ].join('\n'))
  assert.equal(refusalReport({ rel: '.diagram/S.c4', problems: errors, rules: RULES, maxErrors: 1 }), [
    '[diagram] .diagram/S.c4 refused: hard for the user to read (not kept as a version). Fix it now:',
    '  .diagram/S.c4:3  Unexpected token',
    '  (+1 more)',
    `Rules: architecture only (no task/proof boxes), every element inside a schema group except person/external, titles ≤${RULES.title} chars, description ≤${RULES.description}, technology ≤${RULES.technology}, relation label ≤${RULES.relation}, detail in metadata.`,
  ].join('\n'))
})

test('valid reports list schemas, drill-downs, flows and notes without carrying state', () => {
  const result = {
    views: [{ id: 'shop_view', nodes: [{}, {}] }],
    viewOfElement: { shop: 'shop_view', 'shop.api': 'api_view' },
    schemas: [{ element: 'shop', view: 'shop_view', title: 'Web shop' }],
    extras: [{ title: 'Checkout' }],
  }
  const icons = 'Icons: a neutral icon hint.'
  assert.equal(okReport({ result, version: 2, icons }), [
    '[diagram] Diagram v2 valid: Web shop (2 boxes), 1 drill-down view(s), flows: Checkout.',
    icons,
  ].join('\n'))
  const text = '[diagram] Diagram valid: Web shop (2 boxes), 1 drill-down view(s), flows: Checkout.\n' + icons
  assert.equal(okReport({ result, icons }), text)
  assert.equal(okReport({ result, icons }), text, 'icon line repetition is up to the caller')
  assert.equal(okReport({ result: { views: [], schemas: [], extras: [] } }), '[diagram] Diagram valid: no schema.')
})

async function workspace(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-diagram-shared-'))
  t.after(async () => {
    // Verify the resolved cleanup target is precisely this test's temporary workspace.
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()))
    assert.match(path.basename(dir), /^dsh-diagram-shared-/)
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

test('history uses explicit directories, unchanged names and source deduplication', async (t) => {
  const dir = path.join(await workspace(t), 'history')
  const source = '// diagram v1\nmodel {}\n'
  assert.deepEqual(await lastSnapshot(dir), { count: 0 })
  assert.equal(await differsFromLastSnapshot(dir, source), true)
  assert.equal(await snapshot(dir, source), 1)
  const first = await lastSnapshot(dir)
  assert.equal(first.count, 1)
  assert.equal(first.index, 1)
  assert.match(first.last, /^0001-\d{8}T\d{6}Z\.c4$/)
  assert.equal(await readFile(path.join(dir, first.last), 'utf8'), source)
  assert.equal(await differsFromLastSnapshot(dir, source), false)
  assert.equal(await snapshot(dir, source), 1)
  assert.equal((await readdir(dir)).length, 1)
  const changed = source + '// Updated\n'
  assert.equal(await differsFromLastSnapshot(dir, changed), true)
  assert.equal(await snapshot(dir, changed), 2)
  const second = await lastSnapshot(dir)
  assert.equal(second.count, 2)
  assert.equal(second.index, 2)
  assert.match(second.last, /^0002-\d{8}T\d{6}Z\.c4$/)
  assert.equal(await readFile(path.join(dir, second.last), 'utf8'), changed)
})

test('ignore creation preserves existing files', async (t) => {
  const dir = await workspace(t)
  const created = path.join(dir, '.diagram')
  await ensureIgnored(created)
  assert.equal(await readFile(path.join(created, '.gitignore'), 'utf8'), GITIGNORE)
  assert.equal(GITIGNORE, '# Created by dsh-diagram: diagrams can name internal hosts and stay out of git.\n*\n')
  await ensureIgnored(created)
  assert.equal(await readFile(path.join(created, '.gitignore'), 'utf8'), GITIGNORE)
  const existing = path.join(dir, 'existing')
  await mkdir(existing)
  await writeFile(path.join(existing, '.gitignore'), '# Keep these rules\n*.c4\n')
  await ensureIgnored(existing)
  assert.equal(await readFile(path.join(existing, '.gitignore'), 'utf8'), '# Keep these rules\n*.c4\n')
})

test('snapshot indices remain monotonic beyond four digits', async (t) => {
  const dir = path.join(await workspace(t), 'history')
  await mkdir(dir)
  await writeFile(path.join(dir, '9999-x.c4'), 'older')
  await writeFile(path.join(dir, '10000-y.c4'), 'newest')
  assert.deepEqual(await lastSnapshot(dir), { count: 2, last: '10000-y.c4', index: 10000 })
  assert.equal(await differsFromLastSnapshot(dir, 'newest'), false)
  assert.equal(await snapshot(dir, 'newest'), 10000)
  assert.equal(await snapshot(dir, 'next'), 10001)
  assert.equal((await lastSnapshot(dir)).index, 10001)
})
