import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compute } from '../skills/architecture-diagrams/assets/engine.mjs'
import { buildTree } from '../src/viewer/zoom-tree.js'
import { assertSceneContracts } from './support/scene.mjs'

for (const file of ['test/fixtures/scopes.c4', 'examples/reference.c4', 'examples/web-shop.c4']) {
  for (const direction of ['TopBottom', 'LeftRight']) {
    test(`bounded scene contracts: ${file}/${direction}`, async t => {
      const source = await readFile(new URL('../' + file, import.meta.url), 'utf8')
      const base = await compute(source, { direction })
      assert.deepEqual(base.errors, [])
      assert.deepEqual(base.problems, [], 'corpus fixtures must pass the product lint, not just parse')
      const groups = Object.keys(base.viewOfElement).sort()
      const deepest = [...groups].sort((a, b) => b.split('.').length - a.split('.').length || a.localeCompare(b))[0]
      const chain = groups.filter(id => id === deepest || deepest.startsWith(id + '.'))
      const parentOf = id => id.split('.').slice(0, -1).join('.')
      const siblingSets = [...new Set(groups.filter(id => id.includes('.')).map(parentOf))]
        .map(parent => groups.filter(id => parentOf(id) === parent))
      const siblings = siblingSets.find(ids => ids.length >= 2)?.slice(0, 2)
      assert.equal(siblings?.length, 2, 'the fixture exercises two unfolded siblings')
      const expansions = [[], [groups[0]], chain, siblings, groups]
      let checked = 0
      for (const expand of expansions) {
        const scene = expand.length ? await compute(source, { direction, expand }) : base
        assert.deepEqual(scene.errors, [], `${file}: invalid expansion ${expand}`)
        const before = structuredClone(scene.views)
        for (const root of new Set(['index', ...scene.schemas.map(schema => schema.view)])) {
          checked += assertSceneContracts(buildTree(scene, root), scene)
        }
        assert.deepEqual(scene.views, before, 'tree and camera calculations must not mutate engine layouts')
      }
      assert.ok(checked > 0, 'the corpus exercised inherited views')
      t.diagnostic(`${expansions.length} expansion sets; ${checked} inherited views; three viewport sizes`)
    })
  }
}

test('scene oracle rejects missing links, moved boxes and dangling endpoints', async () => {
  const source = await readFile(new URL('./fixtures/scopes.c4', import.meta.url), 'utf8')
  const scene = await compute(source, { expand: ['shop.front', 'shop.core'] })
  assert.deepEqual(scene.errors, [])
  for (const damage of [
    entry => { entry.view.edges = [] },
    entry => { entry.view.nodes = entry.view.nodes.map((node, index) => index ? node : { ...node, x: node.x + 1 }) },
    entry => { entry.view.edges = entry.view.edges.map((edge, index) => index ? edge : { ...edge, source: 'missing' }) },
  ]) {
    const fixture = structuredClone(scene), tree = buildTree(fixture, 'index')
    const entry = tree.entries.get(scene.viewOfElement['shop.front'])
    assert.ok(entry.view.edges.length > 0)
    damage(entry)
    assert.throws(() => assertSceneContracts(tree, fixture), assert.AssertionError)
  }
})
