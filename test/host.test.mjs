// Host half (index.js) against a fake DSH context: prompt, verdicts, history
// and the self-ignoring diagram directory. Needs the built engine:
// run `cd build && node build.mjs` first, then `node --test test/`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, promptText } from '../index.js'
import { compute, RULES } from '../lib/likec4.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const example = readFileSync(path.join(root, 'examples/web-shop.c4'), 'utf8')

/** Mounts the host half on a fake context and returns a "run one tool call" helper. */
function mount(sessions, config = {}) {
  const handlers = {}
  let section
  const warnings = []
  const ctx = {
    on: (name, fn) => (handlers[name] = fn),
    inject: (_deps, fn) => fn({ systemPrompt: { section: (s) => (section = s) } }),
    agents: { get: (id) => (sessions[id] ? { session: sessions[id] } : undefined) },
    logger: { warn: (message) => warnings.push(message) },
  }
  apply(ctx, config)
  const call = async (session) => {
    const out = await handlers['tools/post-execute']({ agent: { session } }, { content: [] }, async () => ({ kind: 'accept', value: undefined, content: [] }))
    return out.content.map((c) => c.text).join('\n')
  }
  return { call, prompt: (session) => section.text({ agent: { session } }), handlers, warnings }
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
  assert.doesNotMatch(text, /subagent:/)
})

test('a large, deep diagram is accepted as long as each level stays readable', async () => {
  // 6 levels, 3 children per group: several hundred elements, each view small.
  const lines = ['// diagram v1', 'model {']
  let n = 0
  const group = (id, depth, pad) => {
    lines.push(`${pad}${id} = system 'Group ${++n}' {`)
    for (let i = 0; i < 3; i++) {
      if (depth === RULES.depth - 1) lines.push(`${pad}  ${id}_${i} = service 'Service ${++n}'`)
      else group(`${id}_${i}`, depth + 1, pad + '  ')
    }
    lines.push(`${pad}}`)
  }
  group('platform', 1, '  ')
  lines.push('}')
  const r = await compute(lines.join('\n'))
  assert.ok(n > 300, `${n} elements`)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.problems, [])
  const deeper = lines.join('\n').replace("service 'Service 6'", "system 'Group X' {\n leaf = service 'Leaf'\n }")
  assert.ok((await compute(deeper)).problems.some((p) => /levels deep/.test(p.message)), `a ${RULES.depth + 1}th level is refused`)
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

  assert.equal(await call(session), '', 'unchanged file: no new note')
})

test('a leftover `previews` / `lang` setting from an older profile is ignored', async () => {
  const cwd = workspace()
  const session = { id: 'p1', header: { cwd, origin: 'user' } }
  const { call, prompt } = mount({ p1: session }, { previews: true, lang: 'zh' })
  assert.doesNotMatch(prompt(session), /preview/i)
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/p1.c4'), example)
  const note = await call(session)
  assert.match(note, /^\[diagram\] Diagram v1 valid/)
  assert.doesNotMatch(note, /preview|\.svg/i)
  assert.equal(existsSync(path.join(cwd, '.diagram/p1/previews')), false)
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


test('the removed dir setting warns once and always uses .diagram', async () => {
  const cwd = workspace()
  const session = { id: 's', header: { cwd, origin: 'user' } }
  const { call, prompt, warnings } = mount({ s: session }, { dir: 'elsewhere' })
  assert.ok(prompt(session).includes(`${cwd}/.diagram/s.c4`))
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/s.c4'), example)
  assert.match(await call(session), /valid/)
  assert.equal(await call(session), '')
  assert.equal(existsSync(path.join(cwd, 'elsewhere')), false)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0], 'dsh-diagram: the "dir" setting is no longer supported; diagrams stay in .diagram')
  assert.deepEqual(mount({ s: session }, { dir: '.diagram' }).warnings, [])
})

test('a failed read is retried without a content or mtime change', { skip: process.getuid?.() === 0 }, async () => {
  const cwd = workspace()
  const session = { id: 'retry', header: { cwd, origin: 'user' } }
  const { call, warnings } = mount({ retry: session })
  mkdirSync(path.join(cwd, '.diagram'))
  const file = path.join(cwd, '.diagram/retry.c4')
  writeFileSync(file, example)
  const before = statSync(file)
  chmodSync(file, 0o000)
  try {
    assert.equal(await call(session), '')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /check failed/)
  } finally { chmodSync(file, 0o644) }
  const after = statSync(file)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(after.size, before.size)
  assert.match(await call(session), /valid/)
})

test('host paths and subagent pointers use the same safe ids', async () => {
  const cwd = workspace()
  const session = { id: 'a/b', header: { cwd, origin: 'user' } }
  const rootSession = { id: 'r:1', header: { cwd, origin: 'user' } }
  const child = { id: 'child', header: { cwd, origin: 'subagent', parentSession: 'r:1' } }
  const { call, prompt, handlers } = mount({ 'a/b': session, 'r:1': rootSession, child })
  mkdirSync(path.join(cwd, '.diagram'))
  writeFileSync(path.join(cwd, '.diagram/a_b.c4'), example)
  assert.ok(prompt(session).includes(`${cwd}/.diagram/a_b.c4`))
  assert.match(await call(session), /valid/)
  writeFileSync(path.join(cwd, '.diagram/r_1.c4'), example)
  await handlers['agent/created']({ agent: { session: child } })
  assert.equal(readFileSync(path.join(cwd, '.diagram/child.ref'), 'utf8'), 'r_1\n')
  assert.match(await call(child), /valid/)
})

test('compatibility failures warn once per hook, missing root files stay silent', async () => {
  const { call, handlers, warnings } = mount({})
  const odd = { id: 'odd' }
  assert.equal(await call(odd), '')
  assert.equal(await call(odd), '')
  await handlers['agent/created']({ agent: { session: odd } })
  await handlers['agent/created']({ agent: { session: odd } })
  assert.equal(warnings.length, 2)
  assert.match(warnings[0], /diagram check disabled/)
  assert.match(warnings[1], /subagent pointer disabled/)
  const cwd = workspace()
  const rootSession = { id: 'root', header: { cwd, origin: 'user' } }
  const child = { id: 'child', header: { cwd, origin: 'subagent', parentSession: 'root' } }
  const quiet = mount({ root: rootSession, child })
  await quiet.handlers['agent/created']({ agent: { session: child } })
  assert.deepEqual(quiet.warnings, [])
})


test('persistent I/O failures back off and warn once without preventing recovery', { skip: process.getuid?.() === 0 }, async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const cwd = workspace()
  const session = { id: 'retry', header: { cwd, origin: 'user' } }
  const { call, warnings } = mount({ retry: session })
  mkdirSync(path.join(cwd, '.diagram'))
  const file = path.join(cwd, '.diagram/retry.c4')
  writeFileSync(file, example)
  chmodSync(file, 0o000)
  try {
    assert.equal(await call(session), '')
    assert.equal(await call(session), '')
    assert.equal(warnings.length, 1)
  } finally { chmodSync(file, 0o644) }
  assert.equal(await call(session), '', 'bounded delay after two identical failures')
  now = 1001
  assert.match(await call(session), /valid/, 'the same unchanged file recovers after the retry delay')
  writeFileSync(file, example + '\n// Start another failure')
  chmodSync(file, 0o000)
  try {
    await call(session)
    await call(session)
  } finally { chmodSync(file, 0o644) }
  assert.equal(warnings.length, 2, 'a new failure after a successful recovery is reported again')
  writeFileSync(file, example + '\n// Changed while in backoff')
  assert.match(await call(session), /valid/, 'editing the source bypasses backoff immediately')
})

test('pointer write errors are not reported as unsupported DSH versions', { skip: process.getuid?.() === 0 }, async () => {
  const cwd = workspace()
  const rootSession = { id: 'root', header: { cwd, origin: 'user' } }
  const child = { id: 'child', header: { cwd, origin: 'subagent', parentSession: 'root' } }
  const { handlers, warnings } = mount({ root: rootSession, child })
  const directory = path.join(cwd, '.diagram')
  mkdirSync(directory)
  writeFileSync(path.join(directory, 'root.c4'), example)
  chmodSync(directory, 0o555)
  try {
    await handlers['agent/created']({ agent: { session: child } })
    await handlers['agent/created']({ agent: { session: child } })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /cannot write subagent pointer/)
    assert.doesNotMatch(warnings[0], /not supported|disabled/)
  } finally { chmodSync(directory, 0o755) }
  await handlers['agent/created']({ agent: { session: child } })
  assert.equal(readFileSync(path.join(directory, 'child.ref'), 'utf8'), 'root\n')
})


test('a failed pointer does not hide a verdict and can recover without editing the diagram', { skip: process.getuid?.() === 0 }, async () => {
  const cwd = workspace()
  const rootSession = { id: 'root', header: { cwd, origin: 'user' } }
  const child = { id: 'child', header: { cwd, origin: 'subagent', parentSession: 'root' } }
  const { call, warnings } = mount({ root: rootSession, child }, { history: false })
  const directory = path.join(cwd, '.diagram')
  mkdirSync(directory)
  writeFileSync(path.join(directory, 'root.c4'), example)
  writeFileSync(path.join(directory, '.gitignore'), '*\n')
  chmodSync(directory, 0o555)
  try {
    assert.match(await call(child), /valid/, 'validation is independent of the optional pointer')
    assert.equal(await call(child), '')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /cannot write subagent pointer/)
  } finally { chmodSync(directory, 0o755) }
  assert.equal(await call(child), '', 'unchanged source does not need validation again')
  assert.equal(readFileSync(path.join(directory, 'child.ref'), 'utf8'), 'root\n')
})
