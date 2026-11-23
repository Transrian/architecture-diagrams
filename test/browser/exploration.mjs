// Optional offline regressions for exploration and observed changes.
// Build the clients first, then opt in (no browser/dependency is needed to skip):
// DSHD_CHROMIUM=/path/to/chrome node --test test/browser/exploration.mjs
// Playwright comes from pinned build dependencies (DSHD_PLAYWRIGHT overrides it).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playwright, ready, focused, watchErrors, denyNetwork } from '../support/browser.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const binary = path.join(root, 'bin/dsh-diagram.mjs')
const artifacts = path.join(root, '.local/exploration-check')
const run = promisify(execFile)
const ids = {
  cosmos: 'azure.prod.tracking.vnet.data.cosmos',
  scanners: 'ops.depots.north.scanners',
  functions: 'azure.prod.tracking.vnet.app.functions',
  apim: 'azure.prod.tracking.vnet.app.apim',
}

async function selected(page, id) {
  await page.waitForFunction((value) => document.querySelector('.dshd-detail')?.textContent.includes(value), id)
}
// The explorer (search field above the outline) is docked at this width: it stays open between reveals.
async function explorer(page) {
  if (!(await page.locator('.dshd-explorer').count())) await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.dshd-explorer.dshd-docked').waitFor()
  return page.getByRole('combobox', { name: 'Search', exact: true })
}
async function search(page, text) {
  const input = await explorer(page)
  await input.fill(text)
  await page.locator('.dshd-explorer [role=option]').first().waitFor()
  return input
}
async function reveal(page, text, id, scope) {
  const input = await search(page, text)
  await input.press('Enter')
  await focused(page, scope)
  await selected(page, id)
  await page.locator(`.dshd-stage .dshd-node[data-element="${id}"]`).waitFor()
}
const shapes = (page) => page.locator('.dshd-stage svg .dshd-shape').evaluateAll((nodes) => nodes.map((node) => node.outerHTML))

// No HTTP server or replacement GUI: exercise the actual self-contained file://
// bundle, including its embedded history and lazy engine, with network denied.
test('offline exploration preserves selection, traces exact links and compares saved versions', {
  skip: !process.env.DSHD_CHROMIUM,
  timeout: 180_000,
}, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'dshd-exploration-'))
  t.after(async () => {
    // Verify the absolute deletion target is precisely this test's allocation.
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
    assert.match(path.basename(temporary), /^dshd-exploration-/)
    await rm(temporary, { recursive: true, force: true })
  })
  await mkdir(artifacts, { recursive: true })
  const diagramDir = path.join(temporary, '.diagram')
  await mkdir(diagramDir)
  const file = path.join(diagramDir, 'reference.c4')
  const html = path.join(diagramDir, 'reference.html')
  const original = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
  const current = original.replace("ops = system 'Operations'", "ops = system 'Operations updated'")
  assert.notEqual(current, original, 'The second accepted version changes exactly the Operations title')
  await writeFile(file, original)
  await run(process.execPath, [binary, 'render', file, '-o', html], { cwd: temporary })
  await writeFile(file, current)
  await run(process.execPath, [binary, 'render', file, '-o', html], { cwd: temporary })
  const historyDir = path.join(diagramDir, 'reference')
  const historyNames = (await readdir(historyDir)).filter((name) => name.endsWith('.c4')).sort()
  assert.equal(historyNames.length, 2, 'CLI embeds two genuinely accepted versions')
  const historySources = await Promise.all(historyNames.map((name) => readFile(path.join(historyDir, name), 'utf8')))
  assert.deepEqual(historySources, [original, current])
  const htmlSource = await readFile(html, 'utf8')

  const { chromium } = await playwright()
  const browser = await chromium.launch({ executablePath: process.env.DSHD_CHROMIUM, headless: true, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const errors = []
  const blocked = []
  async function open(reducedMotion = 'reduce') {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', colorScheme: 'light', reducedMotion, serviceWorkers: 'block' })
    await denyNetwork(context, blocked)
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    watchErrors(page, errors, 'exploration')
    await page.goto(pathToFileURL(html).href)
    await ready(page)
    return { context, page }
  }

  const opened = await open()
  try {
    const { page } = opened
    const embeddedBefore = await page.locator('#dshd-data').textContent()
    const embeddedFiles = JSON.parse(embeddedBefore).files
    assert.equal(Object.keys(embeddedFiles).filter((name) => name.startsWith('.diagram/diagram/')).length, 2)

    // Full-model search reveals a deeply nested leaf, not an ambiguous short id.
    await reveal(page, 'Cosmos', ids.cosmos, 'snet-data')
    assert.equal(await page.locator('.dshd-detail').getByRole('button', { name: 'Reveal', exact: true }).count(), 0)
    await page.locator('.dshd-crumbs').getByRole('button', { name: 'Azure', exact: true }).click()
    await focused(page, 'Azure')
    await selected(page, ids.cosmos)
    await page.locator('.dshd-node[data-element="azure.prod"] .dshd-contains-selection').waitFor()
    assert.equal(await page.locator(`.dshd-stage .dshd-node[data-element="${ids.cosmos}"]`).count(), 0, 'The leaf is hidden, not silently deselected')
    await page.locator('.dshd-detail').getByRole('button', { name: 'Reveal', exact: true }).click()
    await focused(page, 'snet-data')
    await selected(page, ids.cosmos)
    await page.locator(`.dshd-node[data-element="${ids.cosmos}"] .dshd-halo`).waitFor()

    // Traverse the original graph across group boundaries; Escape clears trace
    // before it clears the persistent element selection.
    await reveal(page, 'Handheld scanners', ids.scanners, 'Depot North')
    await page.locator('.dshd-detail').getByRole('button', { name: 'Downstream', exact: true }).click()
    await page.waitForFunction(() => /\b24 elements\b/.test(document.querySelector('.dshd-trace [role=status]')?.textContent ?? ''))
    await page.locator('.dshd-stage').press('Escape')
    await page.locator('.dshd-trace').waitFor({ state: 'hidden' })
    await selected(page, ids.scanners)
    await page.locator('.dshd-stage').press('ArrowRight')
    await selected(page, ids.scanners)
    assert.equal(await page.locator('.dshd-stage').evaluate((stage) => {
      const id = stage.getAttribute('aria-activedescendant')
      return !!id && document.getElementById(id)?.getAttribute('role') === 'option'
    }), true, 'Spatial keyboard focus owns a real accessible option without changing selection')

    // The alternate text tree has real DOM roving focus and native tree keys.
    // An empty explorer field shows the tree; ArrowDown moves from the field into it.
    const field = await explorer(page)
    await field.fill('')
    await field.press('ArrowDown')
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'treeitem')
    const azure = page.locator('.dshd-outline [role=treeitem][data-element="azure"]')
    await azure.focus()
    assert.equal(await azure.getAttribute('aria-expanded'), 'true')
    await azure.press('ArrowLeft')
    await page.waitForFunction(() => document.querySelector('.dshd-outline [data-element="azure"]')?.getAttribute('aria-expanded') === 'false')
    await azure.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('.dshd-outline [data-element="azure"]')?.getAttribute('aria-expanded') === 'true')
    await azure.press('ArrowRight')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-element') === 'azure.prod')
    await page.keyboard.press('Enter')
    await focused(page, 'sub-contoso-prod')
    await selected(page, 'azure.prod')
    // Docked, the explorer keeps the keyboard after a reveal; Escape in it closes it.
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.dshd-explorer')), true)
    await page.keyboard.press('Escape')
    await page.locator('.dshd-explorer').waitFor({ state: 'hidden' })

    // Observed changes do not alter shape geometry or replace declared state.
    const beforeChanges = await shapes(page)
    await page.getByRole('button', { name: 'Changes', exact: true }).click()
    assert.equal(await page.locator('.dshd-comparison-controls select').first().inputValue(), 'previous')
    await page.waitForFunction(() => /Compared with v1.*\+0 added.*Δ1 changed.*↷0 moved.*−0 removed/.test(document.querySelector('.dshd-changes [role=status]')?.textContent ?? ''))
    assert.deepEqual(await shapes(page), beforeChanges, 'Change overlays never modify the layout shapes')
    await page.getByRole('button', { name: 'Operations updated', exact: true }).click()
    await focused(page, 'Operations updated')
    await page.waitForFunction(() => document.querySelector('.dshd-node[data-element="ops"] .dshd-change-badge')?.textContent === 'Δ1')
    await page.getByRole('button', { name: 'Previous version', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.dshd-changes [role=status]')?.textContent === 'This is the first version; there is no previous baseline.')
    await focused(page, 'Operations')
    assert.equal(await page.locator('.dshd-change-badge').count(), 0, 'The first version must not fabricate an empty-model diff')
    await page.getByRole('button', { name: 'Next version', exact: true }).click()
    await focused(page, 'Operations updated')
    await page.waitForFunction(() => /Δ1 changed/.test(document.querySelector('.dshd-changes [role=status]')?.textContent ?? ''))
    assert.equal(await page.locator('#dshd-data').textContent(), embeddedBefore, 'Exploration does not rewrite embedded sources or history')
    await page.screenshot({ path: path.join(artifacts, 'exploration-light.png') })
  } finally { await opened.context.close() }

  // Exercise cancellation with actual animation enabled. Dispatch the two keys
  // in one browser task separated by two frames: this covers the pending/active
  // request window without Playwright round-trip timing finishing a 160 ms fly.
  const animated = await open('no-preference')
  try {
    const { page } = animated
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), false)
    await reveal(page, 'API Management', ids.apim, 'snet-app')
    await page.locator(`.dshd-node[data-element="${ids.apim}"] .dshd-reveal`).waitFor()
    await page.locator('.dshd-stage .dshd-edge').first().dispatchEvent('click')
    await page.locator('.dshd-detail ul li').first().waitFor()
    await search(page, 'Functions')
    await page.evaluate(async () => {
      const input = document.querySelector('.dshd-explorer input')
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      const stage = document.querySelector('.dshd-stage')
      stage.focus({ preventScroll: true })
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await page.locator('.dshd-detail').waitFor({ state: 'hidden' })
    const reopened = await page.evaluate(() => new Promise((resolve) => {
      // One same-view flight lasts at most 650 ms. Observe longer than that,
      // failing even if a stale completion only reopens the panel briefly.
      let found = !!document.querySelector('.dshd-detail')
      const observer = new MutationObserver(() => { found ||= !!document.querySelector('.dshd-detail') })
      observer.observe(document.querySelector('.dshd-stage'), { childList: true, subtree: true })
      setTimeout(() => { observer.disconnect(); resolve(found) }, 900)
    }))
    assert.equal(reopened, false, 'Escape cancels reveal; no later flight callback may reopen the detail')
    await focused(page, 'snet-app')
  } finally { await animated.context.close() }

  assert.equal(await readFile(file, 'utf8'), current, 'Display-only exploration never writes the .c4 file')
  assert.deepEqual((await readdir(historyDir)).filter((name) => name.endsWith('.c4')).sort(), historyNames)
  assert.deepEqual(await Promise.all(historyNames.map((name) => readFile(path.join(historyDir, name), 'utf8'))), historySources, 'Accepted history remains byte-for-byte unchanged')
  assert.equal(await readFile(html, 'utf8'), htmlSource)
  assert.deepEqual(errors, [], 'Browser errors')
  assert.deepEqual(blocked, [], 'Offline exploration attempted network access')
  t.diagnostic(`Screenshot saved in ${path.relative(root, artifacts)}`)
})
