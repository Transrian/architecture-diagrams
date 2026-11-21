/** File history shared by the DSH host and the standalone CLI. */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/** Written into the diagram directory so it ignores itself in any git repository. */
export const GITIGNORE = '# Created by dsh-diagram: conversation diagrams stay out of git.\n*\n'

/** Diagram directories whose `.gitignore` has already been checked. */
const ignored = new Set()

/** Only call for a diagram directory, never for an arbitrary source parent. */
export async function ensureIgnored(dir) {
  if (ignored.has(dir)) return
  const file = path.join(dir, '.gitignore')
  try {
    await stat(file)
  } catch {
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(file, GITIGNORE, { flag: 'wx' })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  ignored.add(dir)
}

export async function lastSnapshot(dir) {
  let names
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.c4')).sort()
  } catch {
    return { count: 0 }
  }
  if (names.length === 0) return { count: 0 }
  const last = names[names.length - 1]
  return { count: names.length, last, index: Number.parseInt(last, 10) || names.length }
}

export async function differsFromLastSnapshot(dir, source) {
  const last = await lastSnapshot(dir)
  if (last.count === 0) return true
  try {
    return (await readFile(path.join(dir, last.last), 'utf8')) !== source
  } catch {
    return true
  }
}

export async function snapshot(dir, source) {
  const last = await lastSnapshot(dir)
  if (last.count > 0) {
    try {
      if ((await readFile(path.join(dir, last.last), 'utf8')) === source) return last.index
    } catch {}
  }
  const index = (last.index ?? 0) + 1
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${String(index).padStart(4, '0')}-${stamp}.c4`), source)
  return index
}
