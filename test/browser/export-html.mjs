// Optional DSH HTML-export browser check; not collected by test/*.test.mjs.
// Build the clients first, then opt in explicitly:
// DSHD_CHROMIUM=/path/to/chrome node --test test/browser/export-html.mjs
// DSHD_PLAYWRIGHT accepts a package directory or entry file; otherwise try
// ordinary imports, then the optional .local/harness Playwright installation.
// A routed fake DSH serves the real client/chunks; no HTTP server is started.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = 'http://diagram-export.test'
const artifacts = path.join(root, '.local/export-html-check')
const exportChunk = 'client.export-html.js'
const labels = {
  en: {
    html: 'Download this diagram as an offline HTML page',
    previous: 'Previous version', next: 'Next version', enter: 'Zoom in ▸',
    foldAll: 'Fold all', live: 'live', fit: 'Fit',
  },
  fr: {
    html: 'Télécharger ce schéma en page HTML autonome',
    previous: 'Version précédente', next: 'Version suivante', enter: 'Entrer ▸',
    foldAll: 'Tout replier', live: 'direct', fit: 'Ajuster',
  },
}

async function playwright() {
  if (process.env.DSHD_PLAYWRIGHT) return createRequire(import.meta.url)(path.resolve(process.env.DSHD_PLAYWRIGHT))
  for (const name of ['playwright-core', 'playwright']) {
    try { return await import(name) } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error }
  }
  try { return createRequire(new URL('../../.local/harness/package.json', import.meta.url))('playwright-core') }
  catch (error) { throw new Error('Install playwright-core or set DSHD_PLAYWRIGHT to its package directory', { cause: error }) }
}

// React 19 no longer ships UMD builds. Bundle only the fake shell's React in
// memory using the already-installed build dependencies, not another server or
// another generated source file. The production client itself remains unmodified.
async function shellReact() {
  const require = createRequire(new URL('../../build/package.json', import.meta.url))
  const { build } = require('esbuild')
  const result = await build({
    stdin: {
      contents: "import * as React from 'react'; import { createRoot } from 'react-dom/client'; window.__TEST_REACT__ = { React, createRoot };",
      resolveDir: path.join(root, 'build'),
    },
    bundle: true, write: false, minify: true, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
  })
  return result.outputFiles[0].text
}

function fakeDsh(files) {
  // Only invented example data is embedded here. JSON escaping also keeps this
  // fixture valid if examples later contain HTML-like metadata.
  const json = JSON.stringify(files).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">
<style>
:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f3f4f6;--dsw-alias-bg-overlay:#e9ecf2;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;--dsw-alias-brand-primary:#0f1115;--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#61666b;--dsw-alias-state-error-primary:#ec1313;--dsw-alias-state-idle-primary:#d4d4d4;--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;color-scheme:light}
@media(prefers-color-scheme:dark){:root{--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-layer-2:#2c2c2e;--dsw-alias-bg-overlay:#61666b;--dsw-alias-border-l1:#ffffff0f;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-brand-primary:#f9fafb;--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-state-error-primary:#f25a5a;color-scheme:dark}}
html,body,#root{margin:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:system-ui,sans-serif}
</style><script src="/react.js"></script><script>
(() => {
  const { React, createRoot } = window.__TEST_REACT__;
  const chunks = new Map(), pending = new Map();
  let main;
  const req = name => { if (name === 'react') return React; throw new Error('Unexpected shell dependency: ' + name); };
  req.async = p => {
    const name = p.replace(/^\\.\\//, '');
    if (!/^client\\.(?:likec4|export-html|icons-\\d{3})\\.js$/.test(name)) return Promise.reject(new Error('Unexpected chunk: ' + name));
    if (name === 'client.export-html.js' && window.__dshTest.failExportOnce) {
      window.__dshTest.failExportOnce = false;
      return Promise.reject(new Error('Simulated HTML chunk load failure'));
    }
    if (chunks.has(name)) return Promise.resolve(chunks.get(name));
    if (pending.has(name)) return pending.get(name);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/' + name;
      script.onload = () => { script.remove(); chunks.has(name) ? resolve(chunks.get(name)) : reject(new Error('Chunk did not register: ' + name)); };
      script.onerror = () => { script.remove(); reject(new Error('Cannot load chunk: ' + name)); };
      document.head.appendChild(script);
    });
    pending.set(name, promise);
    return promise;
  };
  window.__ModuleLoader__ = { load({ chunk, factory }) {
    const value = factory(req);
    if (chunk) chunks.set(chunk.replace(/^\\.\\//, ''), value); else main = value;
  } };
  const files = ${json};
  let version = 1, sessionId = 'S', renderSession;
  const missing = p => Object.assign(new Error('Missing fixture file: ' + p), { code: 'workspace-file/not-found' });
  window.__dshTest = {
    calls: [], holdSnapshotReads: false, heldReads: 0, abortedReads: 0,
    failHistoryOnce: true, failedHistoryReads: 0, successfulHistoryReads: 0, messages: [],
    setLive(source) { files['.diagram/' + sessionId.replace(/[^A-Za-z0-9_.-]/g, '_') + '.c4'] = source; version++; },
    setSession(id) { window.__dshTest.messages = []; sessionId = id; renderSession(); },
    mount() {
      const lang = navigator.language.split('-')[0];
      let dictionaries = {}, Body;
      const t = (key, params) => {
        const text = dictionaries[lang]?.[key] ?? dictionaries.en?.[key] ?? key;
        return params ? text.replace(/\\{(\\w+)\\}/g, (match, name) => name in params ? String(params[name]) : match) : text;
      };
      const ctx = {
        effect: fn => fn(),
        locale: { register: (_ns, value) => { dictionaries = value; }, bind: () => t },
        sidebarRightTabs: { register: () => {} },
        slots: { inject: (_name, fn) => fn(), register: (options, Component) => { if (options.name === 'sidebar.right.pane.tab') Body = Component; } },
        remote: { workspaceFiles: {
          async stat(_sid, p, signal) { window.__dshTest.calls.push([_sid, p]); signal?.throwIfAborted(); if (!Object.hasOwn(files, p)) throw missing(p); return { version }; },
          async read(_sid, p, { offset = 1 } = {}, signal) {
            window.__dshTest.calls.push([_sid, p]);
            signal?.throwIfAborted(); if (!Object.hasOwn(files, p)) throw missing(p);
            if (window.__dshTest.holdSnapshotReads && /^\\.diagram\\/S\\/0001/.test(p)) {
              window.__dshTest.heldReads++;
              await new Promise((resolve, reject) => {
                if (!signal) throw new Error('Snapshot reads must receive an AbortSignal');
                signal.addEventListener('abort', () => { window.__dshTest.abortedReads++; reject(signal.reason); }, { once: true });
              });
            }
            if (/^\\.diagram\\/S\\/0002/.test(p)) {
              if (window.__dshTest.failHistoryOnce) {
                window.__dshTest.failHistoryOnce = false;
                window.__dshTest.failedHistoryReads++;
                throw new Error('Transient history read failure');
              }
              window.__dshTest.successfulHistoryReads++;
            }
            const lines = files[p].split('\\n').slice(offset - 1);
            return { text: lines.join('\\n'), lines: lines.length, eof: true, version };
          },
          async list(_sid, p, signal) {
            signal?.throwIfAborted(); const prefix = p.replace(/\\/$/, '') + '/';
            return { entries: Object.keys(files).filter(name => name.startsWith(prefix) && !name.slice(prefix.length).includes('/')).sort().map(name => ({ name: name.slice(prefix.length), type: 'file' })) };
          },
        } },
      };
      main.apply(ctx);
      if (!Body) throw new Error('DSH client did not register its body');
      const root = createRoot(document.getElementById('root'));
      new MutationObserver(() => { const text = document.querySelector('.dshd-msg')?.textContent; if (text) window.__dshTest.messages.push(text); }).observe(document.getElementById('root'), { subtree: true, childList: true, characterData: true });
      renderSession = () => root.render(React.createElement(Body, { t, diagramSessionId: sessionId }));
      renderSession();
    },
  };
})();
</script><script src="/client.js"></script></head><body><div id="root"></div><script>window.__dshTest.mount();</script></body></html>`
}

async function ready(page) {
  await page.locator('.dshd-stage > svg').waitFor({ timeout: 30_000 })
  await page.locator('.dshd-stage .dshd-node').first().waitFor()
  await page.waitForFunction(() => document.querySelector('.dshd-stage .dshd-ico'))
  assert.equal(await page.getByRole('button', { name: /PNG/i }).count(), 0, 'PNG export must not be available')
}
const nodeText = (page, title) => page.locator('.dshd-stage svg text').filter({ hasText: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first()
async function focused(page, title) {
  await page.waitForFunction(value => document.querySelector('.dshd-crumbs b')?.textContent === value, title)
}
async function enterFrontend(page, copy) {
  await page.getByRole('button', { name: 'Web shop', exact: true }).click()
  await focused(page, 'Web shop')
  await nodeText(page, 'Frontend').click()
  await page.locator('.dshd-detail').getByRole('button', { name: copy.enter, exact: true }).click()
  await focused(page, 'Frontend')
}
function watchErrors(page, errors, prefix, expectedFailure = {}) {
  page.on('pageerror', error => errors.push(`${prefix}: ${error.message}`))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (expectedFailure.active && /^\[dsh-diagram\] HTML export Error: Simulated HTML chunk load failure/.test(message.text())) expectedFailure.console++
    else errors.push(`${prefix}: ${message.text()}`)
  })
  page.on('dialog', async dialog => {
    errors.push(`${prefix}: unexpected modal: ${dialog.message()}`)
    await dialog.dismiss()
  })
}

// No Chromium path means no browser/dependency/build requirement for node:test.
test('DSH exports the complete displayed version as an interactive offline HTML page', {
  skip: !process.env.DSHD_CHROMIUM,
  timeout: 180_000,
}, async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'dshd-export-browser-'))
  t.after(async () => {
    // Delete only the directory freshly allocated by this test.
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
    assert.match(path.basename(temporary), /^dshd-export-browser-/)
    await rm(temporary, { recursive: true, force: true })
  })
  await mkdir(artifacts, { recursive: true })
  const example = await readFile(path.join(root, 'examples/web-shop.c4'), 'utf8')
  const live = example.replace("delivery = system 'Delivery'", "delivery = system 'Delivery live'")
  const previous = example.replace("delivery = system 'Delivery'", "delivery = system 'Delivery archived'")
  assert.notEqual(live, example)
  assert.notEqual(previous, example)
  const invalidSuffix = '\nTHIS_IS_AN_INVALID_LIVE_EDIT {\n'
  const invalid = live + invalidSuffix
  const updated = example.replace("delivery = system 'Delivery'", "delivery = system 'Delivery updated'")
  const otherSession = example.replace("shop = system 'Web shop'", "shop = system 'Workshop T'").replace("delivery = system 'Delivery'", "delivery = system 'Delivery T'")
  const fixture = {
    '.diagram/S.c4': live,
    '.diagram/S/0001.c4': previous,
    '.diagram/S/0002.c4': live,
    '.diagram/T.c4': otherSession + invalidSuffix,
    '.diagram/a_b.c4': example.replace("delivery = system 'Delivery'", "delivery = system 'Delivery sanitized'"),
    '.diagram/child_1.ref': 'r:1\n',
    '.diagram/r_1.c4': example.replace("delivery = system 'Delivery'", "delivery = system 'Delivery root'"),
    '.diagram/r_1/9999-x.c4': previous,
    '.diagram/r_1/10000-y.c4': live,
  }
  const assets = new Map([['react.js', await shellReact()]])
  async function asset(name) {
    if (!assets.has(name)) assets.set(name, await readFile(path.join(root, name), 'utf8'))
    return assets.get(name)
  }
  // Fail with the asset name if clients have not been rebuilt for this feature.
  await Promise.all(['client.js', 'client.likec4.js', exportChunk].map(asset))
  const { chromium } = await playwright()
  const browser = await chromium.launch({ executablePath: process.env.DSHD_CHROMIUM, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const errors = []
  const unexpected = []
  const offlineRequests = []

  async function openDsh(locale, colorScheme, holdExport = false) {
    // Hold the actual lazy-chunk response to exercise a live update while the
    // click handler awaits assets, rather than merely delaying a mock callback.
    let releaseExport, requestedExport
    const exportGate = new Promise(resolve => { releaseExport = resolve })
    const exportRequested = new Promise(resolve => { requestedExport = resolve })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale, colorScheme, reducedMotion: 'reduce', acceptDownloads: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const expectedFailure = { active: false, console: 0, dialog: 0 }
    watchErrors(page, errors, `${locale} DSH`, expectedFailure)
    const chunks = []
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin === origin && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fakeDsh(fixture) })
      const name = url.pathname.slice(1)
      if (url.origin === origin && /^(?:react|client|client\.(?:likec4|export-html|icons-\d{3}))\.js$/.test(name)) {
        chunks.push(name)
        if (name === exportChunk) {
          requestedExport()
          if (holdExport) await exportGate
        }
        return route.fulfill({ contentType: 'text/javascript', body: await asset(name) })
      }
      unexpected.push(url.href)
      return route.abort()
    })
    await page.goto(origin + '/')
    await ready(page)
    return { context, page, chunks, expectedFailure, exportRequested, releaseExport }
  }

  async function downloadHtml(page, copy, expected, name, whileLoading) {
    const button = page.getByRole('button', { name: copy.html, exact: true })
    await page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === label && !button.disabled), copy.html)
    const pending = page.waitForEvent('download', { timeout: 30_000 })
    await button.click()
    if (whileLoading) await whileLoading()
    const download = await pending
    assert.equal(await download.failure(), null, 'HTML download failed')
    assert.match(download.suggestedFilename(), /\.html$/i)
    assert.equal(path.basename(download.suggestedFilename()), download.suggestedFilename())
    const file = path.join(temporary, name + '.html')
    await download.saveAs(file)
    const html = await readFile(file, 'utf8')
    assert.match(html, /^<!doctype html>/i)
    assert.ok(Buffer.byteLength(html) <= 5_000_000, 'HTML exceeded the existing offline page budget')
    const match = /<script\b[^>]*\bid="dshd-data"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
    assert.ok(match, 'Download did not embed standalone data')
    const data = JSON.parse(match[1])
    assert.equal(data.mode, 'embedded')
    assert.deepEqual(Object.keys(data.files), ['.diagram/diagram.c4'], 'Export must contain only one current source, not history or workspace paths')
    assert.equal(data.files['.diagram/diagram.c4'], expected, 'Exported source differs from the complete displayed version')
    assert.ok(Object.keys(data.icons ?? {}).length > 0, 'Export is missing its local icons')
    t.diagnostic(`${name}: ${download.suggestedFilename()}, ${Buffer.byteLength(html)} bytes`)
    return file
  }

  async function checkOffline(file, lang, colorScheme, delivery, screenshot) {
    const copy = labels[lang]
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: lang === 'fr' ? 'fr-FR' : 'en-US', colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' })
    await context.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith('file:')) return route.continue()
      offlineRequests.push(url)
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    watchErrors(page, errors, `${lang} offline`)
    try {
      await page.goto(pathToFileURL(file).href)
      await ready(page)
      assert.equal(await page.locator('html').getAttribute('lang'), lang)
      await page.getByRole('button', { name: copy.fit, exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: /HTML/i }).count(), 0, 'Standalone must not expose the DSH-only HTML export')
      assert.equal(await page.locator('.dshd-time').count(), 0, 'History must not be included in exported HTML')
      await page.getByRole('button', { name: delivery, exact: true }).click()
      await focused(page, delivery)
      await enterFrontend(page, copy)
      const folded = await page.locator('.dshd-stage > svg').innerHTML()
      await nodeText(page, 'Checkout').dblclick()
      await page.getByRole('button', { name: copy.foldAll, exact: true }).waitFor()
      await nodeText(page, 'PaymentForm.tsx').waitFor()
      await focused(page, 'Frontend')
      assert.notEqual(await page.locator('.dshd-stage > svg').innerHTML(), folded, 'Offline unfolding did not recompute the layout')
      await page.waitForFunction(expected => getComputedStyle(document.body).backgroundColor === expected, colorScheme === 'dark' ? 'rgb(21, 21, 23)' : 'rgb(255, 255, 255)')
      if (screenshot) await page.screenshot({ path: path.join(artifacts, screenshot) })
    } catch (error) {
      await page.screenshot({ path: path.join(artifacts, `${lang}-offline-failure.png`) }).catch(() => {})
      throw error
    } finally { await context.close() }
  }

  for (const [locale, lang, scheme] of [['en-US', 'en', 'light'], ['fr-FR', 'fr', 'dark']]) {
    const copy = labels[lang]
    const { context, page, chunks, expectedFailure } = await openDsh(locale, scheme)
    try {
      await page.getByRole('button', { name: copy.html, exact: true }).waitFor()
      await page.getByRole('button', { name: 'Delivery live', exact: true }).waitFor()
      await page.getByRole('button', { name: copy.previous, exact: true }).waitFor()
      await page.waitForFunction(() => window.__dshTest.failedHistoryReads === 1 && window.__dshTest.successfulHistoryReads > 0)
      // Navigate away from the overview before export: an HTML page must keep
      // all schemas and descendants, not just the currently visible SVG.
      await enterFrontend(page, copy)
      assert.equal(chunks.filter(name => name === exportChunk).length, 0, 'HTML assets were requested before the first click')
      {
        // Emulate one rejected module-loader fetch without a real failed HTTP
        // request (which would add Chromium's own resource console error).
        expectedFailure.active = true
        await page.evaluate(() => { window.__dshTest.failExportOnce = true })
        await page.getByRole('button', { name: copy.html, exact: true }).click()
        const banner = page.locator('.dshd-err[role=alert]')
        await banner.waitFor()
        assert.match(await banner.textContent(), /Simulated HTML chunk load failure/)
        await banner.click()
        await banner.waitFor({ state: 'hidden' })
        await page.waitForFunction(label => !document.querySelector(`button[aria-label="${label}"]`)?.disabled, copy.html)
        expectedFailure.active = false
        assert.equal(expectedFailure.dialog, 0, 'Export errors must never open a browser modal')
        assert.equal(expectedFailure.console, 1, 'Expected exactly the injected export error')
      }
      const current = await downloadHtml(page, copy, live, `${lang}-live`)
      assert.equal(chunks.filter(name => name === exportChunk).length, 1, 'HTML assets must load lazily on demand')
      await checkOffline(current, lang, scheme, 'Delivery live', `${lang}-${scheme}.png`)

      await page.getByRole('button', { name: copy.previous, exact: true }).click()
      await page.getByRole('button', { name: 'Delivery archived', exact: true }).waitFor()
      assert.match(await page.locator('.dshd-time').textContent(), /v1/)
      const archived = await downloadHtml(page, copy, previous, `${lang}-snapshot`)
      await checkOffline(archived, lang, scheme, 'Delivery archived')

      await page.getByRole('button', { name: copy.next, exact: true }).click()
      await page.getByRole('button', { name: 'Delivery live', exact: true }).waitFor()
      assert.ok((await page.locator('.dshd-time').textContent()).includes(copy.live))
      await page.bringToFront() // The polling fallback follows visible DSH tabs.
      await page.evaluate(source => window.__dshTest.setLive(source), invalid)
      await page.locator('.dshd-err[role="status"]').first().waitFor({ timeout: 20_000 })
      // Invalid edits must preserve both the last drawing and its exact source.
      await page.getByRole('button', { name: 'Delivery live', exact: true }).waitFor()
      const fallback = await downloadHtml(page, copy, live, `${lang}-invalid-live`)
      await checkOffline(fallback, lang, scheme, 'Delivery live')
      assert.equal(chunks.filter(name => name === exportChunk).length, 1, 'Repeated exports must reuse the loaded chunk')
      await page.evaluate(() => { window.__dshTest.holdSnapshotReads = true })
      await page.getByRole('button', { name: copy.previous, exact: true }).click()
      await page.waitForFunction(() => window.__dshTest.heldReads === 1)
      await page.getByRole('button', { name: copy.next, exact: true }).click()
      await page.waitForFunction(() => window.__dshTest.abortedReads === 1)
      await page.waitForFunction(label => !document.querySelector(`button[aria-label="${label}"]`)?.disabled, copy.html)
    } catch (error) {
      await page.screenshot({ path: path.join(artifacts, `${lang}-dsh-failure.png`) }).catch(() => {})
      throw error
    } finally { await context.close() }
  }
  // A separate fresh page lets the first real asset request stay pending. The
  // snapshot belongs to the click, even if the displayed source changes first.
  const racing = await openDsh('en-US', 'light', true)
  try {
    const { page, exportRequested, releaseExport } = racing
    await page.getByRole('button', { name: 'Delivery live', exact: true }).waitFor()
    await downloadHtml(page, labels.en, live, 'en-click-capture', async () => {
      await exportRequested
      await page.evaluate(source => window.__dshTest.setLive(source), updated)
      await page.getByRole('button', { name: 'Delivery updated', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: labels.en.html, exact: true }).isDisabled(), true, 'Only one export may run while assets are pending')
      releaseExport()
    })

    // Reuse the same mounted Body, as DSH does when switching conversations.
    // An initially invalid T must not inherit S's last valid layout/source.
    await page.evaluate(() => window.__dshTest.setSession('T'))
    await page.locator('.dshd-err[role="status"]').first().waitFor()
    await page.locator('.dshd-stage').waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: labels.en.html, exact: true }).isDisabled(), true, 'Session T must not export session S as its last valid diagram')
    await page.evaluate(source => window.__dshTest.setLive(source), otherSession)
    await page.getByRole('button', { name: 'Delivery T', exact: true }).waitFor()
    await downloadHtml(page, labels.en, otherSession, 'en-session-T')

    await page.evaluate(() => window.__dshTest.setSession('a/b'))
    await page.getByRole('button', { name: 'Delivery sanitized', exact: true }).waitFor()
    assert.ok(await page.evaluate(() => window.__dshTest.calls.some(([sid, p]) => sid === 'a/b' && p === '.diagram/a_b.c4')))
    assert.equal(await page.evaluate(() => window.__dshTest.messages.includes('The diagram file does not parse yet.')), false)
    await page.evaluate(() => window.__dshTest.setSession('child/1'))
    await page.getByRole('button', { name: 'Delivery root', exact: true }).waitFor()
    await page.locator('.dshd-sub').waitFor()
    assert.equal(await page.evaluate(() => window.__dshTest.messages.includes('The diagram file does not parse yet.')), false)
    await page.getByRole('button', { name: labels.en.previous, exact: true }).click()
    await page.getByRole('button', { name: 'Delivery archived', exact: true }).waitFor()
    assert.match(await page.locator('.dshd-time').textContent(), /v9999/)
    const calls = await page.evaluate(() => window.__dshTest.calls.filter(([sid]) => sid === 'child/1'))
    for (const p of ['.diagram/child_1.ref', '.diagram/r_1.c4', '.diagram/r_1/9999-x.c4']) assert.ok(calls.some(([, name]) => name === p), p)

    await page.evaluate(() => window.__dshTest.setSession('EMPTY'))
    await page.getByText('No diagram yet', { exact: true }).waitFor()
    assert.equal(await page.locator('.dshd-stage').count(), 0)
    assert.equal(await page.locator('.dshd-time').count(), 0)
    assert.equal(await page.getByRole('button', { name: labels.en.html, exact: true }).isDisabled(), true, 'A session without a diagram must not export the previous conversation')
  } catch (error) {
    await racing.page.screenshot({ path: path.join(artifacts, 'session-race-failure.png') }).catch(() => {})
    throw error
  } finally {
    racing.releaseExport()
    await racing.context.close()
  }

  assert.deepEqual(errors, [], 'Browser errors or failed exports')
  assert.deepEqual(unexpected, [], 'Fake DSH requested an unexpected URL')
  assert.deepEqual(offlineRequests, [], 'Offline HTML attempted to access the network')
  t.diagnostic(`Screenshots saved in ${path.relative(root, artifacts)}`)
})


test('reference navigation and non-modal export failures work across locales and themes', {
  skip: !process.env.DSHD_CHROMIUM,
  timeout: 240_000,
}, async t => {
  const source = await readFile(path.join(root, 'examples/reference.c4'), 'utf8')
  const previous = source.replace("ops = system 'Operations'", "ops = system 'Operations before'")
  const files = { '.diagram/S.c4': source, '.diagram/S/9999-x.c4': previous, '.diagram/S/10000-y.c4': source }
  const assets = new Map([['react.js', await shellReact()]])
  const { chromium } = await playwright()
  const browser = await chromium.launch({ executablePath: process.env.DSHD_CHROMIUM, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  await mkdir(artifacts, { recursive: true })
  for (const [locale, lang] of [['en-US', 'en'], ['fr-FR', 'fr']]) for (const scheme of ['light', 'dark']) {
    const copy = labels[lang]
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale, colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    const errors = []
    const failure = { active: false, console: 0 }
    watchErrors(page, errors, `${lang}/${scheme}`, failure)
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin === origin && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fakeDsh(files) })
      const name = url.pathname.slice(1)
      if (url.origin === origin && /^(?:react|client|client\.(?:likec4|export-html|icons-\d{3}))\.js$/.test(name)) {
        if (!assets.has(name)) assets.set(name, await readFile(path.join(root, name), 'utf8'))
        return route.fulfill({ contentType: 'text/javascript', body: assets.get(name) })
      }
      errors.push('Unexpected request: ' + url.href)
      return route.abort()
    })
    try {
      await page.goto(origin)
      await ready(page)
      const button = page.getByRole('button', { name: copy.html, exact: true })
      await page.waitForFunction(label => !document.querySelector(`button[aria-label="${label}"]`)?.disabled, copy.html)
      assert.equal(await button.isEnabled(), true)
      failure.active = true
      await page.evaluate(() => { window.__dshTest.failExportOnce = true })
      await button.click()
      const banner = page.locator('.dshd-err[role=alert]')
      await banner.waitFor()
      assert.match(await banner.textContent(), /Simulated HTML chunk load failure/)
      assert.ok((await banner.textContent()).startsWith(lang === 'fr' ? 'Échec' : 'HTML export failed'))
      const bannerStyle = await banner.evaluate(node => { const css = getComputedStyle(node); return { background: css.backgroundColor, align: css.textAlign, cursor: css.cursor, width: node.getBoundingClientRect().width, rootWidth: node.parentElement.clientWidth }; })
      assert.equal(bannerStyle.background, 'rgba(0, 0, 0, 0)')
      assert.equal(bannerStyle.align, 'left')
      assert.equal(bannerStyle.cursor, 'pointer')
      assert.ok(Math.abs(bannerStyle.width - (bannerStyle.rootWidth - 20)) < 1)
      await page.screenshot({ path: path.join(artifacts, `reference-error-${lang}-${scheme}.png`) })
      await banner.click()
      await banner.waitFor({ state: 'hidden' })
      failure.active = false
      assert.equal(failure.console, 1)

      await page.getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')
      const box = await nodeText(page, 'sub-contoso-prod').boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      for (let i = 0; i < 14; i++) {
        if (await page.locator('.dshd-crumbs b').textContent() === 'sub-contoso-prod') break
        await page.mouse.wheel(0, -120)
        await page.waitForTimeout(40)
      }
      await focused(page, 'sub-contoso-prod')
      await page.getByRole('button', { name: copy.fit, exact: true }).click()
      await nodeText(page, 'rg-edge').dblclick()
      await nodeText(page, 'Front Door').waitFor()
      await focused(page, 'sub-contoso-prod')
      await page.locator('.dshd-stage svg text').filter({ hasText: /^RG-EDGE/ }).first().dblclick()
      await page.getByRole('button', { name: copy.foldAll, exact: true }).waitFor({ state: 'hidden' })
      await nodeText(page, 'rg-edge').waitFor()
      await page.locator('.dshd-crumbs').getByRole('button', { name: 'Azure', exact: true }).click()
      await focused(page, 'Azure')
      await page.getByRole('button', { name: lang === 'fr' ? 'Sens de la mise en page' : 'Layout direction', exact: true }).click()
      await page.waitForFunction(() => localStorage.getItem('dsh-diagram.direction') === 'LeftRight')
      await page.getByRole('button', { name: copy.previous, exact: true }).click()
      await page.getByRole('button', { name: 'Operations before', exact: true }).waitFor()
      assert.match(await page.locator('.dshd-time').textContent(), /v9999/)
      await page.getByRole('button', { name: copy.next, exact: true }).click()
      await page.getByRole('button', { name: 'Operations', exact: true }).waitFor()
      await focused(page, 'Azure')
      await page.getByRole('button', { name: copy.fit, exact: true }).click()
      await page.screenshot({ path: path.join(artifacts, `reference-${lang}-${scheme}.png`) })
      assert.deepEqual(errors, [])
      t.diagnostic(`${lang}/${scheme}: wheel, double-click unfold/fold, breadcrumb, fit, direction, numeric timeline and export banner OK`)
    } finally { await context.close() }
  }
})
