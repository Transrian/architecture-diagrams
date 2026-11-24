// MCP server over stdio: the CLI's check/render/serve as tools, and SKILL.md
// as the server instructions, so a client without the skill knows the format.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import pkg from '../../package.json' with { type: 'json' }
import { SKILL_DIR } from './assets.mjs'
import { verdict } from './verdict.mjs'
import { render } from './render.mjs'
import { serve } from './serve.mjs'
import { mcpTexts } from './mcp-text.mjs'

const file = z.string().regex(/\.c4$/i, 'must be a .c4 file').describe('Absolute path to the diagram (.c4)')
const lang = z.enum(['en', 'fr', 'zh']).optional().describe('Page language (default: the browser preference)')
const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], isError })

export async function runMcp() {
  // stdout carries the protocol: a stray console.log from a dependency would corrupt it.
  console.log = console.error
  const { guide, instructions } = mcpTexts(await readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'))
  const server = new McpServer({ name: 'dsh-diagram', version: pkg.version }, { instructions })
  const live = new Map()

  server.registerTool(
    'guide',
    {
      description: 'File locations and format rules for architecture diagrams (.c4). Read them before writing a diagram.',
      inputSchema: z.object({}),
    },
    async () => text(guide),
  )

  server.registerTool(
    'check',
    {
      description: 'Validate an architecture diagram (.c4) without writing anything; returns its [diagram] verdict.',
      inputSchema: z.object({ file }),
    },
    async ({ file }) => {
      const report = await verdict(file, { history: false })
      return text(report.text, !report.ok)
    },
  )

  server.registerTool(
    'render',
    {
      description:
        'Validate an architecture diagram (.c4), save the accepted version and write its self-contained HTML page next to it. ' +
        'Returns the [diagram] verdict and the page link. Call after every edit.',
      inputSchema: z.object({ file, lang }),
    },
    async ({ file, lang }) => {
      const { report, output } = await render(file, { lang })
      return text(output ? `${report.text}\nHTML: ${output}\nOpen: ${pathToFileURL(output).href}` : report.text, !report.ok)
    },
  )

  server.registerTool(
    'serve',
    {
      description:
        'Follow an architecture diagram (.c4) live on a localhost page (127.0.0.1) and return its URL. ' +
        'One server per file; it stops with this MCP server.',
      inputSchema: z.object({ file, lang }),
    },
    async ({ file, lang }) => {
      const key = path.resolve(file)
      if (!live.has(key)) {
        const started = serve(file, { lang, log: (line) => console.error(line) })
        live.set(key, started)
        started.catch(() => live.delete(key))
      }
      const { url } = await live.get(key)
      return text(`Live viewer: ${url}`)
    },
  )

  server.server.onclose = async () => {
    for (const started of live.values()) {
      const { server: http } = await started
      http.close()
      http.closeAllConnections()
    }
  }
  await server.connect(new StdioServerTransport())
}
