// Host half (index.js) against a fake DSH context: prompt, verdicts, history,
// previews and the self-ignoring diagram directory. Needs the built engine:
// run `cd build && node build.mjs` first, then `node --test test/`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, promptText } from '../index.js'
import { compute } from '../lib/likec4.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const example = readFileSync(path.join(root, 'examples/web-shop.c4'), 'utf8')

/** Mounts the host half on a fake context and returns a "run one tool call" helper. */
function mount(sessions, config = {}) {
  const handlers = {}
  let section
  const ctx = {
    on: (name, fn) => (handlers[name] = fn),
    inject: (_deps, fn) => fn({ systemPrompt: { section: (s) => (section = s) } }),
    agents: { get: (id) => (sessions[id] ? { session: sessions[id] } : undefined) },
    logger: { warn: () => {} },
  }
  apply(ctx, config)
  const call = async (session) => {
    const out = await handlers['tools/post-execute']({ agent: { session } }, { content: [] }, async () => ({ kind: 'accept', value: undefined, content: [] }))
    return out.content.map((c) => c.text).join('\n')
  }
  return { call, prompt: (session) => section.text({ agent: { session } }), handlers }
}

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-diagram-'))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the prompt names the diagram file and the format header', () => {
  const text = promptText({ file: '/w/.diagram/s.c4', isSub: false })
  assert.match(text, /File: \/w\/\.diagram\/s\.c4/)
  assert.match(text, /`\/\/ diagram v1`/)
  assert.match(text, /\[Diagram\]\(<\/w\/\.diagram\/s\.c4>\)/, 'asks for a link that opens the tab')
  assert.doesNotMatch(text, /preview/i, 'no previews by default')
  assert.doesNotMatch(text, /subagent:/)
  assert.match(promptText({ file: '/w/.diagram/s.c4', isSub: false }, { previews: true }), /SVG preview paths/)
})

test('the example in the prompt is itself a valid diagram', async () => {
  const text = promptText({ file: '/w/.diagram/s.c4', isSub: false })
  const r = await compute(text.slice(text.indexOf('// diagram v1\nmodel')))
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.problems, [])
})

test('a valid diagram is versioned, linked, and its directory ignores itself', async () => {
  const cwd = workspace()
  const session = { id: 's1', header: { cwd, origin: 'user' } }
  const { call, prompt } = mount({ s1: session })
  assert.match(prompt(session), new RegExp(`File: ${cwd}/\\.diagram/s1\\.c4`))
  assert.equal(await call(session), '', 'no diagram yet: no note')

  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/s1.c4'), example)
  const note = await call(session)
  assert.match(note, /^\[diagram\] Diagram v1 valid/)
  assert.match(note, /Web shop \(6 boxes\), Delivery \(4 boxes\)/)
  assert.ok(note.includes(`[Diagram](<${path.join(cwd, '.diagram/s1.c4')}>)`), 'the note carries the link to the tab')
  assert.equal(readFileSync(path.join(cwd, '.diagram/.gitignore'), 'utf8').split('\n').includes('*'), true)
  assert.equal(readdirSync(path.join(cwd, '.diagram/s1')).filter((n) => n.endsWith('.c4')).length, 1)
  assert.equal(existsSync(path.join(cwd, '.diagram/s1/previews')), false, 'no previews by default')
  assert.doesNotMatch(note, /Preview/)

  assert.equal(await call(session), '', 'unchanged file: no new note')
})

test('with `previews`, each accepted version gets SVG previews named in the note', async () => {
  const cwd = workspace()
  const session = { id: 'p1', header: { cwd, origin: 'user' } }
  const { call, prompt } = mount({ p1: session }, { previews: true })
  assert.match(prompt(session), /SVG preview paths/)
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/p1.c4'), example)
  const note = await call(session)
  const svg = path.join(cwd, '.diagram/p1/previews/v1-diagram_shop.svg')
  assert.ok(existsSync(svg))
  assert.ok(note.includes(`![Web shop](<${svg}>)`))
})

test('a flat diagram is refused and not versioned', async () => {
  const cwd = workspace()
  const session = { id: 's2', header: { cwd, origin: 'user' } }
  const { call } = mount({ s2: session })
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/s2.c4'), "// diagram v1\nmodel {\n  a = component 'A'\n}\n")
  const note = await call(session)
  assert.match(note, /refused/)
  assert.match(note, /sits alone at the root/)
  assert.equal(existsSync(path.join(cwd, '.diagram/s2')), false)
})

test('syntax errors are reported with file:line', async () => {
  const cwd = workspace()
  const session = { id: 's3', header: { cwd, origin: 'user' } }
  const { call } = mount({ s3: session })
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/s3.c4'), "// diagram v1\nmodel {\n  s = system 'S' {\n")
  assert.match(await call(session), /does not parse[\s\S]*\.diagram\/s3\.c4:\d+/)
})

test('a subagent writes to its root conversation and gets a pointer', async () => {
  const cwd = workspace()
  const rootSession = { id: 'root', header: { cwd, origin: 'user' } }
  const sub = { id: 'child', header: { cwd, origin: 'subagent', parentSession: 'root' } }
  const { call, prompt } = mount({ root: rootSession, child: sub })
  assert.match(prompt(sub), /\.diagram\/root\.c4/)
  assert.match(prompt(sub), /You are a subagent/)
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/root.c4'), example)
  assert.match(await call(sub), /valid/)
  assert.equal(readFileSync(path.join(cwd, '.diagram/child.ref'), 'utf8').trim(), 'root')
})

test('the former `// carte v2` header is still accepted', async () => {
  const cwd = workspace()
  const session = { id: 's4', header: { cwd, origin: 'user' } }
  const { call } = mount({ s4: session })
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/s4.c4'), example.replace('// diagram v1', '// carte v2'))
  assert.match(await call(session), /valid/)
})

test('a Session shape this plugin does not know is ignored, not thrown', async () => {
  const { call, prompt } = mount({})
  const odd = { id: 'x' }
  assert.equal(prompt(odd), '')
  assert.equal(await call(odd), '')
})
