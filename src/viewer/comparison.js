// Resolve a display-only semantic-diff baseline from accepted snapshot sources.
// The displayed source/layout pair, not a pending timeline pick, is authoritative.

export async function resolveComparisonBase({ history = [], source, mode = 'previous', chosen } = {}, readSnapshot) {
  if (!['previous', 'first', 'chosen'].includes(mode)) throw new RangeError(`Unknown comparison mode: ${mode}`)
  if (history.length < 2 || !source) return { phase: 'no-history' }

  let name
  if (mode === 'first') name = history[0]
  else if (mode === 'chosen') {
    if (!history.includes(chosen)) return { phase: 'missing' }
    name = chosen
  } else if (source.pick != null) {
    const index = history.indexOf(source.pick)
    if (index < 0) return { phase: 'missing' }
    if (index === 0) return { phase: 'no-previous' }
    name = history[index - 1]
  } else {
    // A source can arrive before its accepted snapshot (or vice versa). Do not
    // manufacture a previous version until both describe the displayed text.
    const latest = await readSnapshot(history.at(-1))
    if (latest.trim() !== source.text.trim()) return { phase: 'waiting' }
    name = history.at(-2)
  }
  return { phase: 'ready', name, text: await readSnapshot(name) }
}
