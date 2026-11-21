#!/usr/bin/env node
// Dependency-free CLI; importing the package as a DSH bundle never runs it.
import { readFile, writeFile, rename, unlink, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { verdict, locations } from '../cli/verdict.mjs'
import { buildHtml, CURRENT, readHistory } from '../cli/html.mjs'
import { serve } from '../cli/serve.mjs'
import { installSkill, printSkill } from '../cli/skill.mjs'
import { ensureIgnored } from '../history.js'

const HELP = `Usage: dsh-diagram <command> [options]

  check <file.c4>                  Validate, without writing anything
  render <file.c4>                  Write a self-contained offline HTML page
    -o <out.html>                  Output (default: next to the .c4 file)
    --no-history                   Do not create a new history snapshot
    --history-max <N>              Embed the last N snapshots (default: 50)
    --lang <en|fr|zh>              Language (default: browser preference)
    --open                         Open the result in your default browser
    --force                        Also render an invalid diagram
  serve <file.c4>                   Follow a diagram live over localhost
    --port <N>                     Port (default: 0, chosen automatically)
    --host <address>                Bind address (default: 127.0.0.1)
    --lang <en|fr|zh> --open
  skill [--cli <command>]           Print the Agent Skills document
  install-skill                    Write dsh-diagram/SKILL.md
    --to <directory>                Default: ~/.agents/skills (pi and Codex)
    --cli <command> --force         Override the command / replace a foreign skill
    Other targets: ~/.pi/agent/skills, ~/.claude/skills, .agents/skills (project)

  -h, --help                       Show help
  --version                        Show version
Exit codes: 0 success; 1 invalid/refused diagram; 2 usage or I/O error.
`

function parse(argv) {
  const command = argv.shift()
  const options = {}
  const positional = []
  const allowed = {
    check: [],
    render: ['o', 'no-history', 'history-max', 'lang', 'open', 'force'],
    serve: ['port', 'host', 'open', 'lang'],
    skill: ['cli'],
    'install-skill': ['to', 'cli', 'force'],
  }
  if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown command: ${command ?? '(missing)'}; use --help`)
  let literal = false
  while (argv.length) {
    const arg = argv.shift()
    if (!literal && arg === '--') { literal = true; continue }
    if (!literal && arg.startsWith('-')) {
      const key = arg === '-o' ? 'o' : arg.startsWith('--') ? arg.slice(2) : ''
      if (!allowed[command].includes(key)) throw new Error(`Unknown option for ${command}: ${arg}`)
      if (Object.hasOwn(options, key)) throw new Error(`Repeated option: ${arg}`)
      if (['no-history', 'open', 'force'].includes(key)) options[key] = true
      else {
        const value = argv.shift()
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
        options[key] = value
      }
    } else positional.push(arg)
  }
  if (['check', 'render', 'serve'].includes(command)) {
    if (positional.length !== 1 || !/\.c4$/i.test(positional[0])) throw new Error(`${command} needs exactly one <file.c4>`)
  } else if (positional.length) throw new Error(`${command} does not take positional arguments`)
  if (options.lang && !['en', 'fr', 'zh'].includes(options.lang)) throw new Error('--lang must be en, fr or zh')
  for (const key of ['history-max', 'port']) if (options[key] !== undefined) {
    if (!/^\d+$/.test(options[key]) || !Number.isSafeInteger(Number(options[key]))) throw new Error(`--${key} must be a non-negative integer`)
    options[key] = Number(options[key])
  }
  if (options.port > 65535) throw new Error('--port must be at most 65535')
  return { command, file: positional[0], options }
}

export function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  // URLs contain no literal quotes/newlines (file paths use pathToFileURL).
  // Pass start's title and quoted URL verbatim so '&' stays part of a filename.
  const windows = process.platform === 'win32'
  const args = windows ? ['/d', '/c', `start "" "${url}"`] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: windows })
    child.once('error', (error) => console.error(`Could not open browser: ${error.message}`))
    child.unref()
  } catch (error) { console.error(`Could not open browser: ${error.message}`) }
}

async function main(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0 }
  if (argv.length === 1 && argv[0] === '--version') {
    console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version)
    return 0
  }
  const { command, file, options: o } = parse([...argv])
  if (command === 'skill') { console.log(await printSkill({ cli: o.cli })); return 0 }
  if (command === 'install-skill') { console.log(await installSkill({ to: o.to, cli: o.cli, force: o.force })); return 0 }
  if (command === 'serve') {
    const { server, url } = await serve(file, { port: o.port, host: o.host, lang: o.lang })
    const stop = () => { server.close(); server.closeAllConnections() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    server.once('close', () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) })
    if (o.open) openBrowser(url)
    return 0
  }
  const report = await verdict(file, { history: command === 'render' && !o['no-history'] })
  console.log(report.text)
  if (command === 'check' || report.code === 2 || (!report.ok && !o.force)) return report.code
  const { absolute, dir, historyDir } = locations(file)
  const output = path.resolve(o.o ?? absolute.replace(/\.c4$/i, '.html'))
  // Resolve directory aliases too: a symlinked output parent must not bypass
  // the source-overwrite guard. rename replaces an output symlink, not its target.
  const resolvedOutput = path.join(await realpath(path.dirname(output)), path.basename(output))
  const sourceEntry = path.join(await realpath(path.dirname(absolute)), path.basename(absolute))
  if (resolvedOutput === sourceEntry || resolvedOutput === await realpath(absolute)) throw new Error('The HTML output must not overwrite the source diagram')
  if (path.basename(dir) === '.diagram') await ensureIgnored(dir)
  const files = { ...await readHistory(historyDir, o['history-max'] ?? 50), [CURRENT]: report.source }
  const html = await buildHtml({ mode: 'embedded', name: path.basename(file, path.extname(file)), files, lang: o.lang })
  const temporary = `${output}.${process.pid}.tmp`
  // Both paths are absolute and known here. Only the newly-created temporary
  // file is removed if an atomic rename fails; an existing output stays intact.
  let created = false
  try {
    await writeFile(temporary, html, { flag: 'wx' })
    created = true
    await rename(temporary, output)
    created = false
  } finally { if (created) await unlink(temporary) }
  console.log(`HTML: ${output}\nOpen: ${pathToFileURL(output).href}`)
  if (o.open) openBrowser(pathToFileURL(output).href)
  return report.code
}

try { process.exitCode = await main(process.argv.slice(2)) }
catch (error) { console.error(error.message); process.exitCode = 2 }
