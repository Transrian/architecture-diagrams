// Automatic icons: matching rules on the generated pack. Needs the built
// engine and pack: run `cd build && node build.mjs` first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compute } from '../skills/dsh-diagram/assets/engine.mjs'
import { matchLabel, resolveIcons, iconIndexFor } from '../src/engine/iconmatch.js'
import { iconKey, shardOf, shardFile, SHARDS } from '../src/core/iconrules.js'
import { iconLine } from '../src/cli/report.mjs'
import { clean } from '../build/icons.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const assets = path.join(root, 'skills/dsh-diagram/assets')
const index = JSON.parse(readFileSync(path.join(root, 'build/generated/icon-index.json'), 'utf8'))
const generic = new Set(index.generic)
const tech = (s, vendors = []) => matchLabel(s, index, { field: 'technology', vendors, generic })
const title = (s, vendors = []) => matchLabel(s, index, { field: 'title', vendors, generic })

/** The SVG entry of an icon, read from its shard the way the browser gets it. */
function shardEntry(id) {
  return shardData(readFileSync(path.join(assets, shardFile(shardOf(id))), 'utf8'))[id]
}
function shardData(text) {
  return JSON.parse(text.slice(text.indexOf('module.exports = ') + 17, text.lastIndexOf(';\n\treturn module.exports')))
}

test('SVG sanitation removes event handlers in every attribute form', () => {
  for (const value of ['"run(1)"', "'run(1)'", 'run(1)']) {
    const input = `<path OnLoAd = ${value} fill="red" onpointerenter=${value}/>`
    const output = clean(input, 'test')
    assert.equal(output, '<path fill="red"/>', value)
  }
  assert.equal(clean('<g\nonclick\t=\t\'run()\' data-note="kept"><path onerror=run() /></g>', 'test'), '<g data-note="kept"><path/></g>')
})

test('SVG sanitation tokenizes quoted attributes without mutilating their values', () => {
  assert.equal(
    clean('<path data-x="a onload=x" data-onload="kept" onclick="run()"/>', 'test'),
    '<path data-x="a onload=x" data-onload="kept"/>',
  )
  assert.equal(
    clean(`<path data-x='a " > onload=x' fill=red onerror=run()/>`, 'test'),
    '<path data-x="a &quot; &gt; onload=x" fill="red"/>',
  )
  assert.equal(clean('<path data-x="a  b onload=run()" fill="blue"/>', 'test'), '<path data-x="a  b onload=run()" fill="blue"/>')
  assert.equal(clean('<path fill="red" onclick=\'unterminated/><circle onload=run()/>', 'test'), '')
  assert.equal(clean('<path onclick=bad" data-x="v">', 'test'), '')
  assert.equal(clean('</svg><image src="https://example.invalid/a.png" onerror=run()>', 'test'), '<image></image>')
})

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='

test('SVG sanitation only allows fragment hrefs and genuine raster data images', () => {
  const unsafe = [
    '  JaVaScRiPt:run() ',
    '&#106;avascript:run()',
    '&#x6a;ava&#x09;script:run()',
    'javascript&colon;run()',
    'vbscript:run()',
    'https://example.invalid/a.svg',
    '//example.invalid/a.svg',
    '/a.svg',
    'a.svg#shape',
    'file:///a.svg',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9InJ1bigpIi8+',
    'data:text/html,unsafe',
    'data:image/png;base64,PHN2ZyBvbmxvYWQ9InJ1bigpIi8+',
    'data:image/png;base64,invalid',
  ]
  for (const attribute of ['href', 'xlink:href', 'XLINK:HREF']) {
    for (const value of unsafe)
      for (const quote of ['"', "'", '']) {
        assert.equal(clean(`<use ${attribute}=${quote}${value}${quote}/>`, 'test'), '<use/>', `${attribute}: ${value} (${quote})`)
      }
  }
  assert.equal(
    clean('<use href="#shape"/><use xlink:href=\'&#35;safe\'/><a href="https://example.invalid/icon"/>', 'test'),
    '<use href="#shape"/><use xlink:href="#safe"/><a/>',
  )
  assert.equal(clean(`<image href="${PNG}"/>`, 'test'), `<image href="${PNG}"/>`)
  assert.equal(clean('<g xml:base="https://example.invalid/"><use href="#shape"/></g>', 'test'), '<g><use href="#shape"/></g>')
})

test('SVG sanitation removes animations including mutations of href', () => {
  const output = clean(
    `<image href="${PNG}"><set attributeName="href" to="javascript:run()"/>
    <animate attributeName="xlink:href" values="#safe;javascript:run()"/></image>
    <animateTransform attributeName="transform"><set attributeName="href" to="https://example.invalid/a"/></animateTransform>
    <animateMotion/><discard/><path fill="red"/>`,
    'test',
  )
  assert.doesNotMatch(output, /animate|<set\b|<discard\b|javascript:|example\.invalid/i)
  assert.match(output, /<path fill="red"\/>/)
  assert.ok(output.includes(PNG))
})

test('SVG sanitation prevents external CSS loads in attributes and style elements', () => {
  for (const value of [
    'url(https://example.invalid/a)',
    "url('//example.invalid/a')",
    'u\\72l(https://example.invalid/a)',
    'url(&#104;ttps://example.invalid/a)',
    'url(javascript:run())',
    'url(data:image/svg+xml;base64,PHN2Zy8+)',
  ]) {
    assert.equal(clean(`<path fill="${value}"/>`, 'test'), '<path/>', value)
    assert.equal(clean(`<path style="fill:${value};stroke:red"/>`, 'test'), '<path/>', value)
    assert.equal(clean(`<style>.logo{fill:${value}}</style><path class="logo"/>`, 'test'), '<path class="test-logo"/>', value)
  }
  for (const css of [
    "@import 'https://example.invalid/a.css';.logo{fill:red}",
    '.logo{background-image:image-set("https://example.invalid/a" 1x)}',
  ]) {
    assert.equal(clean(`<style>${css}</style><path class="logo"/>`, 'test'), '<path class="test-logo"/>')
  }
  assert.doesNotThrow(() => clean('<path style="fill:\\ffffff"/>', 'test'))
})

test('SVG sanitation preserves quoted and bare local gradient ids with parentheses', () => {
  for (const value of [
    'url(#Public-IP-Addresses-(Classic))',
    "url('#Public-IP-Addresses-(Classic)')",
    'url("#Public-IP-Addresses-(Classic)")',
  ]) {
    const encoded = value.replace(/"/g, '&quot;')
    const output = clean(
      `<defs><linearGradient id='Public-IP-Addresses-(Classic)'/></defs>
      <style>.logo{fill:${value}}</style><path class='logo' fill="${encoded}"/>
      <use href='#Public-IP-Addresses-(Classic)'/>`,
      'test',
    )
    assert.match(output, /id="test-Public-IP-Addresses-\(Classic\)"/)
    assert.match(output, /fill="url\(&quot;#test-Public-IP-Addresses-\(Classic\)&quot;\)"/)
    assert.ok(output.includes('.test-logo{fill:url("#test-Public-IP-Addresses-(Classic)")}'))
    assert.match(output, /href="#test-Public-IP-Addresses-\(Classic\)"/)
  }
})

test('SVG sanitation preserves apostrophes in local ids without leaking CSS quotes', () => {
  const output = clean(`<defs><linearGradient id="Ren'Py"/></defs><path fill="url(#Ren'Py)"/><use href="#Ren'Py"/>`, 'test')
  assert.ok(output.includes(`fill="url(&quot;#test-Ren'Py&quot;)"`))
  assert.ok(output.includes(`href="#test-Ren'Py"`))
})

test('SVG sanitation keeps gradients and class scoping while removing active markup', () => {
  const output = clean(
    `<!-- ignored -->
    <script>run()</script><foreignObject><div>unsafe</div></foreignObject>
    <defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient><path id="shape"/></defs>
    <style>.logo {fill:url(#paint)} path {stroke:red}</style>
    <path class="logo" fill="url(#paint)" onclick='run()'/><use href="#shape"/>`,
    'test',
  )
  assert.doesNotMatch(output, /script|foreignObject|onclick|<!--/i)
  assert.match(output, /id="test-paint"/)
  assert.match(output, /fill="url\(#test-paint\)"/)
  assert.match(output, /href="#test-shape"/)
  assert.match(output, /class="test-logo"/)
  assert.match(output, /\.test-logo\s*\{/)
  assert.doesNotMatch(output, /path \{stroke/)
})

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

test('every packed SVG is static and cannot load external resources', () => {
  const files = readdirSync(assets).filter((f) => /^icons-\d+\.js$/.test(f))
  assert.equal(files.length, SHARDS)
  let count = 0
  const local = /^(?:#[^\s"<>`\\]+|data:image\/(?:png|gif|jpe?g|webp);base64,[a-z\d+/]+={0,2})$/i
  const decode = (s) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(x[\da-f]+|\d+);?/gi, (_, n) => {
        const value = n[0].toLowerCase() === 'x' ? Number.parseInt(n.slice(1), 16) : Number(n)
        return value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd'
      })
      .replace(/&amp;/g, '&')
  for (const file of files) {
    const icons = shardData(readFileSync(path.join(assets, file), 'utf8'))
    for (const [id, [, svg]] of Object.entries(icons)) {
      count++
      assert.doesNotMatch(svg, /<(?:script|foreignObject|animate[\w-]*|set|discard)\b|@import\b/i, id)
      // Match entire quoted values first, so onload-looking text inside data-* is inert.
      for (const a of svg.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        assert.doesNotMatch(a[1], /^(?:.*:)?on/i, `${id}: ${a[1]}`)
        if (/(?:^|:)(?:href|src)$/i.test(a[1])) assert.match(decode(a[2] ?? a[3] ?? a[4]), local, `${id}: ${a[1]}`)
      }
      // Audit URL targets without crossing an attribute boundary when an old
      // upstream icon has an incomplete (inert) url(#fragment expression.
      for (const url of decode(svg).matchAll(/\burl\s*\(\s*["']?([^"'()\s<>]+)/gi)) {
        assert.match(url[1], local, `${id}: ${url[0]}`)
      }
    }
  }
  assert.ok(count > 0, 'all shards contain icons to audit')
})

test('every icon the engine can name is in a shard, as valid SVG parts', () => {
  const files = readdirSync(assets).filter((f) => /^icons-\d+\.js$/.test(f))
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

test('a title never resolves to an Object.prototype member', () => {
  for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    for (const id of [title(word), tech(word), title(word, ['aws']), tech(`${word} ${word}`)]) {
      assert.ok(id === null || typeof id === 'string', `${word} → ${typeof id}`)
    }
  }
})

test('the reduced icon index resolves exactly the same icons, and only those entries', async () => {
  const labels = [
    'PostgreSQL',
    'Apache Kafka',
    'Kafka, Avro',
    'Python / FastAPI',
    'Lambda',
    'Functions',
    'S3',
    'Big Query',
    'Inferentia2',
    'OAuth2',
    'React',
    'Redis cache',
    'main.py',
    'README.md',
    'Dockerfile',
    'queue',
    'DNS',
    'edge',
    'docs',
    'Constructor',
    'toString',
    'Node 20',
    'nginx 1.25',
    'Cosmos DB',
    'Key Vault',
    'Cloud Run',
    'Pub/Sub',
    'analytics',
  ]
  const leaf = (label, i) =>
    `      e${i} = service '${label}' {\n        technology '${label}'\n      }\n      t${i} = component '${label}'`
  const synthetic = ['aws', 'azure', 'gcp', 'misc'].map(
    (vendor) =>
      `// diagram v1\nmodel {\n  ${vendor} = system '${vendor.toUpperCase()}' {\n` +
      `    g = system 'Group' {\n${labels.slice(0, 7).map(leaf).join('\n')}\n    }\n` +
      `    h = system 'More' {\n${labels.slice(7, 14).map(leaf).join('\n')}\n    }\n` +
      `    k = system 'Rest' {\n${labels.slice(14, 21).map(leaf).join('\n')}\n    }\n` +
      `    m = system 'Last' {\n${labels.slice(21).map(leaf).join('\n')}\n    }\n  }\n}\n`,
  )
  const sources = [...['examples/reference.c4', 'examples/web-shop.c4'].map((f) => readFileSync(path.join(root, f), 'utf8')), ...synthetic]
  const models = []
  for (const source of sources) {
    const result = await compute(source)
    assert.deepEqual(result.errors, [], source.slice(0, 80))
    models.push(result.model)
  }
  const reduced = iconIndexFor(models, index)
  for (const model of models) assert.deepEqual(resolveIcons(model, reduced), resolveIcons(model, index))
  assert.deepEqual(iconIndexFor(models, reduced), reduced, 'reducing twice changes nothing')
  assert.ok(JSON.stringify(reduced).length < JSON.stringify(index).length / 50)
  assert.ok(Object.keys(reduced.brand).length > 10)
})

test('the offline-HTML engine ships without the index and accepts one', () => {
  const lean = readFileSync(path.join(assets, 'engine-offline.js'), 'utf8')
  const full = readFileSync(path.join(assets, 'engine.js'), 'utf8')
  assert.ok(full.length - lean.length > 300_000, `${full.length - lean.length} bytes saved`)
  assert.ok(lean.startsWith('window.__DSHD__.define("engine.js", '))
  assert.match(lean, /setIconIndex/)
})
