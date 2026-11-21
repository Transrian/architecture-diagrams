// Compatibility wrapper: validate without creating history or other files.
import { verdict } from './cli/verdict.mjs'
if (!process.argv[2]) {
  console.error('Usage: node check.mjs <file.c4>')
  process.exitCode = 2
} else {
  const report = await verdict(process.argv[2], { history: false })
  console.log(report.text)
  process.exitCode = report.code
}
