// Automatic icons: matching rules on the generated pack. Needs the built
// engine and pack: run `cd build && node build.mjs` first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compute } from '../lib/likec4.mjs'
import { matchLabel } from '../src/iconmatch.js'
import { iconKey, shardOf, shardFile, SHARDS } from '../src/iconrules.js'
import { iconLine } from '../index.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const index = JSON.parse(readFileSync(path.join(root, 'build/generated/icon-index.json'), 'utf8'))
const generic = new Set(index.generic)
const tech = (s, vendors = []) => matchLabel(s, index, { field: 'technology', vendors, generic })
const title = (s, vendors = []) => matchLabel(s, index, { field: 'title', vendors, generic })

/** The SVG entry of an icon, read from its shard the way the browser gets it. */
function shardEntry(id) {
  const text = readFileSync(path.join(root, shardFile(shardOf(id))), 'utf8')
  const data = JSON.parse(text.slice(text.indexOf('module.exports = ') + 17, text.lastIndexOf(';\n\t\treturn')))
  return data[id]
}

test('keys ignore case, accents and punctuation', () => {
  assert.equal(iconKey('Node.js'), 'nodejs')
  assert.equal(iconKey('C++'), 'cplusplus')
  assert.equal(iconKey('Élastic'), 'elastic')
})

test('technology names resolve to product icons', () => {
  assert.equal(tech('PostgreSQL 16'), 'tech:postgresql')
  assert.equal(tech('Postgres'), 'tech:postgresql')
  assert.equal(tech('Kafka, Avro'), tech('Apache Kafka'))
  assert.ok(tech('Snowflake'))
  assert.ok(tech('Databricks'))
  assert.ok(tech('vLLM'))
  assert.ok(tech('Proxmox VE'))
  assert.equal(tech('k8s'), 'tech:kubernetes')
  assert.equal(tech('Frobnicator 3'), null)
})

test('cloud services need their vendor, except unambiguous names', () => {
  assert.equal(tech('Functions'), null)
  assert.equal(tech('Functions', ['azure']), 'azure:function-apps')
  assert.equal(title('Lambda resize', ['aws']), 'aws:lambda')
  assert.equal(title('Kafka', ['aws']), 'aws:managed-streaming-for-apache-kafka')
  assert.equal(tech('Apache Kafka', ['aws']), tech('Apache Kafka'), 'the product name escapes the vendor service')
  assert.equal(tech('EKS'), 'aws:elastic-kubernetes-service')
  assert.equal(title('S3 bucket'), 'aws:simple-storage-service')
})

test('titles match strictly: a common word is a product only as the whole title', () => {
  assert.equal(title('Orders API'), null)
  assert.equal(title('Box storage'), null)
  assert.equal(title('Spark jobs'), null)
  assert.ok(title('Spark'))
  assert.equal(title('Kubernetes cluster'), 'tech:kubernetes')
  assert.equal(title('VM'), null)
})

test('every element gets an explicit, product, file, word or kind icon', async () => {
  const r = await compute(`// diagram v1
model {
  cloud = system 'AWS' {
    fn = service 'Lambda resize'
    q = data 'Orders queue' {
      technology 'SQS'
    }
    off = service 'Kafka' {
      icon none
    }
    forced = service 'Dashboards' {
      icon tech:grafana
    }
    ui = component 'Cart.tsx'
    job = service 'Ordonnanceur'
    foo = service 'Foo' {
      technology 'Frobnicator 3'
    }
  }
  user = person 'Customer'
}
`)
  assert.deepEqual(r.errors, [])
  const how = Object.fromEntries(Object.entries(r.model.icons).map(([id, v]) => [id, `${v.how} ${v.icon}`]))
  assert.equal(how['cloud.fn'], 'title aws:lambda')
  assert.equal(how['cloud.q'], 'technology aws:simple-queue-service')
  assert.equal(how['cloud.off'], 'none null')
  assert.equal(how['cloud.forced'], 'explicit tech:grafana')
  assert.equal(how['cloud.ui'], 'file tech:react')
  assert.equal(how['cloud.job'], 'word bootstrap:clock-history')
  assert.equal(how['cloud.foo'], 'kind bootstrap:gear')
  assert.equal(how.user, 'none null')
  const node = r.views.find((v) => v.nodes.some((n) => n.id === 'cloud.q')).nodes.find((n) => n.id === 'cloud.q')
  assert.equal(node.icon, 'aws:simple-queue-service')
  assert.match(iconLine(r.icons), /'Frobnicator 3' \(cloud\.foo\)/)
})

test('every icon the engine can name is in a shard, as valid SVG parts', () => {
  const files = readdirSync(root).filter((f) => /^client\.icons-\d+\.js$/.test(f))
  assert.equal(files.length, SHARDS)
  const ids = new Set([...Object.values(index.brand), ...Object.values(index.vendor).flatMap((m) => Object.values(m))])
  for (const id of ['bootstrap:database', 'bootstrap:gear', 'tech:grafana', 'aws:lambda']) ids.add(id)
  for (const id of ids) {
    const e = shardEntry(id)
    assert.ok(e, `missing ${id}`)
    assert.match(e[0], /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/, `${id} viewBox`)
    assert.ok(!/<script|\son\w+=/i.test(e[1]), `${id} carries script`)
  }
})
