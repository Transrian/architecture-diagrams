import assert from 'node:assert/strict'
import { access, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function playwright(env = process.env) {
  const require = createRequire(new URL('../../build/package.json', import.meta.url))
  return require(env.ARCHD_PLAYWRIGHT ? path.resolve(env.ARCHD_PLAYWRIGHT) : 'playwright-core')
}

export async function preflightBrowser(env = process.env) {
  assert.ok(env.ARCHD_CHROMIUM, 'Set ARCHD_CHROMIUM to a full Chromium executable; complete verification never skips browser tests')
  await access(env.ARCHD_CHROMIUM, constants.X_OK)
  const { chromium } = await playwright(env)
  const browser = await chromium.launch({ executablePath: env.ARCHD_CHROMIUM, args: ['--no-sandbox'] })
  await browser.close()
}

// Avoid a cold parser per version without bypassing the bundled CLI.
export async function renderVersions(file, sources, options = {}) {
  const root = new URL('../../', import.meta.url)
  const require = createRequire(new URL('build/package.json', root))
  const { Client } = require('@modelcontextprotocol/client')
  const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('skills/architecture-diagrams/scripts/diagram.mjs', root)), 'mcp'],
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const client = new Client({ name: 'archd-browser-fixtures', version: '0' })
  try {
    await client.connect(transport)
    for (const source of sources) {
      await writeFile(file, source)
      const result = await client.callTool({ name: 'render', arguments: { file, ...options } })
      const text = result.content.map((part) => part.text).join('\n')
      assert.ok(!result.isError, `${text}\n${stderr}`)
      assert.match(text, /\[diagram\].*valid/)
    }
  } finally {
    await client.close()
  }
}

const clocks = new WeakMap()

export async function frameClock(page, { controlled = true } = {}) {
  if (controlled) {
    await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') })
    await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'))
  }
  const clock = { controlled, advance: (ms) => (controlled ? page.clock.runFor(ms) : page.waitForTimeout(ms)) }
  clocks.set(page, clock)
  return clock
}

export async function until(page, condition, argument) {
  const clock = clocks.get(page)
  if (!clock?.controlled) return page.waitForFunction(condition, argument)
  await pollFrames(page, () => page.evaluate(condition, argument), String(condition))
}

async function pollFrames(page, check, description) {
  const deadline = performance.now() + 15_000
  while (!(await check())) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${description}`)
    await advance(page, 96)
  }
}

export async function shown(page, locator) {
  if (!clocks.get(page)?.controlled) return locator.waitFor()
  await pollFrames(page, () => locator.isVisible(), String(locator))
}

export function clockOf(page) {
  const clock = clocks.get(page)
  assert.ok(clock, 'page has no configured frame clock')
  return clock
}
export const advance = (page, ms) => clockOf(page).advance(ms)

export async function ready(page) {
  await shown(page, page.locator('.archd-stage > svg'))
  await page.locator('.archd-stage .archd-node').first().waitFor()
  await until(page, () => document.querySelector('.archd-stage .archd-ico') !== null)
  assert.equal(await page.getByRole('button', { name: /PNG/i }).count(), 0, 'PNG export must not be available')
}
const escaped = (title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const nodeText = (page, title) =>
  page
    .locator('.archd-stage svg text')
    .filter({ hasText: new RegExp('^' + escaped(title) + '$') })
    .or(page.locator('.archd-stage .archd-node').and(
      page.locator(`[aria-label=${JSON.stringify(title)}]`),
    ))
    .first()
export const unfoldChip = (page, title) =>
  page
    .locator('.archd-stage .archd-node')
    .filter({ has: page.locator('text', { hasText: new RegExp('^' + escaped(title) + '$') }) })
    .locator('.archd-count-chip')
    .first()
export const foldChip = (page, title) =>
  page
    .locator('.archd-stage .archd-node')
    .filter({ has: page.locator('text', { hasText: new RegExp('^' + escaped(title)) }) })
    .locator('.archd-chip:not(.archd-count-chip)')
    .first()
export async function focused(page, title) {
  await until(page, (value) => document.querySelector('.archd-crumbs b')?.textContent === value, title)
}
export async function settled(page) {
  await page.evaluate(() => {
    window.__archdTestFrame = null
  })
  await until(page, () => {
    const svg = document.querySelector('.archd-stage > svg')?.innerHTML
    const last = window.__archdTestFrame
    if (!last || last.svg !== svg) window.__archdTestFrame = { svg, at: performance.now() }
    return !!svg && last?.svg === svg && performance.now() - last.at > 150
  })
}
/** `expected`: console errors the scenario causes on purpose. */
export function watchErrors(page, errors, prefix, expected = null) {
  page.on('pageerror', (error) => errors.push(`${prefix}: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error' || expected?.test(message.text())) return
    errors.push(`${prefix}: ${message.text()}`)
  })
  page.on('dialog', async (dialog) => {
    errors.push(`${prefix}: unexpected modal: ${dialog.message()}`)
    await dialog.dismiss()
  })
}
export async function denyNetwork(context, blocked) {
  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith('file:')) return route.continue()
    blocked.push(url)
    return route.abort()
  })
}
