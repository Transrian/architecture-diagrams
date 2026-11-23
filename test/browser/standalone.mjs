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
async function settled(page) {
  await page.evaluate(() => { window.__dshdTestFrame = null })
  await page.waitForFunction(() => {
    const svg = document.querySelector('.dshd-stage > svg')?.innerHTML
    const last = window.__dshdTestFrame
    if (!last || last.svg !== svg) window.__dshdTestFrame = { svg, at: performance.now() }
    return last?.svg === svg && performance.now() - last.at > 150
  })
}
async function background(page, expected) {
  await page.waitForFunction((value) => getComputedStyle(document.body).backgroundColor === value, expected)
}

async function watchContext(page, id) {
  await page.evaluate((id) => {
    const token = { active: true, samples: [] }
    window.__dshdContextWatch = token
    const sample = () => {
      const node = document.querySelector(`[data-element="${id}"]`)
      if (node) {
        let opacity = 1
        for (let p = node; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
        token.samples.push(opacity)
      }
      if (token.active) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, id)
}
async function contextSamples(page) {
  return page.evaluate(() => {
    const token = window.__dshdContextWatch
    token.active = false
    return { samples: token.samples, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches }
  })
}

async function zoomUnfolded(page, group, title, children, { leave = true } = {}) {
  const sample = () => page.evaluate(({ group, children }) => {
    const rectOf = (id) => [...document.querySelectorAll('.dshd-node')]
      .filter((node) => node.dataset.element === id)
      .map((node) => {
        let opacity = 1
        for (let p = node; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
        const r = node.querySelector('.dshd-shape').getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, opacity }
      }).sort((a, b) => b.opacity - a.opacity)[0]
    const frame = rectOf(group)
    return {
      focus: document.querySelector('.dshd-crumbs b')?.textContent,
      frame,
      linkOpacity: Math.max(0, ...[...document.querySelectorAll('.dshd-edge')].filter((edge) => edge.textContent === 'filters').map((edge) => {
        let opacity = 1
        for (let p = edge; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
        return opacity
      })),
      children: children.map((id) => {
        const r = rectOf(id)
        return [(r.x - frame.x) / frame.width, (r.y - frame.y) / frame.height, r.width / frame.width, r.height / frame.height]
      }),
    }
  }, { group, children })
  await page.waitForTimeout(550)
  const before = await sample()
  let after = before
  const wheel = async (delta) => {
    const stage = await page.locator('.dshd-stage').boundingBox()
    const x = Math.max(stage.x + 5, Math.min(stage.x + stage.width - 5, after.frame.x + after.frame.width / 2))
    const y = Math.max(stage.y + 5, Math.min(stage.y + stage.height - 5, after.frame.y + after.frame.height / 2))
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, delta)
    await page.waitForTimeout(100)
    after = await sample()
    assert.ok(after.linkOpacity > 0.99, 'an unchanged routed link never blinks during zoom')
    after.children.forEach((rect, index) => rect.forEach((value, axis) => {
      assert.ok(Math.abs(value - before.children[index][axis]) < 0.0001, `${children[index]} keeps its place during zoom`)
    }))
  }
  for (let i = 0; i < 20 && after.focus !== title; i++) await wheel(-90)
  assert.equal(after.focus, title, 'wheel zoom enters the unfolded group')
  if (leave) {
    await watchContext(page, 'azure.prod.shared')
    for (let i = 0; i < 20 && after.focus !== before.focus; i++) await wheel(90)
    assert.equal(after.focus, before.focus, 'zooming out returns to the parent without rearranging boxes')
    await settled(page)
    const transition = await contextSamples(page)
    assert.ok(transition.samples.some((opacity) => opacity > 0.99), 'parent context becomes fully visible')
    if (!transition.reduce) assert.ok(transition.samples.some((opacity) => opacity > 0 && opacity < 0.99), 'new parent context fades in rather than popping')
  }
}

async function scopedNeighbours(page, fitLabel, enterLabel) {
  await unfoldChip(page, 'rg-tracking').click()
  await nodeText(page, 'vnet-tracking').waitFor()
  await zoomUnfolded(page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'], { leave: false })
  const fit = async () => {
    await page.getByRole('button', { name: fitLabel, exact: true }).click()
    await settled(page)
    await focused(page, 'rg-edge')
  }
  await fit()
  for (const id of ['ops', 'azure.prod.shared', 'azure.prod.tracking.vault']) {
    assert.equal(await page.locator(`[data-element="${id}"]`).count(), 0, `${id} is not part of this scope's context`)
  }
  const outside = page.locator('[data-element="azure.prod.tracking"]')
  assert.equal(await outside.locator('[data-chip="fly"]').count(), 1, 'an outside frame has its navigation chip')
  const clipped = await page.evaluate(() => {
    const stage = document.querySelector('.dshd-stage').getBoundingClientRect()
    return [...document.querySelectorAll('.dshd-node')].filter((node) => {
      const r = node.querySelector('.dshd-shape').getBoundingClientRect()
      return r.left < stage.left - 1 || r.top < stage.top - 1 || r.right > stage.right + 1 || r.bottom > stage.bottom + 1
    }).map((node) => node.dataset.element)
  })
  assert.deepEqual(clipped, [], 'Fit includes the frame and every visible neighbour')
  await watchContext(page, 'azure.prod.shared')
  await outside.locator('[data-chip="fly"]').click()
  await focused(page, 'rg-tracking')
  await settled(page)
  const ascent = await contextSamples(page)
  if (!ascent.reduce) assert.ok(ascent.samples.find((opacity) => opacity > 0) < 0.99, 'scripted ascents fade in their new parent context too')
  await page.locator('.dshd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
  await focused(page, 'sub-contoso-prod')
  await settled(page)
  await nodeText(page, 'RG-EDGE').click()
  await page.locator('.dshd-detail').getByRole('button', { name: enterLabel, exact: true }).click()
  await focused(page, 'rg-edge')
  await fit()
  await nodeText(page, 'RG-TRACKING').dblclick()
  await focused(page, 'rg-tracking')
  await settled(page)
  await page.locator('.dshd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
  await focused(page, 'sub-contoso-prod')
  await page.locator('.dshd-stage').click({ position: { x: 10, y: 10 } })
  await nodeText(page, 'RG-EDGE').click()
  await page.waitForFunction(() => document.querySelector('.dshd-detail h4')?.textContent === 'rg-edge')
  await focused(page, 'sub-contoso-prod')
  await nodeText(page, 'vnet-tracking').waitFor()
}

async function interruptOpening(page, enterLabel, mode) {
  await page.locator('nav').getByRole('button', { name: 'Azure', exact: true }).click()
  await focused(page, 'Azure')
  await settled(page)
  await page.locator('.dshd-stage').focus()
  await page.keyboard.press('Escape')
  await nodeText(page, 'sub-contoso-prod').click()
  const result = await page.evaluate(({ enterLabel, mode }) => new Promise((resolve) => {
    const stage = document.querySelector('.dshd-stage'), r = stage.getBoundingClientRect()
    const x = r.left + 30, y = r.bottom - 30
    const samples = []
    let fired = false
    const sample = () => {
      const node = document.querySelector('[data-element="azure.dev"]')
      let opacity = node ? 1 : 0
      for (let p = node; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
      samples.push({ opacity, after: fired })
      if (!fired && opacity > 0.05 && opacity < 0.75) {
        fired = true
        if (mode === 'wheel-in') {
          const box = document.querySelector('[data-element="azure.prod"] .dshd-shape').getBoundingClientRect()
          stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true, cancelable: true }))
        } else if (mode === 'wheel-out') stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, clientX: x, clientY: y, bubbles: true, cancelable: true }))
        else {
          stage.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: x, clientY: y, bubbles: true, pointerId: 1 }))
          stage.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: x, clientY: y, bubbles: true, pointerId: 1 }))
        }
      }
      if (samples.length < 45) requestAnimationFrame(sample)
      else resolve({ fired, samples })
    }
    const button = [...document.querySelectorAll('.dshd-detail button')].find((button) => button.textContent === enterLabel)
    if (!button) throw new Error('Missing Zoom in button before interruption test')
    button.click()
    requestAnimationFrame(sample)
  }), { enterLabel, mode })
  assert.equal(result.fired, true, `${mode} flight was interrupted while partly open: ${JSON.stringify(result.samples.map((sample) => sample.opacity))}`)
  assert.ok(result.samples.find((sample) => sample.after).opacity < 0.99, `${mode} interruption does not snap its visible context back`)
  if (mode === 'pointer') assert.ok(result.samples.at(-1).opacity > 0.99, 'the released group finishes closing')
  if (mode === 'wheel-in') assert.ok(result.samples.at(-1).opacity < result.samples.findLast((sample) => !sample.after).opacity, 'scrolling into the opening group continues opening rather than releasing it')
  const target = mode === 'wheel-in' ? 'sub-contoso-prod' : 'Azure'
  if (mode !== 'pointer') {
    let completed = false
    for (let i = 0; i < 20; i++) {
      const state = await page.evaluate(() => {
        const node = document.querySelector('[data-element="azure.dev"]')
        let opacity = node ? 1 : 0
        for (let p = node; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
        const box = document.querySelector('[data-element="azure.prod"] .dshd-shape').getBoundingClientRect()
        const stage = document.querySelector('.dshd-stage').getBoundingClientRect()
        return { opacity, focus: document.querySelector('.dshd-crumbs b')?.textContent, inside: [box.x + box.width / 2, box.y + box.height / 2], outside: [stage.x + 30, stage.bottom - 30] }
      })
      if (mode === 'wheel-in' ? state.focus === target : state.opacity > 0.99) { completed = true; break }
      await page.mouse.move(...(mode === 'wheel-in' ? state.inside : state.outside))
      await page.mouse.wheel(0, mode === 'wheel-in' ? -90 : 90)
      await page.waitForTimeout(100)
    }
    assert.ok(completed, `${mode} retains control until the gesture completes`)
  }
  await focused(page, target)
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
  async function open(locale, colorScheme, reducedMotion = 'reduce') {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale, colorScheme, reducedMotion, acceptDownloads: true })
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
    await zoomUnfolded(page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'])
    await focused(page, 'sub-contoso-prod')
    await scopedNeighbours(page, 'Fit', 'Zoom in')

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
        await zoomUnfolded(opened.page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'])
        await scopedNeighbours(opened.page, 'Ajuster', 'Zoomer dedans')
      }
      if (expected === 'zh') await opened.page.screenshot({ path: path.join(artifacts, 'standalone-zh.png') })
    } finally { await opened.context.close() }
  }
  for (const [locale, scheme] of [['en-US', 'light'], ['fr-FR', 'dark']]) {
    const opened = await open(locale, scheme, 'no-preference')
    try {
      await nodeText(opened.page, 'sub-contoso-prod').click()
      await opened.page.locator('.dshd-detail').getByRole('button', { name: locale === 'fr-FR' ? 'Zoomer dedans' : 'Zoom in', exact: true }).click()
      await focused(opened.page, 'sub-contoso-prod')
      await unfoldChip(opened.page, 'rg-edge').click()
      await nodeText(opened.page, 'Front Door').waitFor()
      await zoomUnfolded(opened.page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'])
      await scopedNeighbours(opened.page, locale === 'fr-FR' ? 'Ajuster' : 'Fit', locale === 'fr-FR' ? 'Zoomer dedans' : 'Zoom in')
      const fresh = await open(locale, scheme, 'no-preference')
      try {
        for (const mode of ['wheel-out', 'wheel-in', 'pointer']) await interruptOpening(fresh.page, locale === 'fr-FR' ? 'Zoomer dedans' : 'Zoom in', mode)
      } finally { await fresh.context.close() }
    } finally { await opened.context.close() }
  }
  assert.deepEqual(errors, [], 'Browser errors')
  assert.deepEqual(blocked, [], 'Standalone attempted to contact the network')
  t.diagnostic(`Screenshots saved in ${path.relative(root, artifacts)}`)
})
