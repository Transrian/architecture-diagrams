// Live viewer served by `serve`; not collected by test/*.test.mjs.
// ARCHD_CHROMIUM=/path/to/chrome node --test test/browser/serve.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { playwright, ready, nodeText, unfoldChip, settled, watchErrors } from '../support/browser.mjs'
import { translator } from '../../src/viewer/translation.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const binary = path.join(root, 'skills/architecture-diagrams/scripts/diagram.mjs')

async function start(file, lang = 'en') {
  const child = spawn(process.execPath, [binary, 'serve', file, '--port', '0', '--lang', lang], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGINT')
    await new Promise((resolve) => child.once('exit', resolve))
  }
  let url
  try {
    url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10_000)
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Server exited ${code}: ${output}`))
      })
      child.stdout.on('data', () => {
        const match = /Serving .* at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      })
    })
  } catch (error) {
    await stop()
    throw error
  }
  return { url, output: () => output, stop }
}

const status = (page) => page.locator('.archd-changes [role=status]').textContent()

test(
  'serve follows edits live, keeps the last valid drawing and compares versions',
  { skip: !process.env.ARCHD_CHROMIUM, timeout: 120_000 },
  async (t) => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'archd-serve-'))
    let browser, server
    const errors = [],
      foreign = []
    t.after(async () => {
      // Stop polling before closing its server or removing its source.
      try {
        await browser?.close()
      } finally {
        try {
          await server?.stop()
        } finally {
          await rm(temporary, { recursive: true, force: true })
        }
      }
      assert.deepEqual(errors, [], 'Browser errors')
      assert.deepEqual(foreign, [], 'The live page only talks to its own server')
    })
    await mkdir(path.join(temporary, '.diagram'))
    const file = path.join(temporary, '.diagram', 'shop.c4')
    const source = await readFile(path.join(root, 'examples/web-shop.c4'), 'utf8')
    await writeFile(file, source)
    server = await start(file)

    const { chromium } = await playwright()
    browser = await chromium.launch({ executablePath: process.env.ARCHD_CHROMIUM, args: ['--no-sandbox'] })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    })
    const origin = new URL(server.url).origin
    await context.route('**/*', (route) => {
      const url = route.request().url()
      if (new URL(url).origin === origin) return route.continue()
      foreign.push(url)
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    // Polling a deleted file answers 404 by design.
    watchErrors(page, errors, 'serve', /status of 404/)
    await page.goto(server.url)
    await ready(page)
    assert.equal(await page.title(), 'shop')
    assert.equal(await page.locator('.archd-header-status').textContent(), 'Live: shop')
    assert.equal(await page.locator('.archd-header-live').count(), 1)
    await page.getByRole('button', { name: 'Web shop', exact: true }).waitFor()

    // Live update, and the server snapshots the accepted version.
    await writeFile(file, source.replace("shop = system 'Web shop'", "shop = system 'Web store'"))
    await page.getByRole('button', { name: 'Web store', exact: true }).waitFor()
    await page.waitForFunction(
      () =>
        /live/.test(document.querySelector('.archd-time')?.textContent ?? '') &&
        !document.querySelector('button[aria-label="Previous version"]')?.disabled,
    )

    // An invalid edit shows its errors over the last valid drawing.
    const valid = await readFile(file, 'utf8')
    await writeFile(file, valid.replace("front = system 'Frontend' {", "front = system 'Frontend' {\n    oops ="))
    await page.locator('.archd-err', { hasText: /L\d+:\d+/ }).waitFor()
    assert.match(await page.locator('.archd-err code').textContent(), /\[IdTerminal\]/)
    assert.ok((await page.locator('.archd-err code').textContent()).length < 1250)
    await nodeText(page, 'Frontend').waitFor()
    await page.getByRole('button', { name: 'Web store', exact: true }).waitFor()
    // The browser parser can beat the server's independent one-second verdict poll.
    const deadline = performance.now() + 20_000
    while (!/does not parse/.test(server.output())) {
      assert.ok(performance.now() < deadline, `Server did not report the invalid edit: ${server.output()}`)
      await delay(50)
    }
    assert.match(server.output(), /does not parse/)

    // Invalid live text still uses the current display options on the last valid source.
    const horizontal = () => {
      const boxes = [...document.querySelectorAll('.archd-stage .archd-node')].map((node) => node.getBoundingClientRect())
      const width = Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left))
      const height = Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top))
      return width > height
    }
    assert.equal(await page.evaluate(horizontal), false)
    await page.getByRole('button', { name: /Layout: vertical/ }).click()
    await page.waitForFunction(horizontal)
    assert.equal(await page.locator('.archd-err').count(), 1, 'The original live parse error remains visible')
    await unfoldChip(page, 'Storage').click()
    await page.locator('.archd-stage .archd-node[data-element="shop.data.db"]').waitFor()
    await page.getByRole('button', { name: 'Fold all', exact: true }).click()
    await page.locator('.archd-stage .archd-node[data-element="shop.data.db"]').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: /Layout: horizontal/ }).click()
    await page.waitForFunction(() => {
      const boxes = [...document.querySelectorAll('.archd-stage .archd-node')].map((node) => node.getBoundingClientRect())
      return Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top)) >
        Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left))
    })
    await writeFile(file, valid)
    await page.locator('.archd-err').waitFor({ state: 'detached' })

    // Timeline over the served snapshots.
    await page.getByRole('button', { name: 'Previous version', exact: true }).click()
    await page.getByRole('button', { name: 'Web shop', exact: true }).waitFor()
    assert.match(await page.locator('.archd-time').textContent(), /v1/)
    await page.getByRole('button', { name: 'Next version', exact: true }).click()
    await page.getByRole('button', { name: 'Web store', exact: true }).waitFor()

    // Observed changes read their baseline from the served history.
    await page.getByRole('button', { name: 'Changes', exact: true }).click()
    await page.waitForFunction(
      () =>
        /Compared with v1.*\+0 added.*Δ1 changed.*↷0 moved.*−0 removed/.test(
          document.querySelector('.archd-changes [role=status]')?.textContent ?? '',
        ),
      null,
      { timeout: 20_000 },
    )
    assert.match(await status(page), /Δ1 changed/)

    // A readability refusal is drawn but does not consume the last accepted notch.
    const refusedTitle = 'A web store title that is far too long to keep as a version'
    await writeFile(file, valid.replace("'Frontend'", `'${refusedTitle}'`))
    await page.locator('.archd-err').waitFor()
    assert.match(await page.locator('.archd-err').textContent(), /^Refused, not kept as a version/)
    assert.doesNotMatch(await page.locator('.archd-err').textContent(), /agent/i)
    assert.equal(await page.locator('.archd-refused').evaluate((banner) =>
      getComputedStyle(banner).borderColor), 'rgba(0, 0, 0, 0.1)')
    await page.locator(`.archd-node[aria-label="${refusedTitle}"]`).waitFor()
    await page.waitForFunction(() => document.querySelector('.archd-time input')?.getAttribute('aria-valuetext') === 'unsaved')
    assert.equal(await page.locator('.archd-time input').getAttribute('max'), '2')
    await page.waitForFunction(() => /Compared with v2.*Δ1 changed/.test(
      document.querySelector('.archd-changes [role=status]')?.textContent ?? ''))
    await mkdir(path.join(root, '.local/serve-check'), { recursive: true })
    await page.screenshot({ path: path.join(root, '.local/serve-check/refused-en.png') })
    await page.getByRole('button', { name: 'Previous version', exact: true }).click()
    await page.getByRole('button', { name: 'Web store', exact: true }).waitFor()
    assert.equal(await page.locator('.archd-time input').getAttribute('aria-valuetext'), 'v2')
    await page.getByRole('button', { name: 'Next version', exact: true }).click()
    await page.locator(`.archd-node[aria-label="${refusedTitle}"]`).waitFor()
    assert.equal(await page.locator('.archd-time input').getAttribute('aria-valuetext'), 'unsaved')
    await writeFile(file, valid)
    await page.locator('.archd-err').waitFor({ state: 'hidden' })

    // Deleting the file empties model-dependent chrome as well as the stage.
    await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    await page.locator('.archd-outline [role=treeitem]').first().waitFor()
    await rm(file)
    await page.getByText('No diagram yet').waitFor()
    await page.screenshot({ path: path.join(root, '.local/serve-check/deleted-en.png') })
    for (const selector of ['.archd-explorer', '.archd-legend', '.archd-time', '.archd-versions', '.archd-changes'])
      assert.equal(await page.locator(selector).count(), 0, `${selector} has no stale content after deletion`)
    await writeFile(file, valid)
    await ready(page)
    await page.getByRole('button', { name: 'Web store', exact: true }).waitFor()
    await page.locator('.archd-outline [role=treeitem]').first().waitFor()
    await page.locator('.archd-legend').waitFor()
    await page.locator('.archd-time').waitFor()
    await page.waitForFunction(() => /Compared with v1/.test(document.querySelector('.archd-changes [role=status]')?.textContent ?? ''))
    await page.screenshot({ path: path.join(root, '.local/serve-check/restored-en.png') })
  },
)

test('serve keeps the drawing and camera on failed polls, reports disconnection and recovers', {
  skip: !process.env.ARCHD_CHROMIUM, timeout: 120_000,
}, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'archd-serve-disconnected-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const file = path.join(temporary, 'shop.c4')
  await writeFile(file, await readFile(path.join(root, 'examples/web-shop.c4'), 'utf8'))
  const { chromium } = await playwright()
  const browser = await chromium.launch({ executablePath: process.env.ARCHD_CHROMIUM, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const errors = []
  const artifacts = path.join(root, '.local/serve-check')
  await mkdir(artifacts, { recursive: true })
  for (const [lang, colorScheme, reducedMotion] of [['en', 'light', 'reduce'], ['fr', 'dark', 'no-preference'], ['zh', 'light', 'reduce']]) {
    const server = await start(file, lang)
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: lang, colorScheme, reducedMotion })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(20_000)
      watchErrors(page, errors, 'disconnection', /status of 503|ERR_FAILED/)
      let failedPolls = 0
      let failure = null
      await page.route('**/api/source', (route) => {
        if (!failure) return route.continue()
        failedPolls++
        return failure === 'transport' ? route.abort('failed') : route.fulfill({ status: 503, body: 'Unavailable' })
      })
      const copy = translator(lang)
      await page.goto(server.url)
      await ready(page)
      await unfoldChip(page, 'Storage').click()
      await page.locator('.archd-node[data-element="shop.data.db"]').waitFor()
      await settled(page)
      await nodeText(page, 'Frontend').click()
      await settled(page)
      const stage = page.locator('.archd-stage')
      const area = await stage.boundingBox()
      await page.mouse.move(area.x + 20, area.y + 20)
      await page.mouse.down()
      await page.mouse.move(area.x + 65, area.y + 45)
      await page.mouse.up()
      await settled(page)
      await stage.evaluate((element) => { window.__archdStageBeforePoll = element })
      const drawing = await stage.locator('> svg').innerHTML()
      failure = 'http'
      await page.waitForFunction((text) => document.querySelector('.archd-header-status')?.textContent === text,
        copy('header.disconnected', { name: 'shop' }))
      assert.equal(await page.locator('.archd-header-live').count(), 0, 'A disconnected page must not claim to be live')
      assert.equal(await stage.evaluate((element) => element === window.__archdStageBeforePoll), true)
      assert.equal(await stage.locator('> svg').innerHTML(), drawing, 'A failed poll must not change the camera or drawing')
      await page.screenshot({ path: path.join(artifacts, `disconnected-${lang}.png`) })
      failure = 'transport'
      await page.waitForFunction(() => !document.querySelector('.archd-busy'))
      const previousPolls = failedPolls
      const deadline = performance.now() + 10_000
      while (failedPolls === previousPolls) {
        assert.ok(performance.now() < deadline, 'Polling must continue while disconnected')
        await delay(50)
      }
      assert.equal(await stage.locator('> svg').innerHTML(), drawing, 'Repeated transport failures also retain the drawing')
      failure = null
      await page.waitForFunction((text) => document.querySelector('.archd-header-live')?.textContent === text,
        copy('header.live', { name: 'shop' }))
      await settled(page)
      assert.equal(await stage.evaluate((element) => element === window.__archdStageBeforePoll), true, 'Recovery must not remount the stage')
      assert.equal(await stage.locator('> svg').innerHTML(), drawing, 'Recovery of the same source preserves the panned camera')
      await page.screenshot({ path: path.join(artifacts, `reconnected-${lang}.png`) })
    } finally {
      await context.close()
      await server.stop()
    }
  }
  assert.deepEqual(errors, [], 'Unexpected browser errors')
})
