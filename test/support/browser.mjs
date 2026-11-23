import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export async function playwright(env = process.env) {
  const require = createRequire(new URL('../../build/package.json', import.meta.url))
  return require(env.DSHD_PLAYWRIGHT ? path.resolve(env.DSHD_PLAYWRIGHT) : 'playwright-core')
}

export async function preflightBrowser(env = process.env) {
  assert.ok(env.DSHD_CHROMIUM, 'Set DSHD_CHROMIUM to a full Chromium executable; complete verification never skips browser tests')
  await access(env.DSHD_CHROMIUM, constants.X_OK)
  const { chromium } = await playwright(env)
  const browser = await chromium.launch({ executablePath: env.DSHD_CHROMIUM, args: ['--no-sandbox'] })
  await browser.close()
}

export async function ready(page) {
  await page.locator('.dshd-stage > svg').waitFor({ timeout: 30_000 })
  await page.locator('.dshd-stage .dshd-node').first().waitFor()
  await page.waitForFunction(() => document.querySelector('.dshd-stage .dshd-ico'))
  assert.equal(await page.getByRole('button', { name: /PNG/i }).count(), 0, 'PNG export must not be available')
}
const escaped = (title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const nodeText = (page, title) => page.locator('.dshd-stage svg text').filter({ hasText: new RegExp('^' + escaped(title) + '$') }).first()
export const unfoldChip = (page, title) => page.locator('.dshd-stage .dshd-node').filter({ has: page.locator('text', { hasText: new RegExp('^' + escaped(title) + '$') }) }).locator('.dshd-count-chip').first()
export const foldChip = (page, title) => page.locator('.dshd-stage .dshd-node').filter({ has: page.locator('text', { hasText: new RegExp('^' + escaped(title)) }) }).locator('.dshd-chip:not(.dshd-count-chip)').first()
export async function focused(page, title) {
  await page.waitForFunction((value) => document.querySelector('.dshd-crumbs b')?.textContent === value, title)
}
export async function settled(page) {
  await page.evaluate(() => { window.__dshdTestFrame = null })
  await page.waitForFunction(() => {
    const svg = document.querySelector('.dshd-stage > svg')?.innerHTML
    const last = window.__dshdTestFrame
    if (!last || last.svg !== svg) window.__dshdTestFrame = { svg, at: performance.now() }
    return !!svg && last?.svg === svg && performance.now() - last.at > 150
  })
}
export function watchErrors(page, errors, prefix, expectedFailure = {}) {
  page.on('pageerror', error => errors.push(`${prefix}: ${error.message}`))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (expectedFailure.active && /^\[dsh-diagram\] HTML export Error: Simulated HTML chunk load failure/.test(message.text())) expectedFailure.console++
    else errors.push(`${prefix}: ${message.text()}`)
  })
  page.on('dialog', async dialog => { errors.push(`${prefix}: unexpected modal: ${dialog.message()}`); await dialog.dismiss() })
}
export async function denyNetwork(context, blocked) {
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith('file:')) return route.continue()
    blocked.push(url)
    return route.abort()
  })
}
