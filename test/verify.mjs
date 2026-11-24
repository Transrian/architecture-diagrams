import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { preflightBrowser } from './support/browser.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = 'skills/dsh-diagram/scripts/diagram.mjs'
const isBrowserFile = file => path.dirname(path.resolve(root, file)) === path.join(root, 'test/browser')
const workers = () => Math.min(4, availableParallelism())
// Node's CLI sorts file arguments, which otherwise leaves long suites on the tail.
const longestFirst = [
  'test/browser/standalone.mjs', 'test/cli.test.mjs', 'test/scene-contract.test.mjs',
  'test/html.test.mjs', 'test/icons.test.mjs', 'test/zoom.test.mjs',
  'test/browser/exploration.mjs', 'test/browser/serve.mjs',
]

export function testFiles(mode = 'full') {
  if (!['full', 'core', 'browser'].includes(mode)) throw new Error(`Unknown test mode: ${mode}`)
  const files = (dir, suffix) => {
    const names = readdirSync(path.join(root, dir)).filter(name => name.endsWith(suffix)).map(name => `${dir}/${name}`)
    if (!names.length) throw new Error(`No tests found in ${dir}`)
    return names
  }
  const rank = file => {
    const index = longestFirst.indexOf(file)
    return index < 0 ? longestFirst.length : index
  }
  return [
    ...(mode === 'browser' ? [] : files('test', '.test.mjs')),
    ...(mode === 'core' ? [] : files('test/browser', '.mjs')),
  ].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export async function runTests(files, { concurrency = workers(), run, reporter, output = process.stdout } = {}) {
  assert.ok(files.length, 'No tests selected')
  assert.ok(Number.isInteger(concurrency) && concurrency > 0, 'Test concurrency must be a positive integer')
  if (files.some(isBrowserFile)) {
    assert.ok(process.env.DSHD_CHROMIUM, 'Set DSHD_CHROMIUM; browser tests must not be skipped')
  }
  run ??= (await import('node:test')).run
  reporter ??= (await import('node:test/reporters')).spec
  const results = run({ files: files.map(file => path.resolve(root, file)), concurrency })
  let failed = false, skipped = false
  results.on('test:fail', () => { failed = true })
  results.on('test:pass', test => { skipped ||= !!(test.skip || test.todo) })
  await pipeline(results.compose(reporter), output, { end: false })
  if (failed) throw new Error('Tests failed')
  if (skipped) throw new Error('Verification must not skip tests or leave TODOs')
}

export function verificationSteps(mode = 'full') {
  if (!['full', 'fast', 'browser'].includes(mode)) throw new Error(`Unknown verification mode: ${mode}`)
  const testMode = mode === 'fast' ? 'core' : mode
  return [
    ['Build the skill (CLI, viewer, engine, icons)', process.execPath, 'build/build.mjs'],
    ...(mode === 'browser' ? [] : [
      ['Validate examples', process.execPath, SCRIPT, 'check', 'examples/web-shop.c4'],
      ['Validate reference', process.execPath, SCRIPT, 'check', 'examples/reference.c4'],
    ]),
    [mode === 'full' ? 'All core and browser suites (bounded parallelism, no skips)' : mode === 'fast' ? 'Unit, CLI and scene contracts' : 'All browser suites (bounded parallelism, no skips)', process.execPath, 'test/verify.mjs', '--tests', testMode],
    ['Whitespace check (unstaged, staged and new files)', process.execPath, 'test/support/whitespace.mjs'],
  ]
}

export async function verify(mode = 'full', { env = process.env, preflight = preflightBrowser, run = spawnSync, log = console.log } = {}) {
  const steps = verificationSteps(mode)
  if (mode !== 'fast') await preflight(env)
  else log('CORE ONLY: browser tests are NOT being run')
  for (const [label, command, ...args] of steps) {
    log(`\n[verify] ${label}`)
    const started = performance.now()
    const result = run(command, args, { cwd: root, env, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}, signal ${result.signal ?? 'none'})`)
    log(`[verify] ${label} passed (${((performance.now() - started) / 1000).toFixed(1)}s)`)
  }
  log(mode === 'fast' ? '\n[verify] Core verification passed; browser coverage NOT checked' : '\n[verify] Verification passed; every browser suite ran')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  if (args.length === 2 && args[0] === '--tests') await runTests(testFiles(args[1]))
  else {
    const mode = args.length === 0 ? 'full' : args.length === 1 && args[0] === '--fast' ? 'fast' : args.length === 1 && args[0] === '--browser' ? 'browser' : null
    if (!mode) throw new Error('Usage: node test/verify.mjs [--fast|--browser|--tests core|browser|full]')
    await verify(mode)
  }
}
