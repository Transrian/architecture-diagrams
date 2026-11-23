import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync, symlinkSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const binary = path.join(root, 'skills/dsh-diagram/scripts/diagram.mjs')
const source = readFileSync(path.join(root, 'examples/web-shop.c4'), 'utf8')
const broken = '// diagram v1\nmodel {\n x = system\n'
function workspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dshd-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function run(args, options = {}) { return spawnSync(process.execPath, [binary, ...args], { cwd: root, encoding: 'utf8', timeout: 30_000, ...options }) }
function success(result, code = 0) { assert.equal(result.status, code, result.stdout + result.stderr); return result.stdout }

test('CLI help and usage errors', () => {
  const help = success(run(['--help']))
  assert.match(help, /^Usage: node scripts\/diagram\.mjs <command>/)
  for (const command of ['check', 'render', 'serve']) assert.match(help, new RegExp(`^  ${command} <file\\.c4>`, 'm'), command)
  for (const removed of ['install-skill', 'skill', '--version']) success(run([removed]), 2)
  assert.match(help, /^  mcp  /m)
  success(run(['mcp', 'x.c4']), 2)
  success(run(['mcp', '--port', '1']), 2)
  success(run(['unknown']), 2)
  success(run(['check']), 2)
  success(run(['render', 'x.c4', '--history-max', '-1']), 2)
  success(run(['serve', 'x.c4', '--port', '65536']), 2)
  success(run(['render', 'x.c4', '--lang', 'de']), 2)
  success(run(['check', 'missing.c4']), 2)
})

test('an unbuilt checkout gives a build hint', (t) => {
  const dir = workspace(t)
  for (const entry of ['src/cli', 'src/core']) cpSync(path.join(root, entry), path.join(dir, entry), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
  const file = path.join(dir, 'x.c4')
  writeFileSync(file, source)
  const invoke = (...args) => spawnSync(process.execPath, [path.join(dir, 'src/cli/main.mjs'), ...args], { encoding: 'utf8', timeout: 30_000 })
  assert.match(success(invoke('check', file), 2), /run "cd build && node build\.mjs" first/)
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
  const get = (route) => fetch(new URL(route, url))
  assert.equal((await get('/')).status, 200)
  assert.match(await (await get('/')).text(), /<!doctype html>/)
  const first = await (await get('/api/source')).json()
  assert.equal(first.text, source)
  assert.ok(first.version)
  writeFileSync(file, source + '\n// Updated\n')
  const next = await (await get('/api/source')).json()
  assert.notEqual(first.version, next.version)
  assert.equal(next.text, source + '\n// Updated\n')
  const names = await new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = async () => {
      try {
        const value = await (await get('/api/history')).json()
        if (value.names.length) return resolve(value.names)
        if (Date.now() - start > 10_000) return reject(new Error(output))
        setTimeout(poll, 100)
      } catch (e) { reject(e) }
    }
    void poll()
  })
  assert.match(names[0], /^0001-/)
  assert.equal((await (await get(`/api/history/${names[0]}`)).json()).text, readFileSync(path.join(dir, 'x', names[0]), 'utf8'))
  for (const route of ['/api/history/..%2F..%2Fetc%2Fpasswd', '/api/history/../x.c4', '/api/history/%2e%2e%2fx.c4', '/api/history/x.ref', '/api/history/missing.c4', '/api/read', '/x.c4', '/engine.mjs', '/viewer.js']) assert.equal((await get(route)).status, 404, route)
  if (process.platform !== 'win32') {
    symlinkSync(file, path.join(dir, 'x', 'link.c4'))
    assert.equal((await get('/api/history/link.c4')).status, 404, 'a symlinked snapshot leaves the allowlist')
  }
  assert.equal((await get('/icons-1.js')).status, 404)
  assert.equal((await get('/icons-001.js')).status, 200)
  assert.equal((await get('/api/source')).headers.get('cache-control'), 'no-store')
  assert.equal((await get('/api/history')).headers.get('cache-control'), 'no-store')
  assert.equal((await get('/engine.js')).status, 200)
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  rmSync(file)
  assert.equal((await get('/api/source')).status, 404)
  const rebound = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: { Host: 'rebinding.invalid' } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.once('error', reject)
    req.end()
  })
  assert.equal(rebound, 403)
  child.kill('SIGINT')
  await new Promise((resolve) => child.once('exit', resolve))
})
