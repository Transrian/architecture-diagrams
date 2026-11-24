// Optional offline regressions for exploration and observed changes.
// Build the skill first, then opt in (no browser/dependency is needed to skip):
// ARCHD_CHROMIUM=/path/to/chrome node --test test/browser/exploration.mjs
// Playwright comes from pinned build dependencies (ARCHD_PLAYWRIGHT overrides it).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { translator } from '../../src/viewer/translation.js'
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
  await page.waitForFunction((value) => document.querySelector('.archd-detail')?.textContent.includes(value), id)
}
// The explorer (search field above the outline) is docked at this width: it stays open between reveals.
async function explorer(page) {
  if (!(await page.locator('.archd-explorer').count())) await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.archd-explorer.archd-docked').waitFor()
  return page.getByRole('combobox', { name: 'Search', exact: true })
}
async function search(page, text) {
  const input = await explorer(page)
  await input.fill(text)
  await page.locator('.archd-explorer [role=option]').first().waitFor()
  return input
}
async function reveal(page, text, id, scope) {
  const input = await search(page, text)
  await input.press('Enter')
  await focused(page, scope)
  await selected(page, id)
  await page.locator(`.archd-stage .archd-node[data-element="${id}"]`).waitFor()
}
const shapes = (page) => page.locator('.archd-stage svg .archd-shape').evaluateAll((nodes) => nodes.map((node) => node.outerHTML))

async function currentGroup(page, id) {
  const current = page.locator('.archd-outline [aria-current="location"]')
  assert.equal(await current.count(), 1, 'Only the camera scope is current, not a selected element or its ancestors')
  assert.equal(await current.getAttribute('data-element'), id)
  for (let parts = id.split('.'); parts.length; parts.pop()) {
    assert.equal(
      await page.locator(`.archd-outline [data-element="${parts.join('.')}"]`).getAttribute('aria-expanded'),
      'true',
      'The current group and its ancestor path open automatically',
    )
  }
  assert.equal(
    await current.locator('> .archd-tree-row').evaluate((row) => {
      const bounds = row.getBoundingClientRect()
      const panel = row.closest('.archd-outline').getBoundingClientRect()
      return bounds.top >= panel.top && bounds.bottom <= panel.bottom
    }),
    true,
    'The current row is scrolled into the outline viewport',
  )
}

describe(
  'Explorer follows normal group navigation without collapsing other branches or stealing focus',
  { skip: !process.env.ARCHD_CHROMIUM, concurrency: false },
  () => {
    let temporary, file, html, source, browser
    const errors = [], blocked = []
    before(async () => {
      temporary = await mkdtemp(path.join(tmpdir(), 'archd-explorer-location-'))
      file = path.join(temporary, 'reference.c4')
      html = path.join(temporary, 'reference.html')
      source = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
      await renderVersions(file, [source], { output: html })
      await mkdir(artifacts, { recursive: true })
      const { chromium } = await playwright()
      browser = await chromium.launch({ executablePath: process.env.ARCHD_CHROMIUM, args: ['--no-sandbox'] })
    }, { timeout: 60_000 })
    after(async () => {
      await browser?.close()
      try {
        assert.deepEqual(errors, [], 'Browser errors')
        assert.deepEqual(blocked, [], 'Explorer stays offline')
        if (file) assert.equal(await readFile(file, 'utf8'), source, 'Exploration is display-only')
      } finally {
        if (temporary) await rm(temporary, { recursive: true, force: true })
      }
    })
    for (const motion of ['reduce', 'no-preference'])
      for (const [locale, scheme] of [
        ['en-US', 'light'],
        ['fr-FR', 'dark'],
      ]) {
        test(`${locale}/${scheme}/${motion}`, { timeout: 120_000 }, async (t) => {
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
              .locator('.archd-detail')
              .getByRole('button', { name: fr ? 'Zoomer dedans' : 'Zoom in', exact: true })
              .click()
            await focused(page, title)
            if (tracking) await currentGroup(page, id)
            assert.equal(
              await page.evaluate(() => !!document.activeElement?.closest('.archd-outline')),
              false,
              'Camera navigation must not focus a tree row',
            )
          }
          await focused(page, 'Azure')
          await openExplorer()
          await currentGroup(page, 'azure')
          const depots = page.locator('.archd-outline [data-element="ops.depots"]')
          await depots.locator('> .archd-tree-row button').click()
          await page.locator('.archd-outline [data-element="azure"] > .archd-tree-row button').click()
          await enter('sub-contoso-prod', 'azure.prod')
          assert.equal(await depots.getAttribute('aria-expanded'), 'true', 'An unrelated manually opened branch stays open')

          const current = page.locator('.archd-outline [aria-current="location"] > .archd-tree-row')
          const other = page.locator('.archd-outline [data-element="azure.prod.edge"] > .archd-tree-row')
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
            .locator('.archd-stage [data-element="azure.prod.tracking"] .archd-kind')
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
            const foreground = luminance(getComputedStyle(row.querySelector('.archd-tree-title')).color)
            const background = luminance(getComputedStyle(row).backgroundColor)
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          })
          assert.ok(contrast >= 4.5, `The tinted current-group title stays readable (${contrast.toFixed(2)}:1)`)

          await page.locator('.archd-outline [data-element="azure.prod"] > .archd-tree-row button').click()
          await until(
            page,
            () => document.querySelector('.archd-outline [data-element="azure.prod"]')?.getAttribute('aria-expanded') === 'false',
          )
          await page.locator('.archd-outline').evaluate((panel) => {
            panel.scrollTop = panel.scrollHeight
          })
          await enter('rg-tracking', 'azure.prod.tracking')
          await enter('vnet-tracking', 'azure.prod.tracking.vnet')
          await enter('snet-app', 'azure.prod.tracking.vnet.app')
          await settled(page)
          await nodeText(page, 'Functions').click()
          await selected(page, ids.functions)
          await currentGroup(page, 'azure.prod.tracking.vnet.app')
          await page.locator('.archd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
          await focused(page, 'sub-contoso-prod')
          await currentGroup(page, 'azure.prod')
          assert.equal(await depots.getAttribute('aria-expanded'), 'true')

          await page.getByRole('button', { name: 'Explorer', exact: true }).click()
          await enter('rg-tracking', 'azure.prod.tracking', false)
          await openExplorer()
          await currentGroup(page, 'azure.prod.tracking')
          await page.locator('.archd-flow').first().click()
          await until(page, () => !!document.querySelector('.archd-flow[aria-current=true]'))
          assert.equal(await page.locator('.archd-outline [aria-current]').count(), 0, 'A flow is not a group location')
          await page
            .locator('.archd-crumbs')
            .getByRole('button', { name: fr ? 'Quitter le flux' : 'Leave flow', exact: true })
            .click()
          await focused(page, 'rg-tracking')
          await currentGroup(page, 'azure.prod.tracking')
          await settled(page)
          await page.screenshot({ path: path.join(artifacts, `explorer-location-${locale}-${motion}.png`) })
          await page.setViewportSize({ width: 780, height: 1000 })
          await page.locator('.archd-explorer.archd-overlay').waitFor()
          await page.locator('.archd-outline [aria-current="location"] > .archd-tree-row').click()
          await page.locator('.archd-explorer').waitFor({ state: 'hidden' })
          await focused(page, 'rg-tracking')
          await openExplorer()
          await currentGroup(page, 'azure.prod.tracking')
        })
      }
    test('Explorer reveal from an open flow on a wide stage', { timeout: 60_000 }, async (t) => {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 }, locale: 'en', colorScheme: 'light', reducedMotion: 'reduce',
      })
      t.after(() => context.close())
      await denyNetwork(context, blocked)
      const page = await context.newPage()
      watchErrors(page, errors, 'flow reveal')
      await page.goto(pathToFileURL(html).href)
      await ready(page)
      for (const width of [1200, 1440]) {
        await page.setViewportSize({ width, height: 800 })
        await page.locator('nav').getByRole('button', { name: 'Azure', exact: true }).click()
        await focused(page, 'Azure')
        await settled(page)
        await page.locator('.archd-flow').first().click()
        await page.locator('.archd-flow[aria-current=true]').waitFor()
        await settled(page)
        const input = await search(page, 'Cosmos')
        await input.press('Enter')
        await settled(page)
        await page.screenshot({ path: path.join(artifacts, `flow-reveal-${width}.png`) })
        assert.equal(await page.locator('.archd-crumbs b').textContent(), 'snet-data', 'Reveal leaves the flow for the leaf’s scope')
        await selected(page, ids.cosmos)
        const node = page.locator(`.archd-stage .archd-node[data-element="${ids.cosmos}"]`)
        assert.equal(await node.isVisible(), true, 'The selected leaf is drawn in its context')
        assert.equal(await page.locator('.archd-detail').getByRole('button', {
          name: 'Reveal', exact: true,
        }).count(), 0, 'The selection is not hidden after reveal')
      }
    })
  },
)

test('tracing a collapsed group projects its descendants’ exact links and explains seed counts', {
  skip: !process.env.ARCHD_CHROMIUM, timeout: 120_000,
}, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'archd-group-trace-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const html = path.join(temporary, 'reference.html')
  const source = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
  await renderVersions(path.join(temporary, 'reference.c4'), [source], { output: html })
  await mkdir(artifacts, { recursive: true })
  const { chromium } = await playwright()
  const browser = await chromium.launch({ executablePath: process.env.ARCHD_CHROMIUM, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const errors = [], blocked = []
  for (const [lang, colorScheme, reducedMotion] of [['en', 'light', 'reduce'], ['fr', 'dark', 'no-preference'], ['zh', 'light', 'reduce']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang, colorScheme, reducedMotion })
    try {
      await denyNetwork(context, blocked)
      const page = await context.newPage()
      watchErrors(page, errors, 'group trace')
      await frameClock(page)
      await page.goto(pathToFileURL(html).href)
      await ready(page)
      await settled(page)
      const copy = translator(lang)
      await nodeText(page, 'sub-contoso-prod').click()
      for (const mode of ['neighbours', 'upstream', 'downstream']) {
        await page.locator('.archd-detail').getByRole('button', { name: copy('trace.' + mode), exact: true }).click()
        await until(page, (suffix) => document.querySelector('.archd-trace [role=status]')?.textContent.includes(suffix),
          copy('trace.groupSummary', { summary: '' }).trim())
        assert.ok(await page.locator('.archd-stage .archd-edge').evaluateAll((edges) => edges.some((edge) => {
          let opacity = 1
          for (let parent = edge; parent instanceof Element; parent = parent.parentElement) {
            opacity *= Number(getComputedStyle(parent).opacity)
          }
          return opacity > 0.99
        })), `${lang}/${mode}: exact descendant links stay highlighted on the collapsed view`)
        if (mode === 'downstream') await page.screenshot({ path: path.join(artifacts, `group-trace-${lang}.png`) })
        await page.getByRole('button', { name: copy('trace.clear'), exact: true }).click()
      }
    } finally { await context.close() }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(blocked, [])
})

// No HTTP server or replacement GUI: exercise the actual self-contained file://
// bundle, including its embedded history and lazy engine, with network denied.
test(
  'offline exploration preserves selection, traces exact links and compares saved versions',
  {
    skip: !process.env.ARCHD_CHROMIUM,
    timeout: 180_000,
  },
  async (t) => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'archd-exploration-'))
    t.after(async () => {
      // Verify the absolute deletion target is precisely this test's allocation.
      assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
      assert.match(path.basename(temporary), /^archd-exploration-/)
      await rm(temporary, { recursive: true, force: true })
    })
    await mkdir(artifacts, { recursive: true })
    const diagramDir = path.join(temporary, '.diagram')
    await mkdir(diagramDir)
    const file = path.join(diagramDir, 'reference.c4')
    const html = path.join(diagramDir, 'reference.html')
    const original = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
    const current = original.replace("ops = system 'Operations'", "ops = system 'Operations updated'")
      .replace("'ingest scan events, validate, publish'", "'validate and publish scan events'")
      .replace("'func test 58/58'", `'New proof ${'x'.repeat(200)}'`)
      .replace("'POST /scans'", "'POST /events'")
    assert.notEqual(current, original, 'The second accepted version changes element fields and a link label')
    await renderVersions(file, [original, current], { output: html })
    const historyDir = path.join(diagramDir, 'reference')
    const historyNames = (await readdir(historyDir)).filter((name) => name.endsWith('.c4')).sort()
    assert.equal(historyNames.length, 2, 'CLI embeds two genuinely accepted versions')
    const historySources = await Promise.all(historyNames.map((name) => readFile(path.join(historyDir, name), 'utf8')))
    assert.deepEqual(historySources, [original, current])
    const htmlSource = await readFile(html, 'utf8')

    const { chromium } = await playwright()
    const browser = await chromium.launch({ executablePath: process.env.ARCHD_CHROMIUM, headless: true, args: ['--no-sandbox'] })
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
      const embeddedBefore = await page.locator('#archd-data').textContent()
      assert.deepEqual(Object.keys(JSON.parse(embeddedBefore).history).sort(), historyNames)

      // Full-model search reveals a deeply nested leaf, not an ambiguous short id.
      await reveal(page, 'Cosmos', ids.cosmos, 'snet-data')
      assert.equal(await page.locator('.archd-detail').getByRole('button', { name: 'Reveal', exact: true }).count(), 0)
      await page.locator('.archd-crumbs').getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')
      await selected(page, ids.cosmos)
      await page.locator('.archd-node[data-element="azure.prod"] .archd-contains-selection').waitFor()
      assert.equal(
        await page.locator(`.archd-stage .archd-node[data-element="${ids.cosmos}"]`).count(),
        0,
        'The leaf is hidden, not silently deselected',
      )
      await page.locator('.archd-detail').getByRole('button', { name: 'Reveal', exact: true }).click()
      await focused(page, 'snet-data')
      await selected(page, ids.cosmos)
      await page.locator(`.archd-node[data-element="${ids.cosmos}"] .archd-halo`).waitFor()

      // Traverse the original graph across group boundaries; Escape clears trace
      // before it clears the persistent element selection.
      await reveal(page, 'Handheld scanners', ids.scanners, 'Depot North')
      await page.locator('.archd-detail').getByRole('button', { name: 'Downstream', exact: true }).click()
      await page.waitForFunction(() => /\b24 elements\b/.test(document.querySelector('.archd-trace [role=status]')?.textContent ?? ''))
      await page.locator('.archd-stage').press('Escape')
      await page.locator('.archd-trace').waitFor({ state: 'hidden' })
      await selected(page, ids.scanners)
      await page.locator('.archd-stage').press('ArrowRight')
      await selected(page, ids.scanners)
      assert.equal(
        await page.locator('.archd-stage').evaluate((stage) => {
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
      const azure = page.locator('.archd-outline [role=treeitem][data-element="azure"]')
      await azure.focus()
      assert.equal(await azure.getAttribute('aria-expanded'), 'true')
      await azure.press('ArrowLeft')
      await page.waitForFunction(
        () => document.querySelector('.archd-outline [data-element="azure"]')?.getAttribute('aria-expanded') === 'false',
      )
      await azure.press('ArrowRight')
      await page.waitForFunction(
        () => document.querySelector('.archd-outline [data-element="azure"]')?.getAttribute('aria-expanded') === 'true',
      )
      await azure.press('ArrowRight')
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-element') === 'azure.prod')
      await page.keyboard.press('Enter')
      await focused(page, 'sub-contoso-prod')
      await selected(page, 'azure.prod')
      // Docked, the explorer keeps the keyboard after a reveal; Escape in it closes it.
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.archd-explorer')), true)
      await page.keyboard.press('Escape')
      await page.locator('.archd-explorer').waitFor({ state: 'hidden' })

      // Observed changes do not alter shape geometry or replace declared state.
      const beforeChanges = await shapes(page)
      await page.getByRole('button', { name: 'Changes', exact: true }).click()
      assert.equal(await page.locator('.archd-comparison-controls select').first().inputValue(), 'previous')
      await page.waitForFunction(() =>
        /Compared with v1.*\+0 added.*Δ2 changed.*↷0 moved.*−0 removed/.test(
          document.querySelector('.archd-changes [role=status]')?.textContent ?? '',
        ),
      )
      assert.deepEqual(await shapes(page), beforeChanges, 'Change overlays never modify the layout shapes')
      await reveal(page, 'sub-contoso-prod', 'azure.prod', 'sub-contoso-prod')
      assert.equal(await page.locator('.archd-node-changes h5').textContent(), 'Observed changes (including descendants)')
      await reveal(page, 'Functions', ids.functions, 'snet-app')
      assert.equal(await page.locator('.archd-node-changes h5').textContent(), 'Observed changes')
      const badgeSize = await page.locator(`.archd-node[data-element="${ids.functions}"]`).evaluate((node) => ({
        badge: node.querySelector('.archd-change-badge rect').getBoundingClientRect().height,
        pill: node.querySelector('.archd-pill-mark rect').getBoundingClientRect().height,
        badgeFont: parseFloat(getComputedStyle(node.querySelector('.archd-change-badge text')).fontSize),
        pillFont: parseFloat(getComputedStyle(node.querySelector('.archd-pill-mark text')).fontSize),
      }))
      assert.ok(badgeSize.badge >= badgeSize.pill - 0.01, 'Change badges are at least as tall as state pills at the same zoom')
      assert.ok(badgeSize.badgeFont >= badgeSize.pillFont, 'Change text is no smaller than the state text on the same node')
      const fields = page.locator('.archd-node-changes .archd-field-values')
      assert.match(await fields.textContent(), /ingest scan events, validate, publish.*→.*validate and publish scan events/)
      assert.match(await fields.textContent(), /func test 58\/58.*→.*New proof/)
      assert.ok((await fields.locator('dd').last().textContent()).endsWith('…'), 'Long metadata values are bounded')
      await page.screenshot({ path: path.join(artifacts, 'changed-fields-light.png') })
      await page.locator('.archd-changes summary').filter({ hasText: 'Changed link details' }).click()
      assert.match(await page.locator('.archd-changes .archd-field-values').textContent(), /POST \/scans.*→.*POST \/events/)
      await page.locator('.archd-changes summary').filter({ hasText: 'Changed link details' }).click()
      await page.locator('nav').getByRole('button', { name: 'Operations updated', exact: true }).click()
      await focused(page, 'Operations updated')
      await page.waitForFunction(() => document.querySelector('.archd-node[data-element="ops"] .archd-change-badge')?.textContent === 'Δ1')
      await page.getByRole('button', { name: 'Previous version', exact: true }).click()
      await page.waitForFunction(
        () =>
          document.querySelector('.archd-changes [role=status]')?.textContent ===
          'This is the first version; there is no previous baseline.',
      )
      await focused(page, 'Operations')
      assert.equal(await page.locator('.archd-change-badge').count(), 0, 'The first version must not fabricate an empty-model diff')
      await page.getByRole('button', { name: 'Next version', exact: true }).click()
      await focused(page, 'Operations updated')
      await page.waitForFunction(() => /Δ2 changed/.test(document.querySelector('.archd-changes [role=status]')?.textContent ?? ''))
      assert.equal(
        await page.locator('#archd-data').textContent(),
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
      await page.locator(`.archd-node[data-element="${ids.apim}"] .archd-reveal`).waitFor()
      await page.locator('.archd-stage .archd-edge').first().dispatchEvent('click')
      await page.locator('.archd-detail ul li').first().waitFor()
      await search(page, 'Functions')
      await page.evaluate(async () => {
        const input = document.querySelector('.archd-explorer input')
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        const stage = document.querySelector('.archd-stage')
        stage.focus({ preventScroll: true })
        stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      await page.locator('.archd-detail').waitFor({ state: 'hidden' })
      const reopened = await page.evaluate(
        () =>
          new Promise((resolve) => {
            // One same-view flight lasts at most 650 ms. Observe longer than that,
            // failing even if a stale completion only reopens the panel briefly.
            let found = !!document.querySelector('.archd-detail')
            const observer = new MutationObserver(() => {
              found ||= !!document.querySelector('.archd-detail')
            })
            observer.observe(document.querySelector('.archd-stage'), { childList: true, subtree: true })
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
