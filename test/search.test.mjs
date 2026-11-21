// Pure search/reveal contracts plus the real reference's parsed model (no layout needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeSearch, searchElements, viewForElement } from '../src/navigation.js'
import { modelOf } from '../lib/likec4.mjs'

function modelOfElements(entries) {
  const elements = Object.fromEntries(entries.map(([id, title, fields = {}]) => [id, {
    id, title, kind: 'service', parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null,
    children: [], technology: '', description: '', ...fields,
  }]))
  for (const element of Object.values(elements)) elements[element.parent]?.children.push(element.id)
  return { elements }
}
const model = modelOfElements([
  ['shop', 'Boutique', { kind: 'system' }],
  ['shop.east', 'East', { kind: 'system' }],
  ['shop.east.api', 'Résumé API', { state: 'done', technology: 'PostgreSQL 16', description: 'Historique des commandes' }],
  ['shop.west', 'West', { kind: 'system' }],
  ['shop.west.api', 'Résumé API', { state: 'doing', technology: 'Go', description: 'Paiements à crédit' }],
  ['shop.loader', 'Summary loader', { technology: 'Kafka Connect', description: 'Loads résumé records' }],
  ['shop.delivery', '配送状态组件', { description: '包裹跟踪事件' }],
  ['shop.report', 'API overview', { description: 'Résumé des services' }],
])
const ids = (results) => results.map((result) => result.id)

test('search normalization is accent/case insensitive, Unicode-safe and punctuation tolerant', () => {
  assert.equal(normalizeSearch('  CAFÉ—Résumé.API / v2  '), 'cafe resume api v2')
  assert.equal(normalizeSearch('Cafe\u0301'), 'cafe')
  assert.equal(normalizeSearch('ﬀ ＡＰＩ'), 'ff api', 'NFKD compatibility forms')
  assert.equal(normalizeSearch('配送状态组件'), '配送状态组件')
  assert.equal(normalizeSearch('--- . /'), '')
  assert.equal(normalizeSearch(undefined), '')
})

test('search returns exact ids, state and full title breadcrumb for repeated titles', () => {
  assert.deepEqual(searchElements(model, 'RESUME api'), [
    { id: 'shop.east.api', title: 'Résumé API', state: 'done', path: 'Boutique › East › Résumé API' },
    { id: 'shop.west.api', title: 'Résumé API', state: 'doing', path: 'Boutique › West › Résumé API' },
    { id: 'shop.report', title: 'API overview', state: undefined, path: 'Boutique › API overview' },
  ])
  assert.deepEqual(ids(searchElements(model, 'shop.west.api')), ['shop.west.api'])
})

test('search matches technology, description and partial CJK without matching metadata', () => {
  assert.deepEqual(ids(searchElements(model, 'POSTGRES')), ['shop.east.api'])
  assert.deepEqual(ids(searchElements(model, 'CREDIT')), ['shop.west.api'])
  assert.deepEqual(ids(searchElements(model, '配送状')), ['shop.delivery'])
  assert.deepEqual(ids(searchElements(model, '包裹')), ['shop.delivery'])
  const withMetadata = modelOfElements([['app', 'App', { metadata: { proof: 'private searchable needle' } }]])
  assert.deepEqual(searchElements(withMetadata, 'needle'), [])
})

test('all query terms must match but may span searchable fields', () => {
  assert.deepEqual(ids(searchElements(model, 'postgres commandes')), ['shop.east.api'])
  assert.deepEqual(ids(searchElements(model, 'resume kafka')), ['shop.loader'])
  assert.deepEqual(ids(searchElements(model, 'shop WEST credit')), ['shop.west.api'])
  assert.deepEqual(searchElements(model, 'postgres kafka'), [])
  assert.deepEqual(searchElements(model, 'missing'), [])
})

test('relevance ranks exact titles, ids, prefixes, substrings, technologies and descriptions', () => {
  const model = modelOfElements([
    ['app.f', 'Agent', { description: 'Uses the target' }],
    ['app.e', 'Processor', { technology: 'Target engine' }],
    ['app.d', 'The target worker'],
    ['app.c', 'Target gateway'],
    ['app.target', 'Service'],
    ['app.a', 'Target'],
  ])
  assert.deepEqual(ids(searchElements(model, 'target')), ['app.a', 'app.target', 'app.c', 'app.d', 'app.e', 'app.f'])
  assert.equal(searchElements(model, 'app.target')[0].id, 'app.target', 'exact qualified id is a first-class match')
  const reverse = { elements: Object.fromEntries(Object.entries(model.elements).reverse()) }
  assert.deepEqual(searchElements(reverse, 'target'), searchElements(model, 'target'), 'model insertion order does not affect relevance')
})

test('equal relevance uses stable FQN ordering rather than locale or model order', () => {
  const model = modelOfElements([['b.api', 'API'], ['a.api', 'API'], ['c.api', 'API']])
  assert.deepEqual(ids(searchElements(model, 'api')), ['a.api', 'b.api', 'c.api'])
})

test('search always caps at twelve, supports smaller limits and ignores empty queries', () => {
  const model = modelOfElements(Array.from({ length: 20 }, (_, index) => [`app.n${String(index).padStart(2, '0')}`, 'Node']))
  assert.equal(searchElements(model, 'node').length, 12)
  assert.equal(searchElements(model, 'node', 100).length, 12)
  assert.equal(searchElements(model, 'node', Infinity).length, 12)
  assert.equal(searchElements(model, 'node', 4).length, 4)
  assert.equal(searchElements(model, 'node', 1.9).length, 1)
  assert.deepEqual(searchElements(model, 'node', 0), [])
  assert.deepEqual(searchElements(model, 'node', -1), [])
  for (const query of ['', '  ', '---', null, undefined]) assert.deepEqual(searchElements(model, query), [])
  assert.deepEqual(searchElements(null, 'node'), [])
})

test('search does not mutate the parsed model or its source fields', () => {
  const before = structuredClone(model)
  searchElements(model, 'resume')
  searchElements(model, '配送')
  assert.deepEqual(model, before)
})

test('viewForElement maps groups, leaves and root people/externals without guessing absent scopes', () => {
  const model = modelOfElements([
    ['customer', 'Customer', { kind: 'person' }],
    ['carrier', 'Carrier', { kind: 'external' }],
    ['shop', 'Shop', { kind: 'system' }],
    ['shop.checkout', 'Checkout', { kind: 'system' }],
    ['shop.checkout.api', 'API'],
    ['orphan', 'Unscoped service'],
  ])
  const result = { model, viewOfElement: { shop: 'diagram_shop', 'shop.checkout': 'diagram_shop__checkout' } }
  assert.equal(viewForElement(result, 'shop'), 'diagram_shop')
  assert.equal(viewForElement(result, 'shop.checkout'), 'diagram_shop__checkout')
  assert.equal(viewForElement(result, 'shop.checkout.api'), 'diagram_shop__checkout')
  assert.equal(viewForElement(result, 'customer'), 'index')
  assert.equal(viewForElement(result, 'carrier'), 'index')
  assert.equal(viewForElement(result, 'orphan'), null)
  assert.equal(viewForElement(result, 'missing'), null)
  assert.equal(viewForElement(null, 'shop'), null)
  assert.equal(viewForElement({ model }, 'shop.checkout'), null, 'a group without its own view is not silently sent to its parent')
  assert.equal(viewForElement({ model }, 'shop.checkout.api'), null)
})

test('reference search finds Cosmos by title/id, its full path/state and generated view scope', async () => {
  const model = await modelOf(readFileSync(new URL('../examples/reference.c4', import.meta.url), 'utf8'))
  assert.ok(model)
  const before = structuredClone(model)
  const results = searchElements(model, 'COSMOS')
  assert.deepEqual(ids(results), ['azure.prod.tracking.vnet.data.cosmos'])
  assert.equal(results[0].title, 'Cosmos DB')
  assert.equal(results[0].state, 'deviation')
  assert.equal(results[0].path, 'Azure › sub-contoso-prod › rg-tracking › vnet-tracking › snet-data › Cosmos DB')
  assert.equal(searchElements(model, 'kubernetes')[0].id, 'azure.prod.tracking.vnet.app.aks')
  assert.equal(searchElements(model, 'etapes')[0].id, 'ops.docs.backlog')
  assert.equal(searchElements(model, 'depot north')[0].id, 'ops.depots.north')
  assert.equal(searchElements(model, '配送状态')[0].id, 'azure.prod.web.swa.status')
  const result = { model, viewOfElement: {
    azure: 'diagram_azure',
    'azure.prod.tracking.vnet.data': 'diagram_azure__prod__tracking__vnet__data',
  } }
  assert.equal(viewForElement(result, 'azure'), 'diagram_azure')
  assert.equal(viewForElement(result, results[0].id), 'diagram_azure__prod__tracking__vnet__data')
  assert.equal(viewForElement(result, 'customer'), 'index')
  assert.equal(viewForElement(result, 'carriers'), 'index')
  assert.deepEqual(model, before)
})
