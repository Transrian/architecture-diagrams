// Optional offline browser smoke test; not collected by test/*.test.mjs.
// ARCHD_CHROMIUM=/path/to/chrome node --test test/browser/standalone.mjs
// Playwright comes from pinned build dependencies (ARCHD_PLAYWRIGHT overrides it).
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
    window.__archdContextWatch = token
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
    const token = window.__archdContextWatch
    token.active = false
    return { samples: token.samples, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches }
  })
}

async function zoomUnfolded(page, group, title, children, { leave = true } = {}) {
  const sample = () =>
    page.evaluate(
      ({ group, children }) => {
        const rectOf = (id) =>
          [...document.querySelectorAll('.archd-node')]
            .filter((node) => node.dataset.element === id)
            .map((node) => {
              let opacity = 1
              for (let p = node; p instanceof Element; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
              const r = node.querySelector('.archd-shape').getBoundingClientRect()
              return { x: r.x, y: r.y, width: r.width, height: r.height, opacity }
            })
            .sort((a, b) => b.opacity - a.opacity)[0]
        const frame = rectOf(group)
        return {
          focus: document.querySelector('.archd-crumbs b')?.textContent,
          frame,
          linkOpacity: Math.max(
            0,
            ...[...document.querySelectorAll('.archd-edge')]
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
    const stage = await page.locator('.archd-stage').boundingBox()
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
    const stage = document.querySelector('.archd-stage').getBoundingClientRect()
    return [...document.querySelectorAll('.archd-node')]
      .filter((node) => {
        const r = node.querySelector('.archd-shape').getBoundingClientRect()
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
  await page.locator('.archd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
  await focused(page, 'sub-contoso-prod')
  await settled(page)
  await nodeText(page, 'RG-EDGE').click()
  await page.locator('.archd-detail').getByRole('button', { name: enterLabel, exact: true }).click()
  await focused(page, 'rg-edge')
  await fit()
  await nodeText(page, 'RG-TRACKING').dblclick()
  await focused(page, 'rg-tracking')
  await settled(page)
  await page.locator('.archd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
  await focused(page, 'sub-contoso-prod')
  await page.locator('.archd-stage').click({ position: { x: 10, y: 10 } })
  await nodeText(page, 'RG-EDGE').click()
  await until(page, () => document.querySelector('.archd-detail h4')?.textContent === 'rg-edge')
  await focused(page, 'sub-contoso-prod')
  await shown(page, nodeText(page, 'vnet-tracking'))
}

async function interruptOpening(page, enterLabel, mode) {
  await page.locator('nav').getByRole('button', { name: 'Azure', exact: true }).click()
  await focused(page, 'Azure')
  await settled(page)
  await page.locator('.archd-stage').focus()
  await page.keyboard.press('Escape')
  await nodeText(page, 'sub-contoso-prod').click()
  // Layout in another renderer must not skip the short interruption window.
  const clock = clockOf(page)
  const sampling = page.evaluate(
    ({ enterLabel, mode }) =>
      new Promise((resolve) => {
        const stage = document.querySelector('.archd-stage'),
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
              const box = document.querySelector('[data-element="azure.prod"] .archd-shape').getBoundingClientRect()
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
        const button = [...document.querySelectorAll('.archd-detail button')].find((button) => button.textContent === enterLabel)
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
        const box = document.querySelector('[data-element="azure.prod"] .archd-shape').getBoundingClientRect()
        const stage = document.querySelector('.archd-stage').getBoundingClientRect()
        return {
          opacity,
          focus: document.querySelector('.archd-crumbs b')?.textContent,
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

describe('standalone browser regressions', { skip: !process.env.ARCHD_CHROMIUM, concurrency: false }, () => {
  let temporary, html, browser
  before(
    async () => {
      temporary = await mkdtemp(path.join(tmpdir(), 'archd-browser-'))
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
      browser = await chromium.launch({ executablePath: process.env.ARCHD_CHROMIUM, args: ['--no-sandbox'] })
    },
    { timeout: 120_000 },
  )
  after(async () => {
    if (browser) await browser.close()
    if (temporary) {
      assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
      assert.match(path.basename(temporary), /^archd-browser-/)
      await rm(temporary, { recursive: true, force: true })
    }
  })
  async function open(
    t,
    locale = 'en-US',
    colorScheme = 'light',
    reducedMotion = 'reduce',
    { direction = 'TopBottom', controlled = false, file = html } = {},
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
      if (!localStorage.getItem('architecture-diagrams.direction')) localStorage.setItem('architecture-diagrams.direction', direction)
    }, direction)
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    watchErrors(page, errors, locale)
    await frameClock(page, { controlled })
    await page.goto(pathToFileURL(file).href)
    await ready(page)
    return page
  }
  async function unfoldedEdge(page, enterLabel) {
    await nodeText(page, 'sub-contoso-prod').click()
    await page.locator('.archd-detail').getByRole('button', { name: enterLabel, exact: true }).click()
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

    for (const motion of ['no-preference', 'reduce'])
      test(`keyboard focus pans into view without changing zoom: ${motion}`, { timeout: 45_000 }, async (t) => {
        const page = await open(t, 'en-US', 'light', motion, { controlled: true })
        await settled(page)
        const stage = page.locator('.archd-stage')
        const box = await stage.boundingBox()
        const shape = page.locator('[data-element="azure.prod"] .archd-shape')
        const initial = await shape.boundingBox()
        await page.mouse.move(box.x + 10, box.y + 10)
        await page.mouse.down()
        await page.mouse.move(box.x + 1010, box.y + 10)
        await page.mouse.up()
        await advance(page, 32)
        await stage.press('ArrowRight')
        await advance(page, 500)
        const id = decodeURIComponent((await stage.getAttribute('aria-activedescendant')).split('-box-')[1])
        const focusedBox = await page.locator(`[data-element="${id}"] .archd-shape`).boundingBox()
        assert.ok(focusedBox.x >= box.x && focusedBox.x + focusedBox.width <= box.x + box.width,
          `${id} is brought horizontally into view`)
        assert.ok(focusedBox.y >= box.y && focusedBox.y + focusedBox.height <= box.y + box.height,
          `${id} is brought vertically into view`)
        assert.ok(Math.abs((await shape.boundingBox()).width - initial.width) < 0.01, 'keyboard reveal pans only')
        assert.equal(await page.locator('.archd-detail').count(), 0, 'focus does not select or open details')
      })

    test('keyboard pan stays above a details bottom sheet', { timeout: 45_000 }, async (t) => {
      const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
      await page.setViewportSize({ width: 480, height: 800 })
      await settled(page)
      await nodeText(page, 'sub-contoso-prod').click()
      await settled(page)
      const stage = page.locator('.archd-stage')
      const box = await stage.boundingBox()
      await page.mouse.move(box.x + 10, box.y + 10)
      await page.mouse.down()
      await page.mouse.move(box.x + 10, box.y + 610)
      await page.mouse.up()
      await advance(page, 32)
      await stage.press('ArrowRight')
      await advance(page, 500)
      const id = decodeURIComponent((await stage.getAttribute('aria-activedescendant')).split('-box-')[1])
      const focusedBox = await page.locator(`[data-element="${id}"] .archd-shape`).boundingBox()
      const panel = await page.locator('.archd-detail').boundingBox()
      assert.ok(focusedBox.y >= box.y && focusedBox.y + focusedBox.height < panel.y, 'keyboard box stays clear of the sheet')
      assert.match(await page.locator('.archd-detail h4').textContent(), /sub-contoso-prod/, 'focus pan keeps the existing selection')
    })

    for (const input of ['arrow', 'horizontal wheel'])
      test(`${input} does not abort a camera flight`, { timeout: 45_000 }, async (t) => {
        const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
        await settled(page)
        await nodeText(page, 'sub-contoso-prod').click()
        await page.locator('.archd-detail').getByRole('button', { name: 'Zoom in', exact: true }).click()
        await advance(page, 112)
        if (input === 'arrow') await page.locator('.archd-stage').press('ArrowRight')
        else {
          const box = await page.locator('.archd-stage').boundingBox()
          await page.mouse.move(box.x + 10, box.y + 10)
          await page.mouse.wheel(100, 0)
        }
        await advance(page, 2000)
        assert.equal(await page.locator('.archd-crumbs b').textContent(), 'sub-contoso-prod', 'the original flight lands')
        await shown(page, nodeText(page, 'Dispatch application'))
      })

    test('stage focus ring follows keyboard rather than mouse interaction', { timeout: 45_000 }, async (t) => {
      const page = await open(t)
      await settled(page)
      const stage = page.locator('.archd-stage')
      const ring = () => stage.evaluate((el) => getComputedStyle(el).outlineStyle)
      await stage.click({ position: { x: 10, y: 10 } })
      assert.equal(await ring(), 'none', 'mouse focus has no stage ring')
      await page.getByRole('button', { name: 'Fit', exact: true }).focus()
      for (let i = 0; i < 15 && !(await stage.evaluate((el) => el === document.activeElement)); i++)
        await page.keyboard.press('Tab')
      assert.ok(await stage.evaluate((el) => el === document.activeElement), 'Tab reaches the stage')
      assert.equal(await ring(), 'solid', 'keyboard focus keeps its visible ring')
      await stage.click({ position: { x: 10, y: 10 } })
      assert.equal(await ring(), 'none', 'mouse interaction clears the ring even on an already-focused stage')
      await page.keyboard.press('ArrowRight')
      assert.equal(await ring(), 'solid', 'keyboard navigation restores the ring')
    })

    test('flows use their final direction from the first frame', { timeout: 45_000 }, async (t) => {
      const { compute } = await import('../../skills/architecture-diagrams/assets/engine.mjs')
      const source = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
      const expected = (await compute(source, { direction: 'LeftRight' })).views.find((v) => v.title === 'A scan, from depot to customer')
      const nodes = expected.nodes.filter((node) => node.shape === 'rectangle' && !node.children.length)
      const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
      await settled(page)
      await page.getByRole('button', { name: expected.title, exact: true }).click()
      await until(page, (title) => document.querySelector('.archd-stage')?.getAttribute('aria-label') === title, expected.title)
      for (let frame = 0; frame < 48; frame++) {
        const actual = await page.evaluate((ids) => ids.map((id) => {
          const shape = document.querySelector(`[data-element="${id}"] .archd-shape`)
          const r = shape.getBBox()
          return [r.x, r.y]
        }), nodes.map((node) => node.id))
        actual.forEach((point, i) => {
          assert.ok(Math.abs(point[0] - nodes[i].x) < 0.5 && Math.abs(point[1] - nodes[i].y) < 0.5,
            `frame ${frame}: ${nodes[i].id} starts in its horizontal layout`)
        })
        await advance(page, 16)
      }
    })

    test('automatic flow direction changes do not refit a panned schema', { timeout: 45_000 }, async (t) => {
      const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
      await settled(page)
      const box = await page.locator('.archd-stage').boundingBox()
      const shape = page.locator('[data-element="azure.prod"] .archd-shape')
      await page.mouse.move(box.x + 10, box.y + 10)
      await page.mouse.down()
      await page.mouse.move(box.x + 110, box.y + 10)
      await page.mouse.up()
      await advance(page, 32)
      const before = await shape.boundingBox()
      await page.setViewportSize({ width: 900, height: 1000 })
      const resized = await page.locator('.archd-stage').boundingBox()
      const expected = { x: before.x + resized.x - box.x + (resized.width - box.width) / 2,
        y: before.y + resized.y - box.y + (resized.height - box.height) / 2 }
      for (let frame = 0; frame < 50; frame++) {
        await advance(page, 32)
        const after = await shape.boundingBox()
        assert.ok(Math.abs(after.width - before.width) < 0.5, 'schema scale stays unchanged throughout flow recomputation')
        assert.ok(Math.abs(after.x - expected.x) < 0.5 && Math.abs(after.y - expected.y) < 0.5,
          'schema keeps its panned centre with no direction-change flicker')
      }
    })

    for (const operation of ['flight', 'morph'])
      test(`resize during a ${operation} lands fitted to the new stage`, { timeout: 45_000 }, async (t) => {
        const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
        await settled(page)
        if (operation === 'flight') {
          const box = await page.locator('.archd-stage').boundingBox()
          await page.mouse.move(box.x + 10, box.y + 10)
          await page.mouse.wheel(0, 100)
          await advance(page, 32)
          await page.getByRole('button', { name: 'Fit', exact: true }).click()
        } else {
          await page.locator('[data-element="azure.prod"] .archd-count-chip').click()
          await until(page, () => !!document.querySelector('[data-element="azure.prod"] [data-chip="fold"]'))
        }
        await advance(page, 96)
        await page.setViewportSize({ width: 900, height: 600 })
        await advance(page, 2000)
        await settled(page)
        const rectangles = () => page.locator('.archd-node .archd-shape').evaluateAll((nodes) => nodes.map((node) => {
          const r = node.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height]
        }))
        const landed = await rectangles()
        await page.getByRole('button', { name: 'Fit', exact: true }).click()
        await settled(page)
        const fitted = await rectangles()
        assert.equal(landed.length, fitted.length)
        landed.forEach((rect, i) => rect.forEach((value, j) => {
          assert.ok(Math.abs(value - fitted[i][j]) < 0.5, `${operation} landing matches Fit after resize: ${value} vs ${fitted[i][j]}`)
        }))
      })

    test('wheel over details scrolls the panel without zooming', { timeout: 45_000 }, async (t) => {
      const page = await open(t)
      await page.setViewportSize({ width: 1000, height: 500 })
      await settled(page)
      await page.locator('.archd-edge').filter({ hasText: /^6 links$/ }).first().locator('text').click()
      await shown(page, page.locator('.archd-detail'))
      await settled(page)
      const panel = page.locator('.archd-detail')
      assert.ok(await panel.evaluate((el) => el.scrollHeight > el.clientHeight), 'reference links make a scrollable panel')
      const before = await page.locator('.archd-stage > svg').innerHTML()
      const rect = await panel.boundingBox()
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
      await page.mouse.wheel(0, 120)
      await until(page, () => document.querySelector('.archd-detail').scrollTop > 0)
      assert.equal(await page.locator('.archd-stage > svg').innerHTML(), before, 'wheel leaves the camera unchanged')
    })

    test('dragging preserves a wheel change to the live camera', { timeout: 45_000 }, async (t) => {
      const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
      await settled(page)
      const stage = await page.locator('.archd-stage').boundingBox()
      const shape = page.locator('[data-element="azure.prod"] .archd-shape')
      await page.mouse.move(stage.x + 10, stage.y + 10)
      await page.mouse.down()
      await page.mouse.move(stage.x + 20, stage.y + 20)
      await advance(page, 32)
      await page.mouse.wheel(0, 60)
      await advance(page, 32)
      const zoomed = await shape.boundingBox()
      await page.mouse.move(stage.x + 21, stage.y + 20)
      await advance(page, 32)
      const panned = await shape.boundingBox()
      await page.mouse.up()
      assert.ok(Math.abs(panned.width - zoomed.width) < 0.01, 'the next drag move does not undo wheel zoom')
      assert.ok(Math.abs(panned.x - zoomed.x - 1) < 0.01, 'the delta applies to the current camera')
    })

    test('stable card and edge labels are not remeasured while panning or zooming', { timeout: 45_000 }, async (t) => {
      const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
      await settled(page)
      await page.evaluate(() => {
        window.__textMeasures = 0
        const measure = SVGTextContentElement.prototype.getComputedTextLength
        SVGTextContentElement.prototype.getComputedTextLength = function () {
          window.__textMeasures++
          return measure.call(this)
        }
      })
      const box = await page.locator('.archd-stage').boundingBox()
      await page.mouse.move(box.x + 10, box.y + 10)
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 10)
        await advance(page, 32)
      }
      await page.mouse.down()
      await page.mouse.move(box.x + 30, box.y + 30, { steps: 3 })
      await page.mouse.up()
      await advance(page, 32)
      assert.equal(await page.evaluate(() => window.__textMeasures), 0, 'unchanged text inputs need no SVG layout reads')
    })

    test('only the selected edge has an on-canvas halo', { timeout: 45_000 }, async (t) => {
      const page = await open(t)
      const merged = page.locator('.archd-edge').filter({ hasText: /^6 links$/ }).first()
      const single = page.locator('.archd-edge').filter({ hasText: /^webhooks$/ }).first()
      assert.equal(await page.locator('.archd-edge-halo').count(), 0)
      await merged.locator('text').click()
      await shown(page, page.locator('.archd-detail h4'))
      assert.equal(await merged.locator('.archd-edge-halo').count(), 1, 'a merged link is visibly selected')
      const halo = await merged.locator('.archd-edge-halo').evaluate((path) => ({
        stroke: getComputedStyle(path).stroke,
        foreground: getComputedStyle(path.parentElement.querySelector('text')).fill,
        width: parseFloat(getComputedStyle(path).strokeWidth),
        lineWidth: parseFloat(getComputedStyle(path.parentElement.querySelector('.archd-edge-line')).strokeWidth),
        points: path.getAttribute('d'),
      }))
      assert.equal(halo.stroke, halo.foreground, 'edge halo uses the node selection foreground')
      assert.ok(halo.width > halo.lineWidth && halo.points.length > 0)
      await single.locator('text').click()
      assert.equal(await merged.locator('.archd-edge-halo').count(), 0, 'previous edge is cleared')
      assert.equal(await single.locator('.archd-edge-halo').count(), 1, 'single link is visibly selected')
      await page.locator('.archd-detail').getByRole('button', { name: 'Close', exact: true }).click()
      assert.equal(await page.locator('.archd-edge-halo').count(), 0, 'closing details clears the halo')
    })

    for (const label of ['webhooks', 'retry after\nbackoff', 'iiiiiiiiiiiiiiiiiiii'])
      test(`edge labels fit their reserved box: ${JSON.stringify(label)}`, { timeout: 45_000 }, async (t) => {
        const { compute } = await import('../../skills/architecture-diagrams/assets/engine.mjs')

        const multiline = label.includes('\n')
        const input = `// diagram v1
model {
  parcels = system 'Parcel processing' {
    worker = service 'Retry worker'
    queue = data 'Redis'
    worker -> queue '${label}'
  }
}`
        const result = await compute(input)
        assert.deepEqual(result.errors, [])
        const box = result.views.find((view) => view.id === 'diagram_parcels').edges.find((edge) => edge.label === label).labelBBox
        const file = path.join(temporary, `labels-${label.length}.c4`)
        await renderVersions(file, [input])
        const page = await open(t, 'en-US', 'light', 'reduce', { file: file.replace(/\.c4$/, '.html') })
        await settled(page)
        const drawing = await page.locator('.archd-edge text').evaluateAll((texts, label) => {
          const text = texts.find((text) => (text.getAttribute('aria-label') ?? text.textContent) === label)
          const r = text.getBBox()
          const compression = [...text.querySelectorAll('tspan')].map((line) => {
            const adjusted = line.getAttribute('textLength')
            if (!adjusted) return 1
            line.removeAttribute('textLength')
            const ratio = Number(adjusted) / line.getComputedTextLength()
            line.setAttribute('textLength', adjusted)
            return ratio
          })
          return { x: r.x, y: r.y, width: r.width, height: r.height, compression,
            title: text.parentElement.querySelector('title')?.textContent,
            rows: [...text.querySelectorAll('tspan')].map((line) => ({ text: line.textContent, y: line.getBBox().y })) }
        }, label)
        assert.ok(drawing.x >= box.x - 0.5 && drawing.x + drawing.width <= box.x + box.width + 0.5,
          `label width ${JSON.stringify(drawing)} fits ${JSON.stringify(box)}`)
        assert.ok(drawing.y >= box.y - 0.5 && drawing.y + drawing.height <= box.y + box.height + 0.5)
        assert.ok(Math.abs(drawing.x + drawing.width / 2 - box.x - box.width / 2) < 0.5, 'label is centred')
        assert.ok(drawing.compression.every((ratio) => ratio >= 0.849), 'compression stays readable')
        if (label.startsWith('iiii')) {
          assert.match(drawing.rows[0].text, /…$/)
          assert.equal(drawing.title, label, 'the full label remains in its tooltip')
        }
        if (multiline) {
          assert.deepEqual(drawing.rows.map((row) => row.text), ['retry after', 'backoff'])
          assert.ok(drawing.rows[1].y > drawing.rows[0].y, 'newlines create separate SVG rows')
        }
      })

    test('merged edge counts keep their natural readable width', { timeout: 30_000 }, async (t) => {
      const page = await open(t)
      await settled(page)
      const count = page.locator('.archd-edge').filter({ hasText: /^6 links$/ }).first()
      assert.equal(await count.locator('tspan').getAttribute('textLength'), null, 'merged counts retain their natural width')
    })

    test('open-group titles keep clear of chips throughout unfolding', { timeout: 45_000 }, async (t) => {
      const page = await open(t, 'en-US', 'light', 'no-preference', { controlled: true })
      await page.locator('[data-element="azure.prod"] .archd-count-chip').click()
      await until(page, () => !!document.querySelector('[data-element="azure.prod"] [data-chip="fold"]'))
      for (let frame = 0; frame < 35; frame++) {
        const overlap = await page.locator('[data-element="azure.prod"]').evaluate((node) => {
          const title = node.querySelector(':scope > text').getBoundingClientRect()
          const chip = node.querySelector('[data-chip="fold"] rect').getBoundingClientRect()
          const box = node.querySelector('.archd-shape').getBoundingClientRect()
          return title.right > chip.left + 0.5 || title.right > box.right + 0.5
        })
        assert.equal(overlap, false, `frame ${frame}: the title stays to the left of Fold`)
        await advance(page, 16)
      }
      assert.match(await page.locator('[data-element="azure.prod"] > title').textContent(), /SUB-CONTOSO-PROD/)
    })

    test('card text fits even with a wide fallback font', { timeout: 45_000 }, async (t) => {
      const page = await open(t)
      await page.addStyleTag({ content: '.archd-stage text { font-family: "DejaVu Sans Mono", monospace !important; }' })
      await page.getByRole('button', { name: 'AWS', exact: true }).click()
      await focused(page, 'AWS')
      await page.getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')
      await settled(page)
      const overflow = await page.evaluate(() => {
        const failures = []
        for (const node of document.querySelectorAll('.archd-node')) {
          const box = node.querySelector('.archd-shape').getBoundingClientRect()
          for (const text of node.querySelectorAll(':scope > text')) {
            if (![19, 28].includes(parseFloat(getComputedStyle(text).fontSize))) continue
            const rect = text.getBoundingClientRect()
            if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
              failures.push(`${node.dataset.element}: ${text.textContent}`)
          }
        }
        return failures
      })
      assert.deepEqual(overflow, [], 'measured card labels stay within the box')
    })

    test('card labels stay above the bottom border and group footer', { timeout: 45_000 }, async (t) => {
      const page = await open(t)
      const check = async () => {
        const overflow = await page.evaluate(() => {
          const failures = []
          for (const node of document.querySelectorAll('.archd-node')) {
            const box = node.querySelector('.archd-shape').getBoundingClientRect()
            const footer = node.querySelector('.archd-count-chip rect')?.getBoundingClientRect()
            for (const text of node.querySelectorAll(':scope > text')) {
              if (![19, 28].includes(parseFloat(getComputedStyle(text).fontSize))) continue
              const rect = text.getBoundingClientRect()
              if (rect.bottom > (footer?.top ?? box.bottom) + 0.5)
                failures.push(`${node.dataset.element}: ${text.textContent}`)
            }
          }
          return failures
        })
        assert.deepEqual(overflow, [], 'card text never enters the footer or crosses the border')
      }
      await settled(page)
      await check()
      await page.locator('[data-element="azure.prod"]').click()
      await page.locator('.archd-detail').getByRole('button', { name: 'Zoom in', exact: true }).click()
      await focused(page, 'sub-contoso-prod')
      await settled(page)
      await check()
    })

    test('navigation, unfolding, history, flows and persistent theme', { timeout: 90_000 }, async (t) => {
      const page = await open(t)
      assert.equal(await page.title(), 'reference')
      assert.equal(await page.locator('html').getAttribute('lang'), 'en')
      assert.match(await page.locator('.archd-header-status').textContent(), /^Snapshot of reference · /)
      await page.getByRole('button', { name: 'AWS', exact: true }).click()
      await focused(page, 'AWS')
      await page.getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')

      await nodeText(page, 'sub-contoso-prod').click()
      await shown(page, page.locator('.archd-detail h4'))
      assert.match(await page.locator('.archd-detail').textContent(), /azure\.prod/)
      await page.locator('.archd-detail').getByRole('button', { name: 'Zoom in', exact: true }).click()
      await focused(page, 'sub-contoso-prod')
      const beforeUnfold = await page.locator('.archd-stage > svg').innerHTML()
      await unfoldChip(page, 'rg-edge').click()
      await shown(page, page.getByRole('button', { name: 'Fold all', exact: true }))
      await shown(page, nodeText(page, 'Front Door'))
      await until(page, () =>
        [...document.querySelectorAll('.archd-stage svg text')].some(
          (text) => text.textContent === 'Front Door' && text.closest('.archd-node')?.querySelector('.archd-ico'),
        ),
      )
      assert.notEqual(await page.locator('.archd-stage > svg').innerHTML(), beforeUnfold)
      await focused(page, 'sub-contoso-prod') // Unfolding must not navigate into the group.
      await page.screenshot({ path: path.join(artifacts, 'standalone-light.png') })

      await page.getByRole('button', { name: 'Fold all', exact: true }).click()
      await until(page, () => document.querySelector('button[aria-label="Fold all"]')?.disabled)
      await page.locator('.archd-crumbs').getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')

      await page.getByRole('button', { name: 'Previous version', exact: true }).click()
      await shown(page, page.getByRole('button', { name: 'Operations before', exact: true }))
      assert.match(await page.locator('.archd-time').textContent(), /v1/)
      await page.getByRole('button', { name: 'Next version', exact: true }).click()
      await shown(page, page.getByRole('button', { name: 'Operations', exact: true }))
      assert.match(await page.locator('.archd-time').textContent(), /live/)

      const beforeDirection = await page.locator('.archd-stage > svg').innerHTML()
      await page.getByRole('button', { name: 'Layout: vertical — switch to horizontal', exact: true }).click()
      await until(
        page,
        (before) =>
          localStorage.getItem('architecture-diagrams.direction') === 'LeftRight' &&
          document.querySelector('.archd-stage > svg')?.innerHTML !== before,
        beforeDirection,
      )
      await page.getByRole('button', { name: 'A scan, from depot to customer', exact: true }).click()
      await until(page, () => document.querySelector('.archd-flow[aria-current=true]'))
      await shown(page, page.locator('.archd-crumbs').getByRole('button', { name: 'Leave flow' }))
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
      assert.equal(await page.evaluate(() => localStorage.getItem('architecture-diagrams.direction')), 'LeftRight')
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
            await page.locator('.archd-crumbs').getByRole('button', { name: 'sub-contoso-prod', exact: true }).click()
          else await page.locator('.archd-stage').press('Backspace')
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
      await page.locator('.archd-stage').press('Escape')
      await page.setViewportSize({ width: 480, height: 800 })
      await settled(page)
      await zoomUnfolded(page, 'azure.prod.edge', 'rg-edge', ['azure.prod.edge.frontdoor', 'azure.prod.edge.waf', 'azure.prod.edge.dns'], {
        leave: false,
      })
      await page.getByRole('button', { name: 'Fit', exact: true }).click()
      await settled(page)
      await focused(page, 'rg-edge')
      assert.equal(
        await page.locator('.archd-stage').evaluate((stage) => {
          const box = stage.getBoundingClientRect()
          return [...stage.querySelectorAll('.archd-node .archd-shape')].every((node) => {
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
        assert.ok((await page.locator('.archd-header-status').textContent()).startsWith(labels[expected].snapshot))
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
