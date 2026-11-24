// One workspace per active computation, at most one retained when idle.
import { createLanguageServices } from '@likec4/language-server/browser'
import { UriUtils } from 'langium'
import { rootLogger } from '@likec4/log'
import { createFromSources } from '../../build/node_modules/@likec4/language-services/dist/common/createFromSources.mjs'
// Parser construction is expensive. Concurrent loads borrow separate workspaces;
// retain one idle workspace, resetting documents/indexes and bounding its layout cache.
let idle
export async function load(files) {
  let session = idle
  idle = null
  if (!session) {
    const services = createLanguageServices()
    const instance = await createFromSources(services, rootLogger.getChild('lang'), files, { printErrors: false, throwIfInvalid: false })
    session = { services, instance, files: Object.keys(files), uses: 1 }
  } else {
    try {
      const workspace = session.services.shared.workspace
      await workspace.DocumentBuilder.update(
        [],
        session.files.map((name) => UriUtils.joinPath(session.instance.workspaceURI, name)),
      )
      if (++session.uses > 16) {
        workspace.WorkspaceManager.forceCleanCaches()
        session.uses = 1
      }
      const documents = Object.entries(files).map(([name, text]) =>
        workspace.LangiumDocuments.createDocument(UriUtils.joinPath(session.instance.workspaceURI, name), text),
      )
      await workspace.DocumentBuilder.build(documents, { validation: true })
      session.files = Object.keys(files)
    } catch (error) {
      await session.instance.dispose()
      throw error
    }
  }
  let released = false
  return {
    getErrors: () => session.instance.getErrors(),
    computedModel: () => session.instance.computedModel(),
    async diagrams() {
      // LikeC4 returns cached layouts first; decoration must not mutate that cache.
      const views = JSON.parse(JSON.stringify(await session.instance.diagrams()))
      return views.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    },
    async dispose() {
      if (released) throw new Error('Language services already released')
      released = true
      if (idle) await session.instance.dispose()
      else idle = session
    },
  }
}

export function collectErrors(l) {
  const errors = []
  const seen = new Set()
  for (const e of l.getErrors()) {
    const file = String(e.sourceFsPath ?? '').replace(/^.*[\\/]/, '')
    // The fixed prelude is an engine implementation detail, not user diagnostics.
    if (file !== 'diagram.c4' && file !== '') continue
    const message = String(e.message ?? '').replace(/\s+/g, ' ').trim()
    const item = {
      message: message.length > 300 ? message.slice(0, 300) + '…' : message,
      line: e.line,
      character: (e.range?.start?.character ?? 0) + 1,
      file,
    }
    const key = item.line + ':' + item.message
    if (seen.has(key)) continue
    seen.add(key)
    errors.push(item)
  }
  return errors
}
