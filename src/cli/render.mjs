import { writeFile, rename, unlink, realpath } from 'node:fs/promises'
import path from 'node:path'
import { verdict, locations } from './verdict.mjs'
import { buildHtml, readHistory } from './html.mjs'
import { ensureIgnored } from './history.mjs'

/**
 * Validates `file` and, when valid (or `force`), writes its offline HTML page.
 * @returns {Promise<{report: object, output: string|null}>} output: the page written, if any.
 */
export async function render(file, { history = true, historyMax = 50, lang = null, output = null, force = false } = {}) {
  const report = await verdict(file, { history })
  if (report.code === 2 || (!report.ok && !force)) return { report, output: null }
  const { absolute, dir, historyDir } = locations(file)
  const target = path.resolve(output ?? absolute.replace(/\.c4$/i, '.html'))
  // Resolve directory aliases too: a symlinked output parent must not bypass
  // the source-overwrite guard. rename replaces an output symlink, not its target.
  const resolvedOutput = path.join(await realpath(path.dirname(target)), path.basename(target))
  const sourceEntry = path.join(await realpath(path.dirname(absolute)), path.basename(absolute))
  if (resolvedOutput === sourceEntry || resolvedOutput === await realpath(absolute)) throw new Error('The HTML output must not overwrite the source diagram')
  if (path.basename(dir) === '.diagram') await ensureIgnored(dir)
  const snapshots = await readHistory(historyDir, historyMax)
  const html = await buildHtml({ mode: 'embedded', name: path.basename(file, path.extname(file)), source: report.source, history: snapshots, lang })
  const temporary = `${target}.${process.pid}.tmp`
  // Both paths are absolute and known here. Only the newly-created temporary
  // file is removed if an atomic rename fails; an existing output stays intact.
  let created = false
  try {
    await writeFile(temporary, html, { flag: 'wx' })
    created = true
    await rename(temporary, target)
    created = false
  } finally { if (created) await unlink(temporary) }
  return { report, output: target }
}
