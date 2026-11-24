import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readPreference, writePreference } from '../src/viewer/preferences.js'

function installStorage(t, descriptor) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  })
}

test('preferences read and write only the requested key', (t) => {
  const values = new Map()
  installStorage(t, { value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } })
  assert.equal(readPreference('direction'), null)
  writePreference('direction', 'TopBottom')
  assert.equal(readPreference('direction'), 'TopBottom')
  assert.equal(readPreference('legend'), null)
})

test('preferences report denied file-origin access and return an unset preference', (t) => {
  const error = new DOMException('Denied', 'SecurityError')
  installStorage(t, { get: () => { throw error } })
  const warning = t.mock.method(console, 'warn', () => {})
  assert.equal(readPreference('direction'), null)
  assert.equal(writePreference('direction', 'TopBottom'), null)
  assert.equal(warning.mock.callCount(), 2)
  assert.equal(warning.mock.calls[0].arguments[1], error)
})

test('preferences report quota exhaustion', (t) => {
  const quota = new DOMException('Full', 'QuotaExceededError')
  installStorage(t, { value: { setItem: () => { throw quota } } })
  const warning = t.mock.method(console, 'warn', () => {})
  assert.equal(writePreference('legend', 'open'), null)
  assert.equal(warning.mock.callCount(), 1)
})

test('preferences propagate unexpected failures', (t) => {
  const bug = new Error('Unexpected storage failure')
  installStorage(t, { value: { getItem: () => { throw bug } } })
  assert.throws(() => readPreference('legend'), (error) => error === bug)
})
