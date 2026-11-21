// Host half (index.js) against a fake DSH context: prompt, verdicts, history
// and the self-ignoring diagram directory. Needs the built engine:
// run `cd build && node build.mjs` first, then `node --test test/`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, promptText } from '../index.js'
import { compute, RULES } from '../lib/likec4.mjs'
import { wrap } from '../src/shared.js'

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
  assert.doesNotMatch(text, /subagent:/)
})

test('the example in the prompt is itself a valid diagram', async () => {
  const text = promptText({ file: '/w/.diagram/s.c4', isSub: false })
  const r = await compute(text.slice(text.indexOf('// diagram v1\nmodel')))
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.problems, [])
})

test('the prompt quotes the same limits as RULES', () => {
  const text = promptText({ file: '/w/.diagram/s.c4', isSub: false })
  assert.match(text, new RegExp(`At most ${RULES.children} children per group and ${RULES.depth} levels`))
  assert.match(text, new RegExp(`title ≤ ${RULES.title} chars, description ≤ ${RULES.description}, technology ≤ ${RULES.technology}, relation label ≤ ${RULES.relation}`))
  assert.equal(RULES.elements, undefined, 'no cap on the total: the zoom shows one level at a time')
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

test('titles wrap between Chinese characters, and Latin titles at spaces', () => {
  assert.deepEqual(wrap('Payment gateway and order service', 14, 2), ['Payment', 'gateway an…'])
  assert.deepEqual(wrap('订单服务和支付网关', 10, 2), ['订单服务和', '支付网关'])
  assert.deepEqual(wrap('使用React组件渲染', 10, 2), ['使用React', '组件渲染'])
  for (const line of wrap('订单服务，支付网关。数据库，缓存。', 6, 4)) assert.doesNotMatch(line, /^[，。]/, 'no line starts with closing punctuation')
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
