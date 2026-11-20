// Plugin entry: registers the "Diagram" right-sidebar tab. Bundled by
// build/build.mjs into ../client.js (module-loader format) — edit src/, not client.js.
import { createElement, useEffect } from 'react'
import { en, fr } from './copy.js'
import { CSS } from './style.js'
import { makeIo, setLoader } from './data.js'
import { makeBody } from './body.js'
import { DiagramIcon, DiagramTitle } from './icons.js'

const ID = 'dsh-diagram'
const KIND = 'diagram'
const NS = 'dshDiagram'

// The module loader's require, in scope of the generated factory.
// eslint-disable-next-line no-undef
setLoader(require)

export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

/** `<workspace>/.diagram/<session>.c4` or one of its snapshots, as a resource address. */
function isDiagramAddress(address) {
  try {
    return /\/\.diagram\/(?:[^/]+\/)?[^/]+\.c4$/i.test(decodeURIComponent(new URL(address).pathname))
  } catch {
    return false
  }
}

/**
 * A tab opened from a link to the diagram file carries that file's address.
 * Hand over to the one Diagram page instead (revealed if open, else it takes
 * this tab's place), the way DSH's guide hands over to the page it opens.
 */
function withLinkRedirect(Body) {
  function Redirect({ actions }) {
    useEffect(() => {
      actions.openTab(KIND, { replaceTab: true })
      actions.close()
    }, [actions])
    return null
  }
  return function DiagramTab(props) {
    const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
    const contentId = info?.tab?.contentId
    if (typeof contentId === 'string' && contentId.startsWith('dsh-resource://') && info.tab.actions) {
      return createElement(Redirect, { actions: info.tab.actions })
    }
    return createElement(Body, props)
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: en, en, ja: en, es: en, fr, de: en, ru: en, pt: en }), 'dsh-diagram: copy')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-dsh-diagram', '')
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-diagram: styles')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    keepMounted: true,
    // Links to a diagram file (in a message, a delivery card…) open this tab
    // instead of the text preview. `*.c4` matches the basename; `canOpen`
    // keeps only files under the diagram directory.
    patterns: ['*.c4'],
    canOpen: isDiagramAddress,
    title: () => t('type.label'),
    guide: [{
      id: 'diagram',
      order: 15,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: DiagramIcon,
    }],
  }), 'dsh-diagram: tab type')
  const io = makeIo(ctx.remote)
  const Body = withLinkRedirect(makeBody(io))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
    locale: NS,
    inject: (sessionId) => ({ diagramSessionId: sessionId }),
  }, Body)), 'dsh-diagram: body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: ID,
    locale: NS,
  }, DiagramTitle)), 'dsh-diagram: title')
}
