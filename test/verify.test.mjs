import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verify, verificationSteps } from './verify.mjs'
import { preflightBrowser } from './support/browser.mjs'
import { checkWhitespace } from './support/whitespace.mjs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('complete verification builds first and runs every browser suite serially', () => {
  const steps = verificationSteps()
  assert.equal(steps[0][2], 'build/build.mjs')
  const browser = steps.find(step => step[0].startsWith('All browser'))
  assert.ok(browser.includes('--test-concurrency=1'))
  for (const name of ['standalone', 'exploration']) assert.ok(browser.includes(`test/browser/${name}.mjs`))
  for (const example of ['examples/web-shop.c4', 'examples/reference.c4']) {
    assert.ok(steps.find(step => step[2] === 'skills/dsh-diagram/scripts/diagram.mjs' && step[3] === 'check' && step[4] === example), example)
  }
  assert.ok(steps.find(step => step.includes('test/zoom.test.mjs')))
  assert.equal(verificationSteps('fast').some(step => step.includes('test/browser/standalone.mjs')), false)
  assert.throws(() => verificationSteps('unknown'), /Unknown verification mode/)
})

test('missing browser prerequisites fail before any build or test is started', async () => {
  let runs = 0
  await assert.rejects(verify('full', { env: {}, run: () => { runs++; return { status: 0 } }, log: () => {} }), /DSHD_CHROMIUM/)
  assert.equal(runs, 0)
  await assert.rejects(preflightBrowser({ DSHD_CHROMIUM: '/definitely-absent-dshd-browser' }), /ENOENT/)
})

test('verification stops on the first failure, including process errors and signals', async () => {
  for (const failure of [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { error: new Error('spawn failed') }]) {
    let runs = 0
    await assert.rejects(verify('full', { preflight: async () => {}, run: () => { runs++; return failure }, log: () => {} }))
    assert.equal(runs, 1)
  }
})

test('verification preserves explicit environment and never downgrades a full run', async () => {
  const calls = [], env = { DSHD_CHROMIUM: '/chosen/browser' }
  await verify('full', { env, preflight: async value => assert.equal(value, env), run: (command, args, options) => {
    assert.equal(options.env, env)
    calls.push([command, ...args])
    return { status: 0 }
  }, log: () => {} })
  assert.equal(calls.length, verificationSteps().length)
})

test('whitespace checks cover new, unstaged and staged files without changing the index', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dshd-whitespace-'))
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(tmpdir()))
    assert.match(path.basename(dir), /^dshd-whitespace-/)
    await rm(dir, { recursive: true, force: true })
  })
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  git('init', '--quiet')
  const file = path.join(dir, 'new file.txt')
  await writeFile(file, 'bad \n')
  assert.throws(() => checkWhitespace(dir), /trailing whitespace/)
  assert.equal(git('diff', '--cached', '--name-only'), '')
  await writeFile(file, 'good\n')
  checkWhitespace(dir)
  git('add', '--', 'new file.txt')
  await writeFile(file, 'bad \n')
  assert.throws(() => checkWhitespace(dir), /trailing whitespace/)
  git('add', '--', 'new file.txt')
  await writeFile(file, 'good\n')
  assert.throws(() => checkWhitespace(dir), /trailing whitespace/)
  git('add', '--', 'new file.txt')
  checkWhitespace(dir)
})
