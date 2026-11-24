import { readPreference, writePreference } from './preferences.js'
// Browser entry of the viewer page written by `render` (embedded) or `serve` (remote).
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { dictionaries, translator } from './translation.js'
import { CSS } from './style.js'
import { setLoader } from './data.js'
import { setIconLoader } from './iconpack.js'
import { makeBody } from './body.js'
import { bySnapshotIndex } from '../core/shared.js'

const THEME_KEY = 'architecture-diagrams.theme'
const THEMES = ['auto', 'light', 'dark']

/**
 * src/cli/html.mjs installs window.__ARCHD__ = { chunks, define, engine } before
 * any chunk runs. Every chunk calls define(name, factory) on load; `engine()`
 * inflates and runs the packed engine of an embedded page once.
 */
function makeLoader(data, chunks) {
  const pending = new Map()
  const embedded = data.mode === 'embedded'
  return {
    load(name) {
      // The shim may already have run the engine (it starts at page load), so the
      // embedded engine always goes through this promise: its icon index is set once.
      if (embedded && name === 'engine.js') {
        if (!pending.has(name)) {
          const promise = window.__ARCHD__.engine().then(() => {
            if (!chunks.has(name)) throw new Error(`Missing embedded diagram chunk: ${name}`)
            const engine = chunks.get(name)
            // The embedded engine has no icon index: give it the page's, before any parse.
            engine.setIconIndex(data.iconIndex)
            return engine
          })
          pending.set(name, promise)
          promise.catch(() => pending.delete(name))
        }
        return pending.get(name)
      }
      if (chunks.has(name)) return Promise.resolve(chunks.get(name))
      if (pending.has(name)) return pending.get(name)
      const shard = /^icons-(\d{3})\.js$/.exec(name)
      if (name !== 'engine.js' && !shard) return Promise.reject(new Error(`Unknown diagram chunk: ${name}`))
      if (embedded) {
        const icons = { ...data.icons[Number(shard[1])] }
        chunks.set(name, icons)
        return Promise.resolve(icons)
      }
      const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = '/' + name
        script.onload = () => {
          script.remove()
          if (chunks.has(name)) resolve(chunks.get(name))
          else reject(new Error(`Diagram chunk did not register: ${name}`))
        }
        script.onerror = () => {
          script.remove()
          reject(new Error(`Cannot load diagram chunk: ${name}`))
        }
        document.head.appendChild(script)
      }).catch((error) => {
        if (!shard) {
          pending.delete(name)
          throw error
        }
        // iconpack retries rejected shards: resolve missing icons once, without a loop.
        const empty = {}
        chunks.set(name, empty)
        return empty
      })
      pending.set(name, promise)
      return promise
    },
  }
}

/** The page's own copy of the diagram, or the `serve` API (src/cli/serve.mjs). */
function makeIo(data) {
  if (data.mode === 'embedded') {
    const history = data.history
    return {
      live: false,
      async source() {
        return { text: data.source, version: 1 }
      },
      async history() {
        return Object.keys(history).sort(bySnapshotIndex)
      },
      async snapshot(name) {
        if (!Object.hasOwn(history, name)) throw new Error(`Unknown snapshot: ${name}`)
        return history[name]
      },
    }
  }
  const get = async (route, signal) => {
    const response = await fetch(route, { signal, cache: 'no-store' })
    if (!response.ok) throw Object.assign(new Error(`Cannot read ${route} (HTTP ${response.status})`), { status: response.status })
    return response.json()
  }
  return {
    live: true,
    async source(signal) {
      try {
        return await get('/api/source', signal)
      } catch (error) {
        if (error.status === 404) return null
        throw error
      }
    },
    async history(signal) {
      return (await get('/api/history', signal)).names
    },
    async snapshot(name, signal) {
      return (await get(`/api/history/${encodeURIComponent(name)}`, signal)).text
    },
  }
}

function language(data) {
  if (Object.hasOwn(dictionaries, data.lang)) return data.lang
  for (const tag of navigator.languages ?? [navigator.language]) {
    const prefix = String(tag).toLowerCase().split(/[-_]/)[0]
    if (Object.hasOwn(dictionaries, prefix)) return prefix
  }
  return 'en'
}

const LIGHT = `
--archd-bg-base:#fff;--archd-bg-layer-1:#fff;--archd-bg-layer-2:#fff;--archd-bg-overlay:#e9ecf2;
--archd-bg-interactive:#edf0f3;
--archd-border-l1:#0000000a;--archd-border-l2:#0000001a;--archd-brand-primary:#0f1115;
--archd-label-primary:#0f1115;--archd-label-secondary:#61666b;
--archd-state-error-primary:#cc1818;--archd-state-idle-primary:#61666b;--archd-state-success-primary:#137535;--archd-state-warn-primary:#f59e0b;
--archd-group-label:#0f1115;
color-scheme:light;`
const DARK = `
--archd-bg-base:#151517;--archd-bg-layer-1:#232324;--archd-bg-layer-2:#2c2c2e;--archd-bg-overlay:#232324;
--archd-bg-interactive:#2c2c2e;
--archd-border-l1:#ffffff0f;--archd-border-l2:#ffffff1f;--archd-brand-primary:#f9fafb;
--archd-label-primary:#f9fafb;--archd-label-secondary:#cfd3d6;
--archd-state-error-primary:#f76b6b;--archd-state-idle-primary:#a8adb3;--archd-state-success-primary:#22c55e;--archd-state-warn-primary:#f59e0b;
--archd-group-label:#0f1115;
color-scheme:dark;`
const SHELL_CSS = `
:root{${LIGHT}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
html,body,#archd-app{margin:0;height:100%;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
background:var(--archd-bg-base);color:var(--archd-label-primary)}
.archd-shell{display:flex;flex-direction:column;height:100%;min-height:0}
.archd-shell>.archd-root{position:relative;flex:1;height:auto;min-height:0}
.archd-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:7px 12px;
border-bottom:1px solid var(--archd-border-l1);font-size:12px}
.archd-header strong{font-size:13px;overflow-wrap:anywhere}
.archd-header-status{flex:1;color:var(--archd-label-secondary);overflow-wrap:anywhere}
.archd-header-live{display:inline-flex;align-items:center;gap:6px}
.archd-header-live::before{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:var(--archd-state-success-primary)}
`

function savedTheme() {
  const theme = readPreference(THEME_KEY)
  if (THEMES.includes(theme)) return theme
  return 'auto'
}

function mount() {
  const node = document.getElementById('archd-app')
  const source = document.getElementById('archd-data')
  if (!node || !source) throw new Error('Missing diagram container or JSON data')
  const data = JSON.parse(source.textContent)
  if (data.v !== 1 || !['embedded', 'remote'].includes(data.mode)) throw new Error('Unsupported diagram data')
  const chunks = window.__ARCHD__?.chunks
  if (!(chunks instanceof Map)) throw new Error('Missing diagram loader shim (window.__ARCHD__.chunks)')
  const loader = makeLoader(data, chunks)
  setLoader(loader)
  setIconLoader(loader)
  const lang = language(data)
  const t = translator(lang)
  document.documentElement.lang = lang
  document.title = data.name
  const initialTheme = savedTheme()
  document.documentElement.dataset.theme = initialTheme
  const style = document.createElement('style')
  style.textContent = SHELL_CSS + CSS
  document.head.appendChild(style)
  const Body = makeBody(makeIo(data))
  const date = new Date(data.generatedAt)
  const stamp = Number.isNaN(date.valueOf()) ? '' : date.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
  function Shell() {
    const [theme, setTheme] = useState(initialTheme)
    const [disconnected, setDisconnected] = useState(false)
    const cycleTheme = () => {
      const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
      document.documentElement.dataset.theme = next
      writePreference(THEME_KEY, next)
      setTheme(next)
    }
    return h(
      'div',
      { className: 'archd-shell' },
      h(
        'header',
        { className: 'archd-header' },
        h('strong', null, data.name),
        h(
          'span',
          { className: 'archd-header-status' + (data.mode === 'remote' && !disconnected ? ' archd-header-live' : ''), role: 'status' },
          t(data.mode === 'remote' ? disconnected ? 'header.disconnected' : 'header.live' : 'header.snapshot',
            { name: data.name, date: stamp }),
        ),
        h(
          'button',
          {
            className: 'archd-btn',
            type: 'button',
            title: t('header.theme'),
            'aria-label': t('header.themeValue', { value: t('theme.' + theme) }),
            onClick: cycleTheme,
          },
          t('header.themeValue', { value: t('theme.' + theme) }),
        ),
      ),
      h(Body, { t, onConnectionChange: setDisconnected }),
    )
  }
  createRoot(node).render(h(Shell))
}

mount()
