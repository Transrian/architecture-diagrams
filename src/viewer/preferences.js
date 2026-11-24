// Browsers may deny storage on file:// or exhaust its quota; preferences remain session-local then.
function storageOperation(operation) {
  try {
    return operation(localStorage)
  } catch (error) {
    if (!['SecurityError', 'QuotaExceededError'].includes(error.name)) throw error
    console.warn('[diagram] Preferences could not be persisted:', error)
    return null
  }
}

export const readPreference = (key) => storageOperation((storage) => storage.getItem(key))
export const writePreference = (key, value) => storageOperation((storage) => storage.setItem(key, value))
