// The same engine and verdicts as DSH, without depending on a running host.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { errorReport, refusalReport, okReport, iconLine } from '../report.js'
import { snapshot, ensureIgnored } from '../history.js'

export const buildHint = 'run "cd build && node build.mjs" first'
let engine
export async function loadEngine() {
  try {
    return await (engine ??= import('../lib/likec4.mjs'))
  } catch (error) {
    engine = undefined
    throw new Error(`Cannot load the diagram engine; ${buildHint}`, { cause: error })
  }
}

export function locations(file) {
  const absolute = path.resolve(file)
  return { absolute, dir: path.dirname(absolute), historyDir: absolute.replace(/\.c4$/i, '') }
}

export async function verdict(file, { history = true } = {}) {
  let source
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    return { ok: false, code: 2, text: `cannot read ${file}: ${error.message}` }
  }
  try {
    const eng = await loadEngine()
    const result = await eng.compute(source)
    const errors = result.errors
    const common = { result, source }
    if (errors.length) return { ...common, ok: false, code: 1, text: errorReport({ rel: file, errors, maxErrors: 8 }) }
    if (result.problems.length) return { ...common, ok: false, code: 1, text: refusalReport({ rel: file, problems: result.problems, rules: eng.RULES, maxErrors: 8 }) }
    let version
    if (history) {
      const { dir, historyDir } = locations(file)
      if (path.basename(dir) === '.diagram') await ensureIgnored(dir)
      version = await snapshot(historyDir, source)
    }
    return { ...common, ok: true, code: 0, version, text: okReport({ result, version, icons: iconLine(result.icons), shown: '', link: null }) }
  } catch (error) {
    return { ok: false, code: 2, source, text: error.message }
  }
}
