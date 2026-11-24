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
import { playwright, ready, nodeText, watchErrors } from '../support/browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const binary = path.join(root, 'skills/architecture-diagrams/scripts/diagram.mjs')

async function start(file) {
  const child = spawn(process.execPath, [binary, 'serve', file, '--port', '0', '--lang', 'en'], {
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
    await nodeText(page, 'Frontend').waitFor()
    await page.getByRole('button', { name: 'Web store', exact: true }).waitFor()
    // The browser parser can beat the server's independent one-second verdict poll.
    const deadline = performance.now() + 20_000
    while (!/does not parse/.test(server.output())) {
      assert.ok(performance.now() < deadline, `Server did not report the invalid edit: ${server.output()}`)
      await delay(50)
    }
    assert.match(server.output(), /does not parse/)
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

    // Deleting the file empties the page instead of keeping a stale drawing.
    await rm(file)
    await page.getByText('No diagram yet').waitFor()
    await writeFile(file, valid)
    await ready(page)
    await page.getByRole('button', { name: 'Web store', exact: true }).waitFor()
  },
)
