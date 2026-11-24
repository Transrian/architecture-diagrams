// Optional offline regressions for exploration and observed changes.
// Build the skill first, then opt in (no browser/dependency is needed to skip):
// DSHD_CHROMIUM=/path/to/chrome node --test test/browser/exploration.mjs
// Playwright comes from pinned build dependencies (DSHD_PLAYWRIGHT overrides it).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  playwright,
  ready,
  focused,
  watchErrors,
  denyNetwork,
  renderVersions,
  nodeText,
  frameClock,
  until,
  settled,
} from '../support/browser.mjs'
import { readFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = path.join(root, '.local/exploration-check')
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

async function currentGroup(page, id) {
  const current = page.locator('.dshd-outline [aria-current="location"]')
  assert.equal(await current.count(), 1, 'Only the camera scope is current, not a selected element or its ancestors')
  assert.equal(await current.getAttribute('data-element'), id)
  for (let parts = id.split('.'); parts.length; parts.pop()) {
    assert.equal(
      await page.locator(`.dshd-outline [data-element="${parts.join('.')}"]`).getAttribute('aria-expanded'),
      'true',
      'The current group and its ancestor path open automatically',
    )
  }
  assert.equal(
    await current.locator('> .dshd-tree-row').evaluate((row) => {
      const bounds = row.getBoundingClientRect()
      const panel = row.closest('.dshd-outline').getBoundingClientRect()
      return bounds.top >= panel.top && bounds.bottom <= panel.bottom
    }),
    true,
    'The current row is scrolled into the outline viewport',
  )
}

test(
  'Explorer follows normal group navigation without collapsing other branches or stealing focus',
  {
    skip: !process.env.DSHD_CHROMIUM,
    timeout: 180_000,
  },
  async (t) => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'dshd-explorer-location-'))
    t.after(() => rm(temporary, { recursive: true, force: true }))
    const file = path.join(temporary, 'reference.c4')
    const html = path.join(temporary, 'reference.html')
    const source = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
    await renderVersions(file, [source], { output: html })
    await mkdir(artifacts, { recursive: true })
    const { chromium } = await playwright()
    const browser = await chromium.launch({ executablePath: process.env.DSHD_CHROMIUM, args: ['--no-sandbox'] })
    t.after(() => browser.close())
    const errors = [],
      blocked = []
    for (const motion of ['reduce', 'no-preference'])
      for (const [locale, scheme] of [
        ['en-US', 'light'],
        ['fr-FR', 'dark'],
      ]) {
        await t.test(`${locale}/${scheme}/${motion}`, async (t) => {
          const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            locale,
            colorScheme: scheme,
            reducedMotion: motion,
            serviceWorkers: 'block',
          })
          t.after(() => context.close())
          await denyNetwork(context, blocked)
          const page = await context.newPage()
          watchErrors(page, errors, 'Explorer location')
          await frameClock(page)
          await page.goto(pathToFileURL(html).href)
          await ready(page)
          const fr = locale === 'fr-FR'
          const openExplorer = async () => {
            await page.getByRole('button', { name: 'Explorer', exact: true }).click()
            await until(page, () => document.activeElement?.getAttribute('role') === 'combobox')
          }
          const enter = async (title, id, tracking = true) => {
            await settled(page)
            await nodeText(page, title).click()
            await page
              .locator('.dshd-detail')
              .getByRole('button', { name: fr ? 'Zoomer dedans' : 'Zoom in', exact: true })
              .click()
            await focused(page, title)
            if (tracking) await currentGroup(page, id)
            assert.equal(
              await page.evaluate(() => !!document.activeElement?.closest('.dshd-outline')),
              false,
              'Camera navigation must not focus a tree row',
            )
          }
          await focused(page, 'Azure')
          await openExplorer()
          await currentGroup(page, 'azure')
          const depots = page.locator('.dshd-outline [data-element="ops.depots"]')
          await depots.locator('> .dshd-tree-row button').click()
          await page.locator('.dshd-outline [data-element="azure"] > .dshd-tree-row button').click()
          await enter('sub-contoso-prod', 'azure.prod')
          assert.equal(await depots.getAttribute('aria-expanded'), 'true', 'An unrelated manually opened branch stays open')

          const current = page.locator('.dshd-outline [aria-current="location"] > .dshd-tree-row')
          const other = page.locator('.dshd-outline [data-element="azure.prod.edge"] > .dshd-tree-row')
          const color = (row) => getComputedStyle(row).backgroundColor
          assert.notEqual(await current.evaluate(color), await other.evaluate(color), 'The location has a distinct theme-aware background')
          await current.hover()
          assert.notEqual(await current.evaluate(color), await other.evaluate(color), 'Hover must not erase the location highlight')
          assert.notEqual(
            await current.evaluate((row) => getComputedStyle(row).boxShadow),
            'none',
            'A non-colour location bar supplements the tint',
          )
          const groupAccent = await page
            .locator('.dshd-stage [data-element="azure.prod.tracking"] .dshd-kind')
            .first()
            .evaluate((label) => getComputedStyle(label).fill)
          assert.ok(
            (await current.evaluate((row) => getComputedStyle(row).boxShadow)).includes(groupAccent),
            'The location bar uses the same teal as the canvas groups',
          )
          const contrast = await current.evaluate((row) => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const context = canvas.getContext('2d')
            const luminance = (color) => {
              context.fillStyle = color
              context.fillRect(0, 0, 1, 1)
              const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
                const channel = value / 255
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
              })
              return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
            }
            const foreground = luminance(getComputedStyle(row.querySelector('.dshd-tree-title')).color)
            const background = luminance(getComputedStyle(row).backgroundColor)
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          })
          assert.ok(contrast >= 4.5, `The tinted current-group title stays readable (${contrast.toFixed(2)}:1)`)

          await page.locator('.dshd-outline [data-element="azure.prod"] > .dshd-tree-row button').click()
          await until(
            page,
            () => document.querySelector('.dshd-outline [data-element="azure.prod"]')?.getAttribute('aria-expanded') === 'false',
          )
          await page.locator('.dshd-outline').evaluate((panel) => {
            panel.scrollTop = panel.scrollHeight
          })
          await enter('rg-tracking', 'azure.prod.tracking')
          await enter('vnet-tracking', 'azure.prod.tracking.vnet')
          await enter('snet-app', 'azure.prod.tracking.vnet.app')
          await settled(page)
          await nodeText(page, 'Functions').click()
          await selected(page, ids.functions)
          await currentGroup(page, 'azure.prod.tracking.vnet.app')
          await page.locator('.dshd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
          await focused(page, 'sub-contoso-prod')
          await currentGroup(page, 'azure.prod')
          assert.equal(await depots.getAttribute('aria-expanded'), 'true')

          await page.getByRole('button', { name: 'Explorer', exact: true }).click()
          await enter('rg-tracking', 'azure.prod.tracking', false)
          await openExplorer()
          await currentGroup(page, 'azure.prod.tracking')
          await page.locator('.dshd-flow').first().click()
          await until(page, () => !!document.querySelector('.dshd-flow[aria-current=true]'))
          assert.equal(await page.locator('.dshd-outline [aria-current]').count(), 0, 'A flow is not a group location')
          await page
            .locator('.dshd-crumbs')
            .getByRole('button', { name: fr ? 'Quitter le flux' : 'Leave flow', exact: true })
            .click()
          await focused(page, 'rg-tracking')
          await currentGroup(page, 'azure.prod.tracking')
          await settled(page)
          await page.screenshot({ path: path.join(artifacts, `explorer-location-${locale}-${motion}.png`) })
          await page.setViewportSize({ width: 780, height: 1000 })
          await page.locator('.dshd-explorer.dshd-overlay').waitFor()
          await page.locator('.dshd-outline [aria-current="location"] > .dshd-tree-row').click()
          await page.locator('.dshd-explorer').waitFor({ state: 'hidden' })
          await focused(page, 'rg-tracking')
          await openExplorer()
          await currentGroup(page, 'azure.prod.tracking')
        })
      }
    assert.deepEqual(errors, [], 'Browser errors')
    assert.deepEqual(blocked, [], 'Explorer location stays offline')
    assert.equal(await readFile(file, 'utf8'), source, 'Location tracking is display-only')
  },
)

// No HTTP server or replacement GUI: exercise the actual self-contained file://
// bundle, including its embedded history and lazy engine, with network denied.
test(
  'offline exploration preserves selection, traces exact links and compares saved versions',
  {
    skip: !process.env.DSHD_CHROMIUM,
    timeout: 180_000,
  },
  async (t) => {
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
    await renderVersions(file, [original, current], { output: html })
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
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        locale: 'en-US',
        colorScheme: 'light',
        reducedMotion,
        serviceWorkers: 'block',
      })
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
      assert.deepEqual(Object.keys(JSON.parse(embeddedBefore).history).sort(), historyNames)

      // Full-model search reveals a deeply nested leaf, not an ambiguous short id.
      await reveal(page, 'Cosmos', ids.cosmos, 'snet-data')
      assert.equal(await page.locator('.dshd-detail').getByRole('button', { name: 'Reveal', exact: true }).count(), 0)
      await page.locator('.dshd-crumbs').getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')
      await selected(page, ids.cosmos)
      await page.locator('.dshd-node[data-element="azure.prod"] .dshd-contains-selection').waitFor()
      assert.equal(
        await page.locator(`.dshd-stage .dshd-node[data-element="${ids.cosmos}"]`).count(),
        0,
        'The leaf is hidden, not silently deselected',
      )
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
      assert.equal(
        await page.locator('.dshd-stage').evaluate((stage) => {
          const id = stage.getAttribute('aria-activedescendant')
          return !!id && document.getElementById(id)?.getAttribute('role') === 'option'
        }),
        true,
        'Spatial keyboard focus owns a real accessible option without changing selection',
      )

      // The alternate text tree has real DOM roving focus and native tree keys.
      // An empty explorer field shows the tree; ArrowDown moves from the field into it.
      const field = await explorer(page)
      await field.fill('')
      await currentGroup(page, 'ops.depots.north')
      assert.equal(
        await field.evaluate((input) => document.activeElement === input),
        true,
        'Returning from search opens the current path without stealing search focus',
      )
      await field.press('ArrowDown')
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'treeitem')
      const azure = page.locator('.dshd-outline [role=treeitem][data-element="azure"]')
      await azure.focus()
      assert.equal(await azure.getAttribute('aria-expanded'), 'true')
      await azure.press('ArrowLeft')
      await page.waitForFunction(
        () => document.querySelector('.dshd-outline [data-element="azure"]')?.getAttribute('aria-expanded') === 'false',
      )
      await azure.press('ArrowRight')
      await page.waitForFunction(
        () => document.querySelector('.dshd-outline [data-element="azure"]')?.getAttribute('aria-expanded') === 'true',
      )
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
      await page.waitForFunction(() =>
        /Compared with v1.*\+0 added.*Δ1 changed.*↷0 moved.*−0 removed/.test(
          document.querySelector('.dshd-changes [role=status]')?.textContent ?? '',
        ),
      )
      assert.deepEqual(await shapes(page), beforeChanges, 'Change overlays never modify the layout shapes')
      await page.getByRole('button', { name: 'Operations updated', exact: true }).click()
      await focused(page, 'Operations updated')
      await page.waitForFunction(() => document.querySelector('.dshd-node[data-element="ops"] .dshd-change-badge')?.textContent === 'Δ1')
      await page.getByRole('button', { name: 'Previous version', exact: true }).click()
      await page.waitForFunction(
        () =>
          document.querySelector('.dshd-changes [role=status]')?.textContent ===
          'This is the first version; there is no previous baseline.',
      )
      await focused(page, 'Operations')
      assert.equal(await page.locator('.dshd-change-badge').count(), 0, 'The first version must not fabricate an empty-model diff')
      await page.getByRole('button', { name: 'Next version', exact: true }).click()
      await focused(page, 'Operations updated')
      await page.waitForFunction(() => /Δ1 changed/.test(document.querySelector('.dshd-changes [role=status]')?.textContent ?? ''))
      assert.equal(
        await page.locator('#dshd-data').textContent(),
        embeddedBefore,
        'Exploration does not rewrite embedded sources or history',
      )
      await page.screenshot({ path: path.join(artifacts, 'exploration-light.png') })
    } finally {
      await opened.context.close()
    }

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
      const reopened = await page.evaluate(
        () =>
          new Promise((resolve) => {
            // One same-view flight lasts at most 650 ms. Observe longer than that,
            // failing even if a stale completion only reopens the panel briefly.
            let found = !!document.querySelector('.dshd-detail')
            const observer = new MutationObserver(() => {
              found ||= !!document.querySelector('.dshd-detail')
            })
            observer.observe(document.querySelector('.dshd-stage'), { childList: true, subtree: true })
            setTimeout(() => {
              observer.disconnect()
              resolve(found)
            }, 900)
          }),
      )
      assert.equal(reopened, false, 'Escape cancels reveal; no later flight callback may reopen the detail')
      await focused(page, 'snet-app')
    } finally {
      await animated.context.close()
    }

    assert.equal(await readFile(file, 'utf8'), current, 'Display-only exploration never writes the .c4 file')
    assert.deepEqual((await readdir(historyDir)).filter((name) => name.endsWith('.c4')).sort(), historyNames)
    assert.deepEqual(
      await Promise.all(historyNames.map((name) => readFile(path.join(historyDir, name), 'utf8'))),
      historySources,
      'Accepted history remains byte-for-byte unchanged',
    )
    assert.equal(await readFile(html, 'utf8'), htmlSource)
    assert.deepEqual(errors, [], 'Browser errors')
    assert.deepEqual(blocked, [], 'Offline exploration attempted network access')
    t.diagnostic(`Screenshot saved in ${path.relative(root, artifacts)}`)
  },
)
