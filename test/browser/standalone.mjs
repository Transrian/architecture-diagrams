// Optional offline browser smoke test; not collected by test/*.test.mjs.
// DSHD_CHROMIUM=/path/to/chrome node --test test/browser/standalone.mjs
// Playwright comes from pinned build dependencies (DSHD_PLAYWRIGHT overrides it).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir, availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  playwright,
  ready,
  focused,
  settled,
  nodeText,
  unfoldChip,
  watchErrors,
  denyNetwork,
  frameClock,
  clockOf,
  advance,
  until,
  shown,
  renderVersions,
} from '../support/browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = path.join(root, '.local/standalone-check')

const labels = {
  en: { fit: 'Fit', theme: 'Theme', snapshot: 'Snapshot of reference', empty: 'No diagram yet' },
  fr: { fit: 'Ajuster', theme: 'Thème', snapshot: 'Instantané de reference', empty: 'Pas encore de schéma' },
  zh: { fit: '适应窗口', theme: '主题', snapshot: 'reference 的快照', empty: '还没有架构图' },
}

async function background(page, expected) {
  await until(page, (value) => getComputedStyle(document.body).backgroundColor === value, expected)
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
  const sample = () =>
    page.evaluate(
      ({ group, children }) => {
        const rectOf = (id) =>
          [...document.querySelectorAll('.dshd-node')]
            .filter((node) => node.dataset.element === id)
            .map((node) => {
              let opacity = 1
              for (let p = node; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
              const r = node.querySelector('.dshd-shape').getBoundingClientRect()
              return { x: r.x, y: r.y, width: r.width, height: r.height, opacity }
            })
            .sort((a, b) => b.opacity - a.opacity)[0]
        const frame = rectOf(group)
        return {
          focus: document.querySelector('.dshd-crumbs b')?.textContent,
          frame,
          linkOpacity: Math.max(
            0,
            ...[...document.querySelectorAll('.dshd-edge')]
              .filter((edge) => edge.textContent === 'filters')
              .map((edge) => {
                let opacity = 1
                for (let p = edge; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
                return opacity
              }),
          ),
          children: children.map((id) => {
            const r = rectOf(id)
            return [(r.x - frame.x) / frame.width, (r.y - frame.y) / frame.height, r.width / frame.width, r.height / frame.height]
          }),
        }
      },
      { group, children },
    )
  await advance(page, 550)
  const before = await sample()
  let after = before
  const wheel = async (delta) => {
    const stage = await page.locator('.dshd-stage').boundingBox()
    const x = Math.max(stage.x + 5, Math.min(stage.x + stage.width - 5, after.frame.x + after.frame.width / 2))
    const y = Math.max(stage.y + 5, Math.min(stage.y + stage.height - 5, after.frame.y + after.frame.height / 2))
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, delta)
    await advance(page, 100)
    after = await sample()
    assert.ok(after.linkOpacity > 0.99, 'an unchanged routed link never blinks during zoom')
    after.children.forEach((rect, index) =>
      rect.forEach((value, axis) => {
        assert.ok(Math.abs(value - before.children[index][axis]) < 0.0001, `${children[index]} keeps its place during zoom`)
      }),
    )
  }
  for (let i = 0; i < 20 && after.focus !== title; i++) await wheel(-90)
  assert.equal(after.focus, title, 'wheel zoom enters the unfolded group')
  if (leave) {
    await watchContext(page, 'azure.prod.shared')
    for (let i = 0; i < 20 && after.focus !== before.focus; i++) await wheel(90)
    assert.equal(after.focus, before.focus, 'zooming out returns to the parent without rearranging boxes')
    await settled(page)
    const transition = await contextSamples(page)
    assert.ok(
      transition.samples.some((opacity) => opacity > 0.99),
      'parent context becomes fully visible',
    )
    if (!transition.reduce)
      assert.ok(
        transition.samples.some((opacity) => opacity > 0 && opacity < 0.99),
        'new parent context fades in rather than popping',
      )
  }
}

async function scopedNeighbours(page, fitLabel, enterLabel) {
  await unfoldChip(page, 'rg-tracking').click()
  await shown(page, nodeText(page, 'vnet-tracking'))
  await zoomUnfolded(page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'], {
    leave: false,
  })
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
    return [...document.querySelectorAll('.dshd-node')]
      .filter((node) => {
        const r = node.querySelector('.dshd-shape').getBoundingClientRect()
        return r.left < stage.left - 1 || r.top < stage.top - 1 || r.right > stage.right + 1 || r.bottom > stage.bottom + 1
      })
      .map((node) => node.dataset.element)
  })
  assert.deepEqual(clipped, [], 'Fit includes the frame and every visible neighbour')
  await watchContext(page, 'azure.prod.shared')
  await outside.locator('[data-chip="fly"]').click()
  await focused(page, 'rg-tracking')
  await settled(page)
  const ascent = await contextSamples(page)
  if (!ascent.reduce)
    assert.ok(ascent.samples.find((opacity) => opacity > 0) < 0.99, 'scripted ascents fade in their new parent context too')
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
  await until(page, () => document.querySelector('.dshd-detail h4')?.textContent === 'rg-edge')
  await focused(page, 'sub-contoso-prod')
  await shown(page, nodeText(page, 'vnet-tracking'))
}

async function interruptOpening(page, enterLabel, mode) {
  await page.locator('nav').getByRole('button', { name: 'Azure', exact: true }).click()
  await focused(page, 'Azure')
  await settled(page)
  await page.locator('.dshd-stage').focus()
  await page.keyboard.press('Escape')
  await nodeText(page, 'sub-contoso-prod').click()
  // Layout in another renderer must not skip the short interruption window.
  const clock = clockOf(page)
  const sampling = page.evaluate(
    ({ enterLabel, mode }) =>
      new Promise((resolve) => {
        const stage = document.querySelector('.dshd-stage'),
          r = stage.getBoundingClientRect()
        const x = r.left + 30,
          y = r.bottom - 30
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
              stage.dispatchEvent(
                new WheelEvent('wheel', {
                  deltaY: -30,
                  clientX: box.x + box.width / 2,
                  clientY: box.y + box.height / 2,
                  bubbles: true,
                  cancelable: true,
                }),
              )
            } else if (mode === 'wheel-out' || mode === 'wheel-away')
              stage.dispatchEvent(
                new WheelEvent('wheel', {
                  deltaY: mode === 'wheel-out' ? 30 : -30,
                  clientX: x,
                  clientY: y,
                  bubbles: true,
                  cancelable: true,
                }),
              )
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
      }),
    { enterLabel, mode },
  )
  await clock.advance(800)
  const result = await sampling
  assert.equal(
    result.fired,
    true,
    `${mode} flight was interrupted while partly open: ${JSON.stringify(result.samples.map((sample) => sample.opacity))}`,
  )
  assert.ok(result.samples.find((sample) => sample.after).opacity < 0.99, `${mode} interruption does not snap its visible context back`)
  if (mode === 'pointer' || mode === 'wheel-away')
    assert.ok(result.samples.at(-1).opacity > 0.99, 'the interruption itself finishes releasing the group')
  if (mode === 'wheel-in')
    assert.ok(
      result.samples.at(-1).opacity < result.samples.findLast((sample) => !sample.after).opacity,
      'scrolling into the opening group continues opening rather than releasing it',
    )
  const target = mode === 'wheel-in' ? 'sub-contoso-prod' : 'Azure'
  if (mode !== 'pointer' && mode !== 'wheel-away') {
    let completed = false
    for (let i = 0; i < 20; i++) {
      const state = await page.evaluate(() => {
        const node = document.querySelector('[data-element="azure.dev"]')
        let opacity = node ? 1 : 0
        for (let p = node; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
        const box = document.querySelector('[data-element="azure.prod"] .dshd-shape').getBoundingClientRect()
        const stage = document.querySelector('.dshd-stage').getBoundingClientRect()
        return {
          opacity,
          focus: document.querySelector('.dshd-crumbs b')?.textContent,
          inside: [box.x + box.width / 2, box.y + box.height / 2],
          outside: [stage.x + 30, stage.bottom - 30],
        }
      })
      if (mode === 'wheel-in' ? state.focus === target : state.opacity > 0.99) {
        completed = true
        break
      }
      await page.mouse.move(...(mode === 'wheel-in' ? state.inside : state.outside))
      await page.mouse.wheel(0, mode === 'wheel-in' ? -90 : 90)
      await advance(page, 100)
    }
    assert.ok(completed, `${mode} retains control until the gesture completes`)
  }
  await focused(page, target)
}

describe('standalone browser regressions', { skip: !process.env.DSHD_CHROMIUM, concurrency: false }, () => {
  let temporary, html, browser
  before(
    async () => {
      temporary = await mkdtemp(path.join(tmpdir(), 'dshd-browser-'))
      await mkdir(artifacts, { recursive: true })
      const diagramDir = path.join(temporary, '.diagram')
      await mkdir(diagramDir)
      const file = path.join(diagramDir, 'reference.c4')
      html = path.join(diagramDir, 'reference.html')
      const source = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
      const previous = source.replace("ops = system 'Operations'", "ops = system 'Operations before'")
      assert.notEqual(previous, source)
      await renderVersions(file, [previous, source])
      assert.ok((await stat(html)).size <= 5_000_000, 'HTML with two history versions stays within budget')
      const { chromium } = await playwright()
      browser = await chromium.launch({ executablePath: process.env.DSHD_CHROMIUM, args: ['--no-sandbox'] })
    },
    { timeout: 120_000 },
  )
  after(async () => {
    if (browser) await browser.close()
    if (temporary) {
      assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
      assert.match(path.basename(temporary), /^dshd-browser-/)
      await rm(temporary, { recursive: true, force: true })
    }
  })
  async function open(
    t,
    locale = 'en-US',
    colorScheme = 'light',
    reducedMotion = 'reduce',
    { direction = 'TopBottom', controlled = false } = {},
  ) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale,
      colorScheme,
      reducedMotion,
      acceptDownloads: true,
      serviceWorkers: 'block',
    })
    const errors = [],
      blocked = []
    t.after(async () => {
      await context.close()
      assert.deepEqual(errors, [], 'Browser errors')
      assert.deepEqual(blocked, [], 'Standalone attempted network access')
    })
    await denyNetwork(context, blocked)
    await context.addInitScript((direction) => {
      if (!localStorage.getItem('dsh-diagram.direction')) localStorage.setItem('dsh-diagram.direction', direction)
    }, direction)
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    watchErrors(page, errors, locale)
    await frameClock(page, { controlled })
    await page.goto(pathToFileURL(html).href)
    await ready(page)
    return page
  }
  async function unfoldedEdge(page, enterLabel) {
    await nodeText(page, 'sub-contoso-prod').click()
    await page.locator('.dshd-detail').getByRole('button', { name: enterLabel, exact: true }).click()
    await focused(page, 'sub-contoso-prod')
    await unfoldChip(page, 'rg-edge').click()
    await shown(page, nodeText(page, 'Front Door'))
    await settled(page)
  }

  describe('isolated contexts', { concurrency: Math.min(6, Math.ceil(availableParallelism() * 1.5)) }, () => {
    // Long animations start first; short locale checks fill the tail.
    for (const motion of ['no-preference', 'reduce'])
      for (const [locale, scheme] of [
        ['en-US', 'light'],
        ['fr-FR', 'dark'],
      ]) {
        const enter = locale === 'fr-FR' ? 'Zoomer dedans' : 'Zoom in'
        const fit = locale === 'fr-FR' ? 'Ajuster' : 'Fit'
        test(`scoped Fit, stable routes and outside navigation: ${locale}/${motion}`, { timeout: 90_000 }, async (t) => {
          const page = await open(t, locale, scheme, motion, { controlled: motion !== 'reduce' })
          await unfoldedEdge(page, enter)
          await zoomUnfolded(page, 'azure.prod.edge', 'rg-edge', [
            'azure.prod.edge.frontdoor',
            'azure.prod.edge.waf',
            'azure.prod.edge.dns',
          ])
          await scopedNeighbours(page, fit, enter)
          await page.getByRole('button', { name: locale === 'fr-FR' ? 'Tout replier' : 'Fold all', exact: true }).click()
          await until(
            page,
            () =>
              !document.querySelector('[data-element="azure.prod.edge.frontdoor"]') &&
              !document.querySelector('[data-element="azure.prod.tracking.vnet"]'),
          )
          await focused(page, 'sub-contoso-prod')
        })
      }

    test('navigation, unfolding, history, flows and persistent theme', { timeout: 90_000 }, async (t) => {
      const page = await open(t)
      assert.equal(await page.title(), 'reference')
      assert.equal(await page.locator('html').getAttribute('lang'), 'en')
      assert.match(await page.locator('.dshd-header-status').textContent(), /^Snapshot of reference · /)
      await page.getByRole('button', { name: 'AWS', exact: true }).click()
      await focused(page, 'AWS')
      await page.getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')

      await nodeText(page, 'sub-contoso-prod').click()
      await shown(page, page.locator('.dshd-detail h4'))
      assert.match(await page.locator('.dshd-detail').textContent(), /azure\.prod/)
      await page.locator('.dshd-detail').getByRole('button', { name: 'Zoom in', exact: true }).click()
      await focused(page, 'sub-contoso-prod')
      const beforeUnfold = await page.locator('.dshd-stage > svg').innerHTML()
      await unfoldChip(page, 'rg-edge').click()
      await shown(page, page.getByRole('button', { name: 'Fold all', exact: true }))
      await shown(page, nodeText(page, 'Front Door'))
      await until(page, () =>
        [...document.querySelectorAll('.dshd-stage svg text')].some(
          (text) => text.textContent === 'Front Door' && text.closest('.dshd-node')?.querySelector('.dshd-ico'),
        ),
      )
      assert.notEqual(await page.locator('.dshd-stage > svg').innerHTML(), beforeUnfold)
      await focused(page, 'sub-contoso-prod') // Unfolding must not navigate into the group.
      await page.screenshot({ path: path.join(artifacts, 'standalone-light.png') })

      await page.getByRole('button', { name: 'Fold all', exact: true }).click()
      await until(page, () => document.querySelector('button[aria-label="Fold all"]')?.disabled)
      await page.locator('.dshd-crumbs').getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')

      await page.getByRole('button', { name: 'Previous version', exact: true }).click()
      await shown(page, page.getByRole('button', { name: 'Operations before', exact: true }))
      assert.match(await page.locator('.dshd-time').textContent(), /v1/)
      await page.getByRole('button', { name: 'Next version', exact: true }).click()
      await shown(page, page.getByRole('button', { name: 'Operations', exact: true }))
      assert.match(await page.locator('.dshd-time').textContent(), /live/)

      const beforeDirection = await page.locator('.dshd-stage > svg').innerHTML()
      await page.getByRole('button', { name: 'Layout: vertical — switch to horizontal', exact: true }).click()
      await until(
        page,
        (before) =>
          localStorage.getItem('dsh-diagram.direction') === 'LeftRight' &&
          document.querySelector('.dshd-stage > svg')?.innerHTML !== before,
        beforeDirection,
      )
      await page.getByRole('button', { name: 'A scan, from depot to customer', exact: true }).click()
      await until(page, () => document.querySelector('.dshd-flow[aria-current=true]'))
      await shown(page, page.locator('.dshd-crumbs').getByRole('button', { name: 'Leave flow' }))
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
      await shown(page, page.getByRole('button', { name: 'Layout: horizontal — switch to vertical', exact: true }))
      assert.equal(await page.evaluate(() => localStorage.getItem('dsh-diagram.direction')), 'LeftRight')
    })

    for (const direction of ['TopBottom', 'LeftRight'])
      for (const exit of ['breadcrumb', 'Backspace']) {
        test(`scope exit matrix: ${direction}/${exit}`, { timeout: 45_000 }, async (t) => {
          const page = await open(t, 'en-US', 'light', 'no-preference', { direction, controlled: true })
          await unfoldedEdge(page, 'Zoom in')
          await zoomUnfolded(
            page,
            'azure.prod.edge',
            'rg-edge',
            ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'],
            { leave: false },
          )
          await watchContext(page, 'azure.prod.shared')
          if (exit === 'breadcrumb')
            await page.locator('.dshd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
          else await page.locator('.dshd-stage').press('Backspace')
          await focused(page, 'sub-contoso-prod')
          await settled(page)
          const fade = await contextSamples(page)
          assert.ok(
            fade.samples.some((opacity) => opacity > 0 && opacity < 0.99),
            'parent context fades in',
          )
          assert.ok(
            fade.samples.some((opacity) => opacity > 0.99),
            'parent context finishes appearing',
          )
        })
      }
    test('scoped Fit remains complete after resizing to a narrow pane', { timeout: 45_000 }, async (t) => {
      const page = await open(t)
      await unfoldedEdge(page, 'Zoom in')
      await page.locator('.dshd-stage').press('Escape')
      await page.setViewportSize({ width: 480, height: 800 })
      await settled(page)
      await zoomUnfolded(page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'], {
        leave: false,
      })
      await page.getByRole('button', { name: 'Fit', exact: true }).click()
      await settled(page)
      await focused(page, 'rg-edge')
      assert.equal(
        await page.locator('.dshd-stage').evaluate((stage) => {
          const box = stage.getBoundingClientRect()
          return [...stage.querySelectorAll('.dshd-node .dshd-shape')].every((node) => {
            const r = node.getBoundingClientRect()
            return r.left >= box.left - 1 && r.top >= box.top - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1
          })
        }),
        true,
      )
    })

    test('repeated interruptions remain usable in the same context', { timeout: 45_000 }, async (t) => {
      const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
      for (const mode of ['wheel-out', 'wheel-in', 'wheel-away', 'pointer']) await interruptOpening(page, 'Zoom in', mode)
    })
    for (const [locale, scheme] of [
      ['en-US', 'light'],
      ['fr-FR', 'dark'],
    ]) {
      const enter = locale === 'fr-FR' ? 'Zoomer dedans' : 'Zoom in'
      for (const mode of ['wheel-out', 'wheel-in', 'wheel-away', 'pointer']) {
        test(`interrupt opening: ${locale}/${mode}`, { timeout: 45_000 }, async (t) => {
          const page = await open(t, locale, scheme, 'no-preference', { controlled: true })
          await interruptOpening(page, enter, mode)
        })
      }
    }
    for (const [locale, expected, scheme] of [
      ['fr-FR', 'fr', 'dark'],
      ['zh-CN', 'zh', 'light'],
      ['de-DE', 'en', 'dark'],
    ]) {
      test(`locale ${locale} and ${scheme} theme`, { timeout: 30_000 }, async (t) => {
        const page = await open(t, locale, scheme)
        assert.equal(await page.locator('html').getAttribute('lang'), expected)
        await shown(page, page.getByRole('button', { name: labels[expected].fit, exact: true }))
        assert.ok((await page.locator('.dshd-header-status').textContent()).startsWith(labels[expected].snapshot))
        await shown(page, page.getByRole('button', { name: new RegExp('^' + labels[expected].theme + ':') }))
        await background(page, scheme === 'dark' ? 'rgb(21, 21, 23)' : 'rgb(255, 255, 255)')
        await page.screenshot({ path: path.join(artifacts, `standalone-${expected}.png`) })
      })
    }
  })

  test('real-time wheel animation keeps routes stable and fades parent context', { timeout: 45_000 }, async (t) => {
    const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: false })
    await unfoldedEdge(page, 'Zoom in')
    await zoomUnfolded(page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'])
  })
})
