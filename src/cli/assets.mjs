import path from 'node:path'
import { fileURLToPath } from 'node:url'

// build/build.mjs rewrites this path when it bundles the CLI into the skill,
// whose script sits in skills/architecture-diagrams/scripts/.
export const SKILL_DIR = fileURLToPath(new URL('../../skills/architecture-diagrams/', import.meta.url))
export const ASSETS = path.join(SKILL_DIR, 'assets')
export const buildHint = 'run "cd build && node build.mjs" first'
