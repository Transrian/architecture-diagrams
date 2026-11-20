// Usage: node check.mjs <diagram.c4>  — same verdict the dsh-diagram host would append.
import { compute, RULES } from './lib/likec4.mjs'
import { readFileSync } from 'node:fs'
const f = process.argv[2]
const r = await compute(readFileSync(f, 'utf8'))
const errors = r.errors.filter((e) => e.file === 'diagram.c4' || e.file === '')
if (errors.length) { console.log('[diagram] does not parse:'); for (const e of errors.slice(0, 8)) console.log(`  ${f}:${e.line + 1}:${e.character}  ${e.message}`); process.exit(1) }
if (r.problems.length) { console.log('[diagram] refused (too heavy to read):'); for (const p of r.problems.slice(0, 8)) console.log(`  ${f}:${p.line + 1}  ${p.message}`); process.exit(1) }
const byId = new Map(r.views.map((v) => [v.id, v]))
console.log(`[diagram] valid: ${r.schemas.map((s) => `${s.title} (${byId.get(s.view)?.nodes.length} boxes)`).join(', ')}; ${Object.keys(r.viewOfElement).length} group views; ${Object.keys(r.model.elements).length} elements`)
