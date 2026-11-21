import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync, symlinkSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const binary = path.join(root, 'bin/dsh-diagram.mjs')
const source = readFileSync(path.join(root, 'examples/web-shop.c4'), 'utf8')
const broken = '// diagram v1\nmodel {\n x = system\n'
function workspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dshd-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function run(args, options = {}) { return spawnSync(process.execPath, [binary, ...args], { cwd: root, encoding: 'utf8', timeout: 30_000, ...options }) }
function success(result, code = 0) { assert.equal(result.status, code, result.stdout + result.stderr); return result.stdout }

test('CLI help, version and usage errors', () => {
  assert.match(success(run(['--help'])), /install-skill/)
  assert.equal(success(run(['--version'])).trim(), JSON.parse(readFileSync(path.join(root, 'package.json'))).version)
  success(run(['unknown']), 2)
  success(run(['check']), 2)
  success(run(['render', 'x.c4', '--history-max', '-1']), 2)
  success(run(['serve', 'x.c4', '--port', '65536']), 2)
  success(run(['render', 'x.c4', '--lang', 'de']), 2)
  success(run(['check', 'missing.c4']), 2)
})

test('an unbuilt checkout gives a build hint while the skill still works', (t) => {
  const dir = workspace(t)
  for (const entry of ['bin', 'cli', 'prompt.js', 'report.js', 'history.js']) cpSync(path.join(root, entry), path.join(dir, entry), { recursive: true })
  mkdirSync(path.join(dir, 'src'))
  for (const helper of ['iconrules.js', 'html.js', 'shared.js', 'diff.js', 'vocab.js']) cpSync(path.join(root, 'src', helper), path.join(dir, 'src', helper))
  writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
  const file = path.join(dir, 'x.c4')
  writeFileSync(file, source)
  const invoke = (...args) => spawnSync(process.execPath, [path.join(dir, 'bin/dsh-diagram.mjs'), ...args], { encoding: 'utf8', timeout: 30_000 })
  assert.match(success(invoke('check', file), 2), /run "cd build && node build\.mjs" first/)
  assert.match(success(invoke('skill')), /name: dsh-diagram/)
  assert.ok(!existsSync(path.join(dir, 'x')))
})

test('check reports valid, broken and refused diagrams without writing anything', (t) => {
  const dir = workspace(t)
  const file = path.join(dir, 'x.c4')
  writeFileSync(file, source)
  assert.match(success(run(['check', file])), /\[diagram\].*valid/)
  writeFileSync(file, broken)
  assert.match(success(run(['check', file]), 1), /does not parse[\s\S]*:\d+:/)
  writeFileSync(file, `// diagram v1\nmodel {\n s = system 'S' {\n${Array.from({ length: 9 }, (_, i) => ` n${i} = service 'N${i}'`).join('\n')}\n }\n}`)
  assert.match(success(run(['check', file]), 1), /refused/)
  assert.deepEqual(readdirSync(dir), ['x.c4'])
})

test('render snapshots, deduplicates, ignores only .diagram and preserves valid output', (t) => {
  const dir = workspace(t)
  const diagrams = path.join(dir, '.diagram')
  mkdirSync(diagrams)
  const file = path.join(diagrams, 'x.c4')
  const html = path.join(diagrams, 'x.html')
  const history = path.join(diagrams, 'x')
  writeFileSync(file, source)
  assert.match(success(run(['render', file])), /HTML:.*x\.html[\s\S]*Open: file:/)
  assert.ok(existsSync(html))
  assert.ok(readFileSync(path.join(diagrams, '.gitignore'), 'utf8').split('\n').includes('*'))
  assert.equal(readdirSync(history).length, 1)
  success(run(['render', file]))
  assert.equal(readdirSync(history).length, 1)
  writeFileSync(file, source.replace('Web shop', 'Shop v2'))
  success(run(['render', file]))
  assert.equal(readdirSync(history).length, 2)
  const mtime = statSync(html).mtimeMs
  writeFileSync(file, broken)
  success(run(['render', file]), 1)
  assert.equal(statSync(html).mtimeMs, mtime)
  success(run(['render', file, '--force']), 1)
  assert.notEqual(statSync(html).mtimeMs, mtime)
  assert.equal(readdirSync(history).length, 2)
  const outside = path.join(dir, 'outside.c4')
  writeFileSync(outside, source)
  success(run(['render', outside, '--no-history', '--history-max', '0']))
  assert.ok(!existsSync(path.join(dir, '.gitignore')))
  assert.ok(!existsSync(path.join(dir, 'outside')))
  success(run(['render', outside, '-o', outside]), 2)
  assert.equal(readFileSync(outside, 'utf8'), source)
})

test('CLI compares against the accepted snapshot and check never writes history', (t) => {
  const dir = workspace(t)
  const file = path.join(dir, 'shop.c4')
  const history = path.join(dir, 'shop')
  writeFileSync(file, source)
  assert.doesNotMatch(success(run(['render', file])), /Changes since/)
  assert.doesNotMatch(success(run(['check', file])), /Changes since/, 'same snapshot has no phantom changes')
  writeFileSync(file, source.replace('Web shop', 'Shop v2'))
  assert.match(success(run(['check', file])), /Changes since v1: \+0 elements, −0, 1 changed; links \+0 −0/)
  assert.equal(readdirSync(history).length, 1, 'read-only check does not accept or snapshot the edit')
  assert.match(success(run(['render', file])), /Changes since v1:/)
  assert.equal(readdirSync(history).length, 2)
  assert.doesNotMatch(success(run(['render', file])), /Changes since/, 'deduplicated render has no phantom changes')
  assert.equal(readdirSync(history).length, 2)
})

test('CLI mass-deletion warning points to the previous snapshot but accepts the render', (t) => {
  const dir = workspace(t)
  const file = path.join(dir, 'shop.c4')
  const history = path.join(dir, 'shop')
  const diagram = (count) => `// diagram v1\nmodel {\n shop = system 'Shop' {\n${[0, 1].map((group) => ` g${group} = system 'Group ${group}' {\n${Array.from({ length: count }, (_, index) => ` n${index} = service 'Node ${index}'`).join('\n')}\n }`).join('\n')}\n }\n}`
  writeFileSync(file, diagram(6))
  success(run(['render', file]))
  const baseline = readdirSync(history)[0]
  writeFileSync(file, diagram(1))
  const note = success(run(['render', file]))
  assert.match(note, /Diagram v2 valid[\s\S]*Changes since v1: \+0 elements, −10/)
  assert.match(note, /Warning: mass deletion — 10 of 15 elements removed/)
  assert.ok(note.includes(`restore them from <${path.join(history, baseline)}>`))
  assert.equal(readdirSync(history).length, 2)
})

test('render without snapshots still ignores .diagram and rejects source directory aliases', (t) => {
  const dir = workspace(t)
  const diagrams = path.join(dir, '.diagram')
  mkdirSync(diagrams)
  const file = path.join(diagrams, 'x.c4')
  writeFileSync(file, source)
  success(run(['render', file, '--no-history']))
  assert.ok(existsSync(path.join(diagrams, '.gitignore')))
  assert.ok(!existsSync(path.join(diagrams, 'x')))
  if (process.platform !== 'win32') {
    const alias = path.join(dir, 'alias')
    symlinkSync(diagrams, alias)
    success(run(['render', file, '-o', path.join(alias, 'x.c4'), '--no-history']), 2)
    assert.equal(readFileSync(file, 'utf8'), source)
    const sourceLink = path.join(dir, 'source-link.c4')
    symlinkSync(file, sourceLink)
    success(run(['render', sourceLink, '-o', sourceLink, '--no-history']), 2)
    assert.equal(readFileSync(sourceLink, 'utf8'), source)
  }
})

test('skill installation respects ownership and command overrides', (t) => {
  const dir = workspace(t)
  const args = ['install-skill', '--to', dir, '--cli', 'my-diagram']
  success(run(args))
  const skill = path.join(dir, 'dsh-diagram/SKILL.md')
  assert.match(readFileSync(skill, 'utf8'), /my-diagram render/)
  success(run(args))
  writeFileSync(skill, 'Unrelated skill')
  success(run(args), 2)
  assert.equal(readFileSync(skill, 'utf8'), 'Unrelated skill')
  success(run([...args, '--force']))
  assert.match(success(run(['skill'], { env: { ...process.env, PATH: '' } })), /node ".*bin\/dsh-diagram\.mjs" render/)
  if (process.platform !== 'win32') {
    const binDir = path.join(dir, 'bin')
    mkdirSync(binDir)
    symlinkSync(binary, path.join(binDir, 'dsh-diagram'))
    assert.match(success(run(['skill'], { env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH } })), /`dsh-diagram render <file>`/)
  }
})

test('serve follows the file and exposes only allowlisted paths on loopback', { timeout: 30_000 }, async (t) => {
  const dir = workspace(t)
  const file = path.join(dir, 'x.c4')
  writeFileSync(file, source)
  const child = spawn(process.execPath, [binary, 'serve', file, '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let errors = ''
  child.stderr.on('data', (chunk) => { errors += chunk })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output} ${errors}`)), 10_000)
    child.once('error', (e) => { clearTimeout(timer); reject(e) })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${errors}`)) })
    child.stdout.on('data', (chunk) => {
      output += chunk
      const match = /Serving .* at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const get = (route, p) => fetch(new URL(route + (p === undefined ? '' : `?p=${encodeURIComponent(p)}`), url))
  assert.equal((await get('/')).status, 200)
  assert.match(await (await get('/')).text(), /<!doctype html>/)
  const first = await (await get('/api/stat', '.diagram/diagram.c4')).json()
  assert.ok(first.version)
  writeFileSync(file, source + '\n// Updated\n')
  const next = await (await get('/api/stat', '.diagram/diagram.c4')).json()
  assert.notEqual(first.version, next.version)
  assert.equal((await (await get('/api/read', '.diagram/diagram.c4')).json()).text, source + '\n// Updated\n')
  const history = await new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = async () => {
      try {
        const value = await (await get('/api/list', '.diagram/diagram')).json()
        if (value.entries.length) return resolve(value)
        if (Date.now() - start > 10_000) return reject(new Error(output))
        setTimeout(poll, 100)
      } catch (e) { reject(e) }
    }
    void poll()
  })
  assert.match(history.entries[0].name, /^0001-/)
  for (const p of ['../../etc/passwd', '.diagram/diagram/../../x', '.diagram/diagram/%2e%2e%2fx.c4', '.diagram/diagram.ref']) assert.equal((await get('/api/read', p)).status, 404, p)
  assert.equal((await get('/client.icons-1.js')).status, 404)
  assert.equal((await get('/api/stat', '.diagram/diagram.c4')).headers.get('cache-control'), 'no-store')
  assert.equal((await get('/client.likec4.js')).status, 200)
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  const rebound = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: { Host: 'rebinding.invalid' } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.once('error', reject)
    req.end()
  })
  assert.equal(rebound, 403)
  assert.equal((await get('/api/list', '.diagram/diagram/..')).status, 404)
  child.kill('SIGINT')
  await new Promise((resolve) => child.once('exit', resolve))
})
