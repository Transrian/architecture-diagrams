import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { preflightBrowser } from './support/browser.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = 'skills/dsh-diagram/scripts/diagram.mjs'
export function verificationSteps(mode = 'full') {
  if (!['full', 'fast', 'browser'].includes(mode)) throw new Error(`Unknown verification mode: ${mode}`)
  const files = (dir, suffix) => {
    const names = readdirSync(path.join(root, dir)).filter(name => name.endsWith(suffix)).sort().map(name => `${dir}/${name}`)
    if (!names.length) throw new Error(`No tests found in ${dir}`)
    return names
  }
  return [
    ['Build the skill (CLI, viewer, engine, icons)', process.execPath, 'build/build.mjs'],
    ...(mode === 'browser' ? [] : [
      ['Validate examples', process.execPath, SCRIPT, 'check', 'examples/web-shop.c4'],
      ['Validate reference', process.execPath, SCRIPT, 'check', 'examples/reference.c4'],
      ['Unit, CLI and scene contracts', process.execPath, '--test', ...files('test', '.test.mjs')],
    ]),
    ...(mode === 'fast' ? [] : [['All browser suites (serial, no skips)', process.execPath, '--test', '--test-concurrency=1', ...files('test/browser', '.mjs')]]),
    ['Whitespace check (unstaged, staged and new files)', process.execPath, 'test/support/whitespace.mjs'],
  ]
}

export async function verify(mode = 'full', { env = process.env, preflight = preflightBrowser, run = spawnSync, log = console.log } = {}) {
  const steps = verificationSteps(mode)
  if (mode !== 'fast') await preflight(env)
  else log('CORE ONLY: browser tests are NOT being run')
  for (const [label, command, ...args] of steps) {
    log(`\n[verify] ${label}`)
    const result = run(command, args, { cwd: root, env, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}, signal ${result.signal ?? 'none'})`)
  }
  log(mode === 'fast' ? '\n[verify] Core verification passed; browser coverage NOT checked' : '\n[verify] Verification passed; every browser suite ran')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  const mode = args.length === 0 ? 'full' : args.length === 1 && args[0] === '--fast' ? 'fast' : args.length === 1 && args[0] === '--browser' ? 'browser' : null
  if (!mode) throw new Error('Usage: node test/verify.mjs [--fast|--browser]')
  await verify(mode)
}
