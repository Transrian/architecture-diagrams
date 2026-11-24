import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verify, verificationSteps, testFiles, runTests } from './verify.mjs'
import { preflightBrowser, frameClock, clockOf, advance, until, shown } from './support/browser.mjs'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { checkWhitespace } from './support/whitespace.mjs'
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('complete verification builds first and schedules every core and browser file exactly once', async () => {
  const steps = verificationSteps()
  assert.equal(steps[0][2], 'build/build.mjs')
  assert.deepEqual(steps.find(step => step.includes('--tests')).slice(2), ['test/verify.mjs', '--tests', 'full'])
  for (const example of ['examples/web-shop.c4', 'examples/reference.c4']) {
    assert.ok(steps.find(step => step[2] === 'skills/dsh-diagram/scripts/diagram.mjs' && step[3] === 'check' && step[4] === example), example)
  }
  const core = (await readdir(new URL('./', import.meta.url))).filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`)
  const browser = (await readdir(new URL('./browser/', import.meta.url))).filter(name => name.endsWith('.mjs')).map(name => `test/browser/${name}`)
  assert.deepEqual(testFiles('full').toSorted(), [...core, ...browser].sort())
  assert.deepEqual(testFiles('core').toSorted(), core.sort())
  assert.deepEqual(testFiles('browser').toSorted(), browser.sort())
  assert.equal(testFiles('full')[0], 'test/browser/standalone.mjs')
  assert.equal(testFiles('core')[0], 'test/cli.test.mjs')
  assert.equal(verificationSteps('fast').find(step => step.includes('--tests')).at(-1), 'core')
  assert.equal(verificationSteps('browser').find(step => step.includes('--tests')).at(-1), 'browser')
  assert.throws(() => verificationSteps('unknown'), /Unknown verification mode/)
  assert.throws(() => testFiles('unknown'), /Unknown test mode/)
})

test('test runner bounds workers, preserves failures and rejects skipped coverage', async () => {
  for (const [type, data, failure] of [
    ['test:pass', {}, null],
    ['test:fail', {}, /Tests failed/],
    ['test:pass', { skip: true }, /must not skip/],
    ['test:pass', { todo: 'unfinished' }, /must not skip/],
  ]) {
    let selected, reported = ''
    const output = new Writable({ write(chunk, encoding, done) { reported += chunk; done() } })
    const work = runTests(['test/zoom.test.mjs'], {
      concurrency: 2, output,
      run(options) {
        selected = options
        const results = Readable.from((async function* () {
          results.emit(type, data)
          yield { type, data }
        })())
        return results
      },
      reporter: async function* (events) { for await (const event of events) yield event.type },
    })
    if (failure) await assert.rejects(work, failure)
    else await work
    assert.equal(selected.concurrency, 2)
    assert.equal(selected.files[0], fileURLToPath(new URL('./zoom.test.mjs', import.meta.url)))
    assert.equal(reported, type)
    assert.equal(output.writableEnded, false, 'the runner must not close stdout')
    output.end()
  }
  await assert.rejects(runTests([]), /No tests selected/)
  await assert.rejects(runTests(['test/zoom.test.mjs'], { concurrency: 0 }), /positive integer/)
  const chromium = process.env.DSHD_CHROMIUM
  try {
    delete process.env.DSHD_CHROMIUM
    await assert.rejects(runTests(['test/browser/serve.mjs']), /DSHD_CHROMIUM/)
  } finally {
    if (chromium === undefined) delete process.env.DSHD_CHROMIUM
    else process.env.DSHD_CHROMIUM = chromium
  }
})

test('test runner propagates worker and reporter stream errors', async () => {
  for (const inReporter of [false, true]) {
    const failure = new Error(inReporter ? 'reporter failed' : 'worker stream failed')
    const output = new Writable({ write(chunk, encoding, done) { done() } })
    await assert.rejects(runTests(['test/zoom.test.mjs'], {
      output,
      run: () => Readable.from((async function* () { if (!inReporter) throw failure })()),
      reporter: async function* (events) {
        if (inReporter) throw failure
        for await (const event of events) yield String(event)
      },
    }), error => error === failure)
  }
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

test('verification reports elapsed time for every successful phase', async () => {
  const logs = []
  await verify('full', { preflight: async () => {}, run: () => ({ status: 0 }), log: message => logs.push(message) })
  for (const [label] of verificationSteps()) {
    const line = logs.find(message => message.startsWith(`[verify] ${label} passed (`))
    assert.match(line ?? '', / passed \(\d+\.\d+s\)$/)
  }
})

test('controlled browser clocks advance every timer without autonomous background ticks', async () => {
  const ticks = [], setup = []
  const page = { clock: {
    install: async options => setup.push(options.time),
    pauseAt: async time => setup.push(time),
    runFor: async ms => ticks.push(ms),
  } }
  const clock = await frameClock(page)
  assert.equal(clockOf(page), clock)
  assert.equal(setup[1] - setup[0], 1000)
  assert.deepEqual(ticks, [])
  await advance(page, 64)
  assert.deepEqual(ticks, [64])
  assert.throws(() => clockOf({}), /no configured frame clock/)
})

test('paused-clock condition and visibility waits advance frames instead of hanging', async () => {
  let time = 0
  const page = {
    clock: { install: async () => {}, pauseAt: async () => {}, runFor: async ms => { time += ms } },
    evaluate: async (condition, target) => time >= target,
  }
  await frameClock(page)
  await until(page, () => {}, 192)
  assert.equal(time, 192)
  await shown(page, { isVisible: async () => time >= 288, toString: () => 'target' })
  assert.equal(time, 288)
})

test('frame-clock failures propagate without retries', async () => {
  const ticks = [], failure = new Error('timer failed')
  const page = { clock: {
    install: async () => {}, pauseAt: async () => {},
    runFor: async ms => {
      ticks.push(ms)
      if (ms === 64) throw failure
      await new Promise(setImmediate)
    },
  } }
  await frameClock(page)
  await assert.rejects(advance(page, 64), error => error === failure)
  assert.deepEqual(ticks, [64])
})

test('real-time browser clocks leave browser timers untouched', async () => {
  const waits = [], page = { waitForTimeout: async ms => waits.push(ms) }
  await frameClock(page, { controlled: false })
  await advance(page, 123)
  assert.deepEqual(waits, [123])
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
