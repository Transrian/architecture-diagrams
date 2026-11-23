#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { verdict } from './verdict.mjs'
import { render } from './render.mjs'
import { serve } from './serve.mjs'

const HELP = `Usage: node scripts/diagram.mjs <command> [options]

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
  mcp                              Run an MCP server over stdio (tools: check,
                                   render, serve, guide)

  -h, --help                       Show help
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
    mcp: [],
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
  if (command === 'mcp') {
    if (positional.length || Object.keys(options).length) throw new Error('mcp takes no arguments')
    return { command }
  }
  if (positional.length !== 1 || !/\.c4$/i.test(positional[0])) throw new Error(`${command} needs exactly one <file.c4>`)
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
  const { command, file, options: o } = parse([...argv])
  if (command === 'mcp') {
    // Lazy: the other commands never load the MCP SDK.
    const { runMcp } = await import('./mcp.mjs')
    await runMcp()
    return 0
  }
  if (command === 'serve') {
    const { server, url } = await serve(file, { port: o.port, host: o.host, lang: o.lang })
    const stop = () => { server.close(); server.closeAllConnections() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    server.once('close', () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) })
    if (o.open) openBrowser(url)
    return 0
  }
  if (command === 'check') {
    const report = await verdict(file, { history: false })
    console.log(report.text)
    return report.code
  }
  const { report, output } = await render(file, { history: !o['no-history'], historyMax: o['history-max'] ?? 50, lang: o.lang, output: o.o, force: o.force })
  console.log(report.text)
  if (!output) return report.code
  console.log(`HTML: ${output}\nOpen: ${pathToFileURL(output).href}`)
  if (o.open) openBrowser(pathToFileURL(output).href)
  return report.code
}

try { process.exitCode = await main(process.argv.slice(2)) }
catch (error) { console.error(error.message); process.exitCode = 2 }
