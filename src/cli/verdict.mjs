import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { errorReport, refusalReport, okReport, adviceLines, iconLine, changeLine, lossLine, unlabeledLine } from './report.mjs'
import { snapshot, ensureIgnored, lastSnapshot } from './history.mjs'
import { diffModels } from '../core/diff.js'
import { ASSETS, buildHint } from './assets.mjs'

let engine
export async function loadEngine() {
  try {
    return await (engine ??= import(pathToFileURL(path.join(ASSETS, 'engine.mjs')).href))
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
    const { dir, historyDir } = locations(file)
    // Even `check` may read an existing baseline, but it must never write one.
    const last = await lastSnapshot(historyDir)
    const previousPath = last.last ? path.join(historyDir, last.last) : undefined
    let before
    if (previousPath) {
      let previousSource
      try { previousSource = await readFile(previousPath, 'utf8') } catch {}
      if (previousSource !== undefined && previousSource !== source) before = await eng.modelOf(previousSource)
    }
    const diff = before ? diffModels(before, result.model) : null
    let version
    if (history) {
      if (path.basename(dir) === '.diagram') await ensureIgnored(dir)
      version = await snapshot(historyDir, source)
    }
    return { ...common, ok: true, code: 0, version, text: okReport({
      result, version, icons: iconLine(result.icons),
      advice: adviceLines({ rel: file, advisories: result.advisories }),
      changes: changeLine(diff, { version: last.index }),
      warning: lossLine(diff, { snapshot: previousPath }),
      unlabeled: unlabeledLine(result.model),
    }) }
  } catch (error) {
    return { ok: false, code: 2, source, text: error.message }
  }
}
