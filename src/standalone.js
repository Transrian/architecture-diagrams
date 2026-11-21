// Standalone browser entry. Reuses the tab body without registering a DSH plugin.
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { en, fr, zh, standalone } from './copy.js'
import { CSS } from './style.js'
import { makeIo, setLoader } from './data.js'
import { setIconLoader } from './iconpack.js'
import { makeBody } from './body.js'
import { bySnapshotIndex } from './shared.js'

const SID = 'diagram'
const THEME_KEY = 'dsh-diagram.theme'
const THEMES = ['auto', 'light', 'dark']
const dictionaries = { en, fr, zh }

/**
 * cli/html.mjs installs this before any chunk executes:
 *   window.__DSHD__ = { chunks: new Map() }
 *   window.__ModuleLoader__.load({ chunk, factory }) stores factory(req) by chunk.
 * Chunk names have no ./ prefix; req throws for every dependency (chunks are self-contained).
 * The standalone entry owns asynchronous loading; the shim needs no callbacks or React.
 */
function makeLoader(data, chunks) {
  const pending = new Map()
  return {
    async(p) {
      const name = p.replace(/^\.\//, '')
      if (chunks.has(name)) return Promise.resolve(chunks.get(name))
      if (pending.has(name)) return pending.get(name)
      const shard = /^client\.icons-(\d{3})\.js$/.exec(name)
      if (name !== 'client.likec4.js' && !shard) return Promise.reject(new Error(`Unknown diagram chunk: ${name}`))
      if (data.mode === 'embedded') {
        if (!shard) return Promise.reject(new Error(`Missing embedded diagram chunk: ${name}`))
        const icons = { ...data.icons?.[Number(shard[1])] }
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

function notFound(p) {
  return Object.assign(new Error(`Diagram file not found: ${p}`), { code: 'workspace-file/not-found' })
}

/** The fixed virtual session and paths match data.js, including its history timeline. */
function makeRemote(data) {
  if (data.mode === 'remote') {
    const request = async (operation, p, signal) => {
      const response = await fetch(`/api/${operation}?p=${encodeURIComponent(p)}`, { signal, cache: 'no-store' })
      if (response.status === 404) throw notFound(p)
      if (!response.ok) throw new Error(`Cannot ${operation} diagram file (HTTP ${response.status})`)
      return response.json()
    }
    return { workspaceFiles: {
      stat: (_sid, p, signal) => request('stat', p, signal),
      read: (_sid, p, _options, signal) => request('read', p, signal),
      list: (_sid, p, signal) => request('list', p, signal),
    } }
  }
  const files = data.files ?? {}
  const has = (p) => !p.endsWith('.ref') && Object.hasOwn(files, p)
  return { workspaceFiles: {
    async stat(_sid, p, signal) {
      signal?.throwIfAborted()
      if (!has(p)) throw notFound(p)
      return { version: 1 }
    },
    async read(_sid, p, { offset = 1 } = {}, signal) {
      signal?.throwIfAborted()
      if (!has(p)) throw notFound(p)
      const source = files[p]
      const lines = source === '' ? [] : source.split('\n').slice(Math.max(0, offset - 1))
      return { text: lines.join('\n'), lines: lines.length, eof: true, version: 1 }
    },
    async list(_sid, p, signal) {
      signal?.throwIfAborted()
      const prefix = p.replace(/\/$/, '') + '/'
      const entries = Object.keys(files).filter((name) => has(name) && name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
        .sort(bySnapshotIndex).map((name) => ({ name: name.slice(prefix.length), type: 'file' }))
      return { entries }
    },
  } }
}

function language(data) {
  if (Object.hasOwn(dictionaries, data.lang)) return data.lang
  for (const tag of navigator.languages ?? [navigator.language]) {
    const prefix = String(tag).toLowerCase().split(/[-_]/)[0]
    if (Object.hasOwn(dictionaries, prefix)) return prefix
  }
  return 'en'
}

function translator(lang) {
  const fallback = { ...en, ...standalone.en }
  const dictionary = { ...dictionaries[lang], ...standalone[lang] }
  return (key, params) => {
    const template = dictionary[key] ?? fallback[key] ?? key
    // Same named-placeholder semantics as DSH's ctx.locale.bind.
    return params ? template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : template
  }
}

// DSH's alias palette, supplied locally rather than inherited from its shell.
const LIGHT = `
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-overlay:#e9ecf2;
--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;--dsw-alias-brand-primary:#0f1115;
--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#61666b;
--dsw-alias-state-error-primary:#ec1313;--dsw-alias-state-idle-primary:#d4d4d4;--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
color-scheme:light;`
const DARK = `
--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-layer-2:#2c2c2e;--dsw-alias-bg-overlay:#61666b;
--dsw-alias-border-l1:#ffffff0f;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-brand-primary:#f9fafb;
--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;
--dsw-alias-state-error-primary:#f25a5a;--dsw-alias-state-idle-primary:#545557;--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
color-scheme:dark;`
const SHELL_CSS = `
:root{${LIGHT}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
html,body,#dshd-app{margin:0;height:100%;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dshd-shell{display:flex;flex-direction:column;height:100%;min-height:0}
.dshd-shell>.dshd-root{position:relative;flex:1;height:auto;min-height:0}
.dshd-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.dshd-header strong{font-size:13px;overflow-wrap:anywhere}
.dshd-header-status{flex:1;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dshd-header-live{display:inline-flex;align-items:center;gap:6px}
.dshd-header-live::before{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
`

function savedTheme() {
  try {
    const theme = localStorage.getItem(THEME_KEY)
    if (THEMES.includes(theme)) return theme
  } catch {}
  return 'auto'
}

function mount() {
  const node = document.getElementById('dshd-app')
  const source = document.getElementById('dshd-data')
  if (!node || !source) throw new Error('Missing standalone diagram container or JSON data')
  const data = JSON.parse(source.textContent)
  if (data.v !== 1 || !['embedded', 'remote'].includes(data.mode)) throw new Error('Unsupported standalone diagram data')
  const chunks = window.__DSHD__?.chunks
  if (!(chunks instanceof Map)) throw new Error('Missing standalone diagram loader shim (window.__DSHD__.chunks)')
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
  style.setAttribute('data-dsh-diagram', 'standalone')
  style.textContent = SHELL_CSS + CSS
  document.head.appendChild(style)
  const Body = makeBody(makeIo(makeRemote(data)))
  const date = new Date(data.generatedAt)
  const stamp = Number.isNaN(date.valueOf()) ? '' : date.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
  function Shell() {
    const [theme, setTheme] = useState(initialTheme)
    const cycleTheme = () => {
      const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
      document.documentElement.dataset.theme = next
      try { localStorage.setItem(THEME_KEY, next) } catch {}
      setTheme(next)
    }
    return h('div', { className: 'dshd-shell' },
      h('header', { className: 'dshd-header' },
        h('strong', null, data.name),
        h('span', { className: 'dshd-header-status' + (data.mode === 'remote' ? ' dshd-header-live' : '') },
          t(data.mode === 'remote' ? 'standalone.live' : 'standalone.snapshot', { name: data.name, date: stamp })),
        h('button', { className: 'dshd-btn', type: 'button', title: t('standalone.theme'), 'aria-label': t('standalone.theme') + ': ' + t('theme.' + theme), onClick: cycleTheme },
          t('standalone.theme') + ': ' + t('theme.' + theme))),
      h(Body, { t, diagramSessionId: SID }))
  }
  createRoot(node).render(h(Shell))
}

mount()
