import { fileURLToPath } from 'node:url'

// build/build.mjs rewrites this path when it bundles the CLI into the skill,
// whose script sits beside its assets: skills/dsh-diagram/{scripts,assets}.
export const ASSETS = fileURLToPath(new URL('../../skills/dsh-diagram/assets/', import.meta.url))
export const buildHint = 'run "cd build && node build.mjs" first'
