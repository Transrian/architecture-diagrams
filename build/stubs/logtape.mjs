// Replaces @logtape/logtape under @likec4/log: the engine silences every LikeC4
// logger (quiet() in src/engine/entry.mjs), so records are never formatted or
// written; loggers here drop them and configuration is accepted and ignored.
import { unavailable } from './unavailable.mjs'

const noop = () => {}
function logger(category, parent) {
  const self = {
    category,
    parent,
    getChild: (sub) => logger([...category, ...(Array.isArray(sub) ? sub : [sub])], self),
    with: () => self,
    trace: noop, debug: noop, info: noop, warn: noop, warning: noop, error: noop, fatal: noop,
    emit: noop,
    isEnabledFor: () => false,
  }
  return Object.freeze(self)
}
export const getLogger = (category = []) => logger(Array.isArray(category) ? [...category] : [category], null)

export const configureSync = noop
// Called while configuring (getConsoleSink() in @likec4/log); what they return never runs.
export const getConsoleSink = () => unavailable('logtape console sink')
export const getTextFormatter = () => unavailable('logtape text formatter')
export const getAnsiColorFormatter = () => unavailable('logtape ANSI formatter')
export const defaultConsoleFormatter = unavailable('logtape console formatter')
export const withFilter = unavailable('logtape withFilter')
