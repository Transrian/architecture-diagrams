// Typed arrows must keep diagnostics on the original statement, not a label match elsewhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourceIndex } from '../build/scanner.mjs'

const lineOf = (source, text) => source.split('\n').findIndex((line) => line.includes(text))

test('typed arrow source locations distinguish same endpoints/title by relation kind', () => {
  const source = `model {
  app = system 'App' {
    api = service 'API'
    db = data 'Records'
    api -> db 'same'
    api -[async]-> db 'same'
    api -[data]-> db 'same'
  }
}`
  const positions = sourceIndex(source)
  for (const [kind, arrow] of [[null, '->'], ['async', '-[async]->'], ['data', '-[data]->']]) {
    assert.equal(positions.relationLine({ source: 'app.api', target: 'app.db', title: 'same', kind }), lineOf(source, `api ${arrow} db 'same'`))
  }
})

test('typed arrow source locations resolve qualified refs, this and repeated short ids', () => {
  const source = `model {
  first = system 'First' {
    api = service 'API'
    db = data 'Records'
    api -[async]-> db 'sends'
  }
  second = system 'Second' {
    api = service 'API'
    db = data 'Records'
    api -[data]-> db 'sends'
    this -[data]-> api 'owns data'
  }
  first.api -[async]-> second.db 'cross schema'
}`
  const positions = sourceIndex(source)
  assert.equal(positions.relationLine({ source: 'first.api', target: 'first.db', title: 'sends', kind: 'async' }), 4)
  assert.equal(positions.relationLine({ source: 'second.api', target: 'second.db', title: 'sends', kind: 'data' }), 9)
  assert.equal(positions.relationLine({ source: 'second', target: 'second.api', title: 'owns data', kind: 'data' }), 10)
  assert.equal(positions.relationLine({ source: 'first.api', target: 'second.db', title: 'cross schema', kind: 'async' }), 12)
})

test('typed arrow scanning ignores comments, strings and relationship property blocks', () => {
  const source = String.raw`model {
  app = system 'App' {
    api = service 'API' {
      description "api -[async]-> db 'same'"
      metadata { proof "api -[data]-> db 'same'" }
    }
    db = data 'DB'
    // api -[async]-> db 'same'
    /* api -[data]-> db 'same' */
    api -[async]-> db {
      title 'same'
    }
    api -[data]-> db
      'quoted \' title'
  }
}`
  const positions = sourceIndex(source)
  assert.equal(positions.relationLine({ source: 'app.api', target: 'app.db', title: 'same', kind: 'async' }), 9)
  assert.equal(positions.relationLine({ source: 'app.api', target: 'app.db', title: "quoted ' title", kind: 'data' }), 12)
})

test('typed arrows split across lines report the start of the arrow', () => {
  const source = `model {
  app = system 'App' {
    left = system { api = service 'API' }
    right = system { db = data 'DB' }
    left.api -[
      /* arrow kind */ async
    ]-> right.db
      'sends'
  }
}`
  const positions = sourceIndex(source)
  assert.equal(positions.relationLine({ source: 'app.left.api', target: 'app.right.db', title: 'sends', kind: 'async' }), 4)
})
