import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

export function checkWhitespace(cwd) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (result.error) throw result.error
    // --no-index returns 1 for an ordinary difference even when --check is clean.
    const cleanNewFile = args.includes('--no-index') && result.status === 1 && !result.stdout && !result.stderr
    if (result.status !== 0 && !cleanNewFile)
      throw new Error(result.stdout + result.stderr || `git failed: ${result.signal ?? result.status}`)
    return result.stdout
  }
  git(['diff', '--check'])
  git(['diff', '--cached', '--check'])
  // Ordinary diff omits new files; do not stage them just to check whitespace.
  for (const file of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    git(['diff', '--no-index', '--check', '--', '/dev/null', file])
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  checkWhitespace(fileURLToPath(new URL('../../', import.meta.url)))
}
