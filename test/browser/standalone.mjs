// Optional offline browser smoke test; not collected by test/*.test.mjs.
// DSHD_CHROMIUM=/path/to/chrome node --test test/browser/standalone.mjs
// DSHD_PLAYWRIGHT may point to a Playwright package directory or its entry file.
// Without it, try ordinary imports, then the optional local harness installation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = path.join(root, '.local/standalone-check')
const binary = path.join(root, 'bin/dsh-diagram.mjs')
const run = promisify(execFile)

async function playwright() {
  if (process.env.DSHD_PLAYWRIGHT) return createRequire(import.meta.url)(path.resolve(process.env.DSHD_PLAYWRIGHT))
  for (const name of ['playwright-core', 'playwright']) {
    try { return await import(name) } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error }
  }
  try { return createRequire(new URL('../../.local/harness/package.json', import.meta.url))('playwright-core') }
  catch (error) { throw new Error('Install playwright-core or set DSHD_PLAYWRIGHT to its package directory', { cause: error }) }
}

const labels = {
  en: { fit: 'Fit', theme: 'Theme', snapshot: 'Snapshot of reference', empty: 'No diagram yet' },
  fr: { fit: 'Ajuster', theme: 'Thème', snapshot: 'Instantané de reference', empty: 'Pas encore de schéma' },
  zh: { fit: '适应窗口', theme: '主题', snapshot: 'reference 的快照', empty: '还没有架构图' },
}

async function ready(page) {
  await page.locator('.dshd-stage > svg').waitFor({ timeout: 30_000 })
  await page.locator('.dshd-stage .dshd-node').first().waitFor()
  await page.waitForFunction(() => document.querySelector('.dshd-stage .dshd-ico'))
  assert.equal(await page.getByRole('button', { name: /PNG/i }).count(), 0, 'PNG export must not be available')
}
const nodeText = (page, title) => page.locator('.dshd-stage svg text').filter({ hasText: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first()
const unfoldChip = (page, title) => page.locator('.dshd-stage .dshd-node').filter({ has: page.locator('text', { hasText: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('.dshd-count-chip').first()
const foldChip = (page, frameTitle) => page.locator('.dshd-stage .dshd-node').filter({ has: page.locator('text', { hasText: new RegExp('^' + frameTitle) }) }).locator('.dshd-chip:not(.dshd-count-chip)').first()
async function focused(page, title) {
  await page.waitForFunction((value) => document.querySelector('.dshd-crumbs b')?.textContent === value, title)
}
async function background(page, expected) {
  await page.waitForFunction((value) => getComputedStyle(document.body).backgroundColor === value, expected)
}

// A Chromium path opts in explicitly. In particular, CI does not need a browser
// installation or the optional Playwright dependency merely to run node:test.
test('standalone HTML renders and stays interactive without network access', {
  skip: !process.env.DSHD_CHROMIUM,
  timeout: 180_000,
}, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'dshd-browser-'))
  t.after(async () => {
    // Only remove this test's freshly allocated directory, never a caller path.
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
    assert.match(path.basename(temporary), /^dshd-browser-/)
    await rm(temporary, { recursive: true, force: true })
  })
  await mkdir(artifacts, { recursive: true })
  const diagramDir = path.join(temporary, '.diagram')
  await mkdir(diagramDir)
  const file = path.join(diagramDir, 'reference.c4')
  const html = path.join(diagramDir, 'reference.html')
  const source = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
  const previous = source.replace("ops = system 'Operations'", "ops = system 'Operations before'")
  assert.notEqual(previous, source)
  async function render(text) {
    await writeFile(file, text)
    const { stdout } = await run(process.execPath, [binary, 'render', file], { cwd: root, timeout: 60_000, maxBuffer: 2_000_000 })
    assert.match(stdout, /\[diagram\].*valid/)
  }
  await render(previous)
  await render(source)
  const htmlBytes = (await stat(html)).size
  assert.ok(htmlBytes <= 5_000_000, `HTML exceeded budget: ${htmlBytes}`)
  t.diagnostic(`Offline HTML with two history versions: ${htmlBytes} bytes`)

  const { chromium } = await playwright()
  const browser = await chromium.launch({ executablePath: process.env.DSHD_CHROMIUM, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const errors = []
  const blocked = []
  async function open(locale, colorScheme) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale, colorScheme, reducedMotion: 'reduce', acceptDownloads: true })
    await context.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith('file:')) return route.continue()
      blocked.push(url)
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', (error) => errors.push(`${locale}: ${error.message}`))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${locale}: ${message.text()}`) })
    page.on('dialog', async (dialog) => { errors.push(`${locale}: ${dialog.message()}`); await dialog.dismiss() })
    await page.goto(pathToFileURL(html).href)
    await ready(page)
    return { context, page }
  }

  const { context, page } = await open('en-US', 'light')
  try {
    assert.equal(await page.title(), 'reference')
    assert.equal(await page.locator('html').getAttribute('lang'), 'en')
    assert.match(await page.locator('.dshd-header-status').textContent(), /^Snapshot of reference · /)
    await page.getByRole('button', { name: 'AWS', exact: true }).click()
    await focused(page, 'AWS')
    await page.getByRole('button', { name: 'Azure', exact: true }).click()
    await focused(page, 'Azure')

    await nodeText(page, 'sub-contoso-prod').click()
    await page.locator('.dshd-detail h4').waitFor()
    assert.match(await page.locator('.dshd-detail').textContent(), /azure\.prod/)
    await page.locator('.dshd-detail').getByRole('button', { name: 'Zoom in', exact: true }).click()
    await focused(page, 'sub-contoso-prod')
    const beforeUnfold = await page.locator('.dshd-stage > svg').innerHTML()
    await unfoldChip(page, 'rg-edge').click()
    await page.getByRole('button', { name: 'Fold all', exact: true }).waitFor()
    await nodeText(page, 'Front Door').waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.dshd-stage svg text')].some((text) => text.textContent === 'Front Door' && text.closest('.dshd-node')?.querySelector('.dshd-ico')))
    assert.notEqual(await page.locator('.dshd-stage > svg').innerHTML(), beforeUnfold)
    await focused(page, 'sub-contoso-prod') // Unfolding must not navigate into the group.
    await page.screenshot({ path: path.join(artifacts, 'standalone-light.png') })

    await page.getByRole('button', { name: 'Fold all', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('button[aria-label="Fold all"]')?.disabled)
    await page.locator('.dshd-crumbs').getByRole('button', { name: 'Azure', exact: true }).click()
    await focused(page, 'Azure')

    await page.getByRole('button', { name: 'Previous version', exact: true }).click()
    await page.getByRole('button', { name: 'Operations before', exact: true }).waitFor()
    assert.match(await page.locator('.dshd-time').textContent(), /v1/)
    await page.getByRole('button', { name: 'Next version', exact: true }).click()
    await page.getByRole('button', { name: 'Operations', exact: true }).waitFor()
    assert.match(await page.locator('.dshd-time').textContent(), /live/)

    const beforeDirection = await page.locator('.dshd-stage > svg').innerHTML()
    await page.getByRole('button', { name: 'Layout: vertical — switch to horizontal', exact: true }).click()
    await page.waitForFunction((before) => localStorage.getItem('dsh-diagram.direction') === 'LeftRight' && document.querySelector('.dshd-stage > svg')?.innerHTML !== before, beforeDirection)
    await page.getByRole('button', { name: 'A scan, from depot to customer', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.dshd-flow[aria-current=true]'))
    await page.locator('.dshd-crumbs').getByRole('button', { name: 'Leave flow' }).waitFor()
    await page.getByRole('button', { name: 'Azure', exact: true }).click()
    await focused(page, 'Azure')

    await background(page, 'rgb(255, 255, 255)')
    await page.getByRole('button', { name: 'Theme: Auto', exact: true }).click()
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
    await page.getByRole('button', { name: 'Theme: Light', exact: true }).click()
    await background(page, 'rgb(21, 21, 23)')
    await page.getByRole('button', { name: 'Theme: Dark', exact: true }).click()
    await background(page, 'rgb(255, 255, 255)')
    await page.getByRole('button', { name: 'Theme: Auto', exact: true }).click()
    await page.getByRole('button', { name: 'Theme: Light', exact: true }).click()
    await page.reload()
    await ready(page)
    await background(page, 'rgb(21, 21, 23)')
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'standalone-failure.png') }).catch(() => {})
    throw error
  } finally { await context.close() }

  for (const [locale, expected, scheme] of [['fr-FR', 'fr', 'dark'], ['zh-CN', 'zh', 'light'], ['de-DE', 'en', 'dark']]) {
    const opened = await open(locale, scheme)
    try {
      assert.equal(await opened.page.locator('html').getAttribute('lang'), expected)
      await opened.page.getByRole('button', { name: labels[expected].fit, exact: true }).waitFor()
      assert.ok((await opened.page.locator('.dshd-header-status').textContent()).startsWith(labels[expected].snapshot))
      await opened.page.getByRole('button', { name: new RegExp('^' + labels[expected].theme + ':') }).waitFor()
      await background(opened.page, scheme === 'dark' ? 'rgb(21, 21, 23)' : 'rgb(255, 255, 255)')
      if (expected === 'fr') {
        await nodeText(opened.page, 'sub-contoso-prod').click()
        await opened.page.locator('.dshd-detail').getByRole('button', { name: 'Zoomer dedans', exact: true }).click()
        await focused(opened.page, 'sub-contoso-prod')
        await unfoldChip(opened.page, 'rg-edge').click()
        await nodeText(opened.page, 'Front Door').waitFor()
        await opened.page.screenshot({ path: path.join(artifacts, 'standalone-dark.png') })
      }
      if (expected === 'zh') await opened.page.screenshot({ path: path.join(artifacts, 'standalone-zh.png') })
    } finally { await opened.context.close() }
  }
  assert.deepEqual(errors, [], 'Browser errors')
  assert.deepEqual(blocked, [], 'Standalone attempted to contact the network')
  t.diagnostic(`Screenshots saved in ${path.relative(root, artifacts)}`)
})
