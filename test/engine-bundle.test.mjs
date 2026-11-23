// The engine bundles leave out LikeC4 dependencies they never run (build/stubs).
// Needs a build: run `cd build && node build.mjs` first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import picomatchStub from '../build/stubs/picomatch.mjs'
import { LikeC4ProjectConfigOps, isLikeC4JsonConfig } from '../build/stubs/likec4-config.mjs'
import { generate, print, ops } from '../build/stubs/likec4-generators.mjs'
import { getLogger, getConsoleSink } from '../build/stubs/logtape.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const assets = path.join(root, 'skills/dsh-diagram/assets')
const ENGINES = ['engine.mjs', 'engine.js', 'engine-offline.js']

// A string only each removed package contains (error messages, class names).
const REMOVED = {
  'zod': 'ZodError',
  'json5': 'JSON5: invalid',
  'picomatch': 'Expected pattern to be a non-empty string',
  '@logtape/logtape': 'LogTape',
  '@likec4/generators': 'Guard failed',
  '@likec4/config': 'likec4.config.mjs',
}

for (const file of ENGINES) {
  test(`${file} leaves out the LikeC4 dependencies the engine never runs`, () => {
    const code = readFileSync(path.join(assets, file), 'utf8')
    for (const [pkg, marker] of Object.entries(REMOVED)) assert.ok(!code.includes(marker), `${pkg} is back in ${file} (found ${JSON.stringify(marker)}); stub it in build/build.mjs`)
    assert.ok(code.includes('not available in dsh-diagram'), `${file} was built without build/stubs`)
  })
}

test('the offline engine stays below its size budget', () => {
  // 3.17 MB with the removed packages, 2.55 MB without them.
  const bytes = statSync(path.join(assets, 'engine-offline.js')).size
  assert.ok(bytes < 2_700_000, `engine-offline.js is ${bytes} bytes`)
})

test('the picomatch stub matches the default exclusion like picomatch and refuses anything else', () => {
  const picomatch = createRequire(path.join(root, 'build/package.json'))('picomatch')
  const real = picomatch('**/node_modules/**', { dot: true })
  const stub = picomatchStub('**/node_modules/**', { dot: true })
  for (const p of ['/workspace/diagram.c4', '/workspace/prelude.c4', '/node_modules/a.c4', '/a/node_modules/b/c.c4', 'node_modules/x.c4', '/a/node_modules', '/a/my_node_modules/b.c4', '/a/node_modules_x/b.c4', '/a/.node_modules/b.c4', '/.hidden/node_modules/.c4']) {
    assert.equal(stub(p), real(p), p)
  }
  assert.throws(() => picomatchStub('**/dist/**', { dot: true }), /not available in dsh-diagram/)
  assert.throws(() => picomatchStub('**/node_modules/**', { dot: true, contains: true }), /not available in dsh-diagram/)
})

test('stubbed functions the engine must never call throw loudly', () => {
  assert.equal(isLikeC4JsonConfig('/workspace/likec4.config.json'), true)
  assert.equal(isLikeC4JsonConfig('/workspace/diagram.c4'), false)
  assert.throws(() => LikeC4ProjectConfigOps.validate({ name: 'x' }), /not available in dsh-diagram/)
  assert.throws(() => LikeC4ProjectConfigOps.parse('{}'), /not available in dsh-diagram/)
  assert.throws(() => generate({}), /not available in dsh-diagram/)
  assert.throws(() => print('x'), /not available in dsh-diagram/)
  assert.throws(() => ops.views, /not available in dsh-diagram/)
  assert.throws(() => getConsoleSink()({}), /not available in dsh-diagram/)
  const logger = getLogger('likec4').getChild('lang')
  assert.deepEqual(logger.category, ['likec4', 'lang'])
  assert.equal(logger.warn`dropped`, undefined)
})
