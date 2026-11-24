import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import ts from '../build/node_modules/typescript/lib/typescript.js'
import { testFiles } from './verify.mjs'

const FILE_LINES = 300
const FUNCTION_LINES = 80
const fileExceptions = new Set([
  'viewer/copy.js', // Parallel locale dictionaries are string data, not executable logic.
])
const root = new URL('../src/', import.meta.url)

async function sourceFiles(dir = root, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const groups = await Promise.all(
    entries.map((entry) => {
      const name = prefix + entry.name
      if (entry.isDirectory()) return sourceFiles(new URL(entry.name + '/', dir), name + '/')
      assert.ok(entry.isFile(), `Unexpected non-file in src/: ${name}`)
      return [name]
    }),
  )
  return groups.flat().sort()
}

function budgetProblems(name, source) {
  const problems = []
  const lines = source.replace(/\n$/, '').split('\n').length
  if (lines > FILE_LINES && !fileExceptions.has(name)) problems.push(`${name}: ${lines} lines (file limit ${FILE_LINES})`)
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(ast.parseDiagnostics.length, 0, `Budget parser must accept ${name}`)
  const lineOf = (position) => ast.getLineAndCharacterOfPosition(position).line + 1
  const visit = (node, functionDepth = 0) => {
    const callable = ts.isFunctionLike(node) && node.body
    if (callable && functionDepth === 0) {
      const start = lineOf(node.getStart(ast))
      const count = lineOf(node.end) - start + 1
      const label = node.name?.getText(ast) ?? node.parent.name?.getText(ast) ?? '<callback>'
      if (count > FUNCTION_LINES) problems.push(`${name}:${start}: ${label} is ${count} lines (function limit ${FUNCTION_LINES})`)
    }
    ts.forEachChild(node, (child) => visit(child, functionDepth + (callable ? 1 : 0)))
  }
  visit(ast)
  return problems
}

test('all src files and top-level functions stay within the maintenance budgets', async () => {
  const files = await sourceFiles()
  assert.ok(files.length > 0, 'The size budget must inspect source files')
  for (const exception of fileExceptions) assert.ok(files.includes(exception), `Stale budget exception: ${exception}`)
  const groups = await Promise.all(files.map(async (name) => budgetProblems(name, await readFile(new URL(name, root), 'utf8'))))
  assert.deepEqual(groups.flat(), [], 'Split oversized files/functions instead of adding budget exceptions')
})

test('source budgets accept their exact boundaries and reject one extra line', () => {
  assert.deepEqual(budgetProblems('sample.js', '// data\n'.repeat(FILE_LINES)), [])
  assert.match(budgetProblems('sample.js', '// data\n'.repeat(FILE_LINES + 1))[0], /301 lines/)
  const functionOf = (lines) => 'export function sample() {\n' + '  void 0\n'.repeat(lines - 2) + '}\n'
  assert.deepEqual(budgetProblems('sample.js', functionOf(FUNCTION_LINES)), [])
  assert.match(budgetProblems('sample.js', functionOf(FUNCTION_LINES + 1))[0], /sample is 81 lines/)
  assert.deepEqual(budgetProblems('viewer/copy.js', '// data\n'.repeat(FILE_LINES + 1)), [])
})

test('source budgets count arrow functions and cannot be confused by string braces', () => {
  const arrow = 'export const sample = () => {\n' + '  const value = "}"\n' + '  void 0\n'.repeat(78) + '}\n'
  assert.match(budgetProblems('sample.js', arrow)[0], /sample is 81 lines/)
})

test('source budgets always run in the core verification tier', () => {
  assert.ok(testFiles('core').includes('test/source-budget.test.mjs'))
})
