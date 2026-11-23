// Replaces @likec4/config (and through it zod and json5): the engine loads only
// prelude.c4 and diagram.c4, never a likec4.config.json, so no project config
// is ever parsed, validated or registered (createFromSources, ProjectsManager).
import { unavailable } from './unavailable.mjs'

// Same file names and test as @likec4/config: createFromSources asks it about every source name.
const JSON_CONFIGS = ['.likec4rc', '.likec4.config.json', 'likec4.config.json']
const basename = (path) => {
  let end = path.length
  while (end > 0 && (path[end - 1] === '/' || path[end - 1] === '\\')) end--
  const trimmed = path.slice(0, end)
  const parts = trimmed.split('/').flatMap((part) => part.split('\\'))
  return parts[parts.length - 1] || trimmed
}
export function isLikeC4JsonConfig(path) {
  return JSON_CONFIGS.includes(basename(path))
}

export const LikeC4ProjectConfigOps = {
  parse: unavailable('LikeC4ProjectConfigOps.parse'),
  validate: unavailable('LikeC4ProjectConfigOps.validate'),
  normalizeInclude: unavailable('LikeC4ProjectConfigOps.normalizeInclude'),
}
