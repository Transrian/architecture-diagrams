// The MCP server of the built script, driven by the official SDK client over stdio.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mcpTexts, skillSections } from '../src/cli/mcp-text.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const binary = path.join(root, 'skills/dsh-diagram/scripts/diagram.mjs')
const skill = readFileSync(path.join(root, 'skills/dsh-diagram/SKILL.md'), 'utf8')
const source = readFileSync(path.join(root, 'examples/web-shop.c4'), 'utf8')
const require = createRequire(path.join(root, 'build/package.json'))
const { Client } = require('@modelcontextprotocol/client')
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')

function workspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dshd-mcp-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(path.join(dir, '.diagram'))
  return dir
}

async function connect(t) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [binary, 'mcp'], cwd: root, stderr: 'pipe' })
  let stderr = ''
  transport.stderr.on('data', (chunk) => { stderr += chunk })
  const client = new Client({ name: 'dshd-test', version: '0' })
  await client.connect(transport)
  t.after(() => client.close())
  return { client, stderr: () => stderr }
}

const call = (client, name, args = {}) => client.callTool({ name, arguments: args })
const textOf = (result) => result.content.map((c) => c.text).join('\n')

test('the MCP texts reuse SKILL.md and name the tools instead of the script', () => {
  const { instructions, guide } = mcpTexts(skill)
  const { sections } = skillSections(skill)
  assert.doesNotMatch(instructions, /^---|^name:|scripts\/diagram\.mjs|^## Command/m)
  assert.ok(instructions.startsWith('# Architecture diagram\n'))
  for (const tool of ['render', 'check', 'serve', 'guide']) assert.match(instructions, new RegExp(`^- \`${tool}\` `, 'm'), tool)
  for (const name of ['Files', 'Format']) {
    assert.ok(instructions.includes(sections.get(name)), `instructions keep ## ${name}`)
    assert.ok(guide.includes(sections.get(name)), `guide keeps ## ${name}`)
  }
  assert.throws(() => mcpTexts(skill.replace('## Format', '## Syntax')), /missing section "## Format"/)
})

test('MCP server: instructions, tools, check and render', { timeout: 60_000 }, async (t) => {
  const dir = workspace(t)
  const file = path.join(dir, '.diagram', 'shop.c4')
  writeFileSync(file, source)
  const { client } = await connect(t)
  assert.equal(client.getServerVersion().name, 'dsh-diagram')
  assert.equal(client.getServerVersion().version, JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version)
  assert.equal(client.getInstructions(), mcpTexts(skill).instructions)
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ['check', 'guide', 'render', 'serve'])
  assert.equal(textOf(await call(client, 'guide')), mcpTexts(skill).guide)

  const valid = await call(client, 'check', { file })
  assert.ok(!valid.isError)
  assert.match(textOf(valid), /^\[diagram\].*valid/)
  assert.deepEqual(readdirSync(path.join(dir, '.diagram')), ['shop.c4'], 'check writes nothing')

  const rendered = await call(client, 'render', { file, lang: 'fr' })
  assert.ok(!rendered.isError, textOf(rendered))
  const html = path.join(dir, '.diagram', 'shop.html')
  assert.ok(textOf(rendered).includes(`Open: ${pathToFileURL(html).href}`))
  assert.match(readFileSync(html, 'utf8'), /"lang":"fr"/)
  assert.match(readFileSync(path.join(dir, '.diagram', '.gitignore'), 'utf8'), /^\*$/m)
  assert.equal(readdirSync(path.join(dir, '.diagram', 'shop')).length, 1, 'render snapshots the accepted version')

  writeFileSync(file, '// diagram v1\nmodel {\n x = system\n')
  const broken = await call(client, 'render', { file })
  assert.equal(broken.isError, true)
  assert.match(textOf(broken), /does not parse/)
  assert.doesNotMatch(textOf(broken), /Open:/)
  assert.match(readFileSync(html, 'utf8'), /"lang":"fr"/, 'an invalid diagram leaves the previous page')

  const missing = await call(client, 'check', { file: path.join(dir, 'missing.c4') })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /cannot read/)
  const wrongType = await call(client, 'render', { file: path.join(dir, 'x.txt') })
  assert.equal(wrongType.isError, true)
  assert.match(textOf(wrongType), /\.c4/)
})

test('MCP server: serve follows the file until the client disconnects', { timeout: 60_000 }, async (t) => {
  const dir = workspace(t)
  const file = path.join(dir, '.diagram', 'shop.c4')
  writeFileSync(file, source)
  const { client, stderr } = await connect(t)
  const first = textOf(await call(client, 'serve', { file }))
  const url = /^Live viewer: (http:\/\/127\.0\.0\.1:\d+\/)$/.exec(first)?.[1]
  assert.ok(url, first)
  assert.equal(textOf(await call(client, 'serve', { file })), first, 'one server per file')
  assert.match(await (await fetch(url)).text(), /<!doctype html>/)
  assert.equal((await (await fetch(new URL('/api/source', url))).json()).text, source)
  for (let i = 0; i < 50 && !/\[diagram\]/.test(stderr()); i++) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.match(stderr(), /\[diagram\].*valid/, 'serve verdicts go to stderr, never into the protocol stream')
  assert.ok(existsSync(path.join(dir, '.diagram', 'shop')), 'serve snapshots accepted versions')
  // The SDK client ends stdin, then sends SIGTERM to a server still running 2 s later.
  const closing = performance.now()
  await client.close()
  assert.ok(performance.now() - closing < 1500, 'the MCP server exits by itself once stdin closes')
  await assert.rejects(fetch(url), 'the live server stops with the MCP server')
})
