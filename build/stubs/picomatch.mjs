// Replaces picomatch: ProjectsManager compiles its default "**/node_modules/**"
// exclusion when the module loads; other patterns come only from project configs
// and editor settings, which the engine never has.
const DEFAULT_EXCLUDE = '**/node_modules/**'

/** Exactly the default pattern with { dot: true }: a path with a node_modules segment. */
export default function picomatch(pattern, options) {
  if (pattern !== DEFAULT_EXCLUDE || options?.dot !== true || Object.keys(options).length !== 1) {
    throw new Error(`picomatch(${JSON.stringify(pattern)}) is not available in dsh-diagram (stubbed at build time, see build/stubs)`)
  }
  return (path) => /(?:^|\/)node_modules(?:\/|$)/.test(path)
}
