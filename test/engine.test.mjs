// Engine behavior and source positions. Needs the built engine, like host.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as engine from '../lib/likec4.mjs'
import { scan, sourceIndex, orientationPoints } from '../build/scanner.mjs'

test('parallel dynamic steps preserve their causal stage ids', async () => {
  const source = `// diagram v1
model { app = system 'App' { a = service 'A' b = service 'B' c = service 'C' } }
views { dynamic view flow {
  app.a -> app.b 'start'
  parallel {
    app.b -> app.a 'reply'
    app.b -> app.c 'notify'
  }
  app.c -> app.a 'finish'
} }`
  const result = await engine.compute(source)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.views.find((view) => view.id === 'flow').edges.map((edge) => edge.id), ['step-01', 'step-02:par.01', 'step-02:par.02', 'step-03'])
})

const lineContaining = (source, text) => source.split('\n').findIndex((line) => line.includes(text))
const viewIcons = (result) => new Set(result.views.flatMap((view) => view.nodes.map((node) => node.icon)).filter(Boolean))
const databaseModel = () => ({
  order: ['a', 'a.db', 'b', 'b.db'],
  elements: Object.fromEntries(['a', 'a.db', 'b', 'b.db'].map((id) => [id, {
    id, kind: id.includes('.') ? 'data' : 'system', parent: id.includes('.') ? id[0] : null,
    depth: id.split('.').length, children: id.includes('.') ? [] : [id + '.db'],
    title: id === 'b.db' ? 'x'.repeat(40) : id, description: '', technology: '',
  }])),
  relations: {},
})

test('scanner ignores quoted braces, escaped quotes and both comment forms', () => {
  const source = String.raw`// model { fake = system 'Ignore' }
model {
  root = system "Quoted \\" {
    description 'brace } and \\'
    // } fake = system { view fake { autoLayout LeftRight }
    /* } fake = system { */
    leaf = service 'Leaf // { }'
  }
}`
  const tokens = scan(source)
  const opens = tokens.filter((token) => token.type === 'symbol' && token.value === '{')
  assert.equal(opens.length, 2)
  for (const token of opens) {
    assert.ok(Number.isInteger(token.close))
    assert.equal(tokens[token.close].value, '}')
    assert.equal(source.slice(token.start, token.end), '{')
  }
  const leaf = tokens.find((token) => token.value === 'leaf')
  assert.equal(leaf.line, 6)
  assert.equal(leaf.parent, tokens.indexOf(opens[1]))
  assert.equal(tokens.some((token) => token.value === 'fake'), false)
})

test('scanner resolves repeated short ids by their complete declaration path', () => {
  const source = `// diagram v1
model {
  a = system 'A' {
    db = data 'Short'
  }
  b = system 'B' {
    db = data 'A very long title for the second database only'
  }
}`
  const positions = sourceIndex(source)
  assert.equal(positions.lineOf('a.db'), 3)
  assert.equal(positions.lineOf('b.db'), 6)
  assert.equal(positions.lineOf('missing.db'), 3, 'best-effort short-name fallback')
  assert.equal(positions.lineOf('missing'), 0)
  const problems = engine.lint(databaseModel(), [], source)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].element, 'b.db')
  assert.equal(problems[0].line, 6, 'reported as :7 in a human-facing verdict')
})

test('scanner follows multiline positional strings with assignment and kind-first declarations', () => {
  for (const kindFirst of [false, true]) {
    const declaration = (id, kind) => kindFirst ? `${kind} ${id}` : `${id} = ${kind}`
    const source = `// diagram v1
model {
  ${declaration('a', 'system')} 'A' 'Short description' 'Go' {
    ${declaration('db', 'data')} 'Short'
  }
  ${declaration('b', 'system')}
    'B'
    "Quoted { db = data 'not an element' }"
    // The opening brace follows all positional strings.
    'Go'
  {
    ${declaration('db', 'data')}
      'A deliberately long second database title'
  }
}`
    const positions = sourceIndex(source)
    assert.equal(positions.lineOf('a.db'), 3)
    assert.equal(positions.lineOf('b.db'), 11)
    const problems = engine.lint(databaseModel(), [], source)
    assert.deepEqual(problems.map(({ element, line }) => ({ element, line })), [{ element: 'b.db', line: 11 }], kindFirst ? 'kind first' : 'assignment')
  }
})

test('scanner supports mixed declaration styles and keeps the declaration start line', () => {
  const source = `model {
  system a 'A' 'Description' 'Go' {
    db = data 'First'
  }
  b = system 'B' 'Description' 'Go' {
    data
      db 'Second'
  }
}`
  const positions = sourceIndex(source)
  assert.equal(positions.lineOf('a.db'), 2)
  assert.equal(positions.lineOf('b.db'), 5)
  assert.equal(positions.lineOf('missing.db'), 2)
  assert.deepEqual(engine.lint(databaseModel(), [], source).map((problem) => problem.line), [5])
})

test('scanner does not confuse nested metadata, quoted declarations or prefix ids', () => {
  const source = String.raw`// diagram v1
model {
  // root = system { child = system { db = data 'Wrong' } }
  root_extra = system 'Other' { child = system { db = data 'Other' } }
  root = system 'Root { }' {
    description "child = system { db = data 'Not a declaration' } //"
    metadata {
      note 'child = system { db = data "Ignore" }'
    }
    sibling = system { db = data 'Sibling' }
    child = system 'Child' {
      description 'An escaped quote \' and a brace }'
      db = data 'Correct'
    }
  }
}`
  const positions = sourceIndex(source)
  assert.equal(positions.lineOf('root.child.db'), lineContaining(source, "db = data 'Correct'"))
  assert.equal(positions.lineOf('root.sibling.db'), lineContaining(source, "db = data 'Sibling'"))
  assert.equal(positions.lineOf('root_extra.child.db'), lineContaining(source, 'root_extra ='))
})

test('relation lines match endpoints and labels, not the first occurrence of text', () => {
  const label = 'A deliberately long shared relation label'
  const source = `// diagram v1
model {
  a = system 'A' {
    from = service 'From'
    to = service 'To'
    description '${label}'
    from -> to '${label}'
  }
  b = system 'B' {
    from = service 'From'
    to = service 'To'
    // from -> to '${label}'
    from -> to "${label}" { #done }
  }
  a.from -> b.to '${label}'
}`
  const positions = sourceIndex(source)
  assert.equal(positions.relationLine({ source: 'a.from', target: 'a.to', title: label }), 6)
  assert.equal(positions.relationLine({ source: 'b.from', target: 'b.to', title: label }), 12)
  assert.equal(positions.relationLine({ source: 'a.from', target: 'b.to', title: label }), 14)
  const relations = Object.fromEntries(['a', 'b'].map((id) => [id, { source: id + '.from', target: id + '.to', title: label }]))
  const problems = engine.lint({ order: [], relations }, [], source)
  assert.deepEqual(problems.map((problem) => problem.line), [6, 12])
})

test('relation scanner follows qualified refs, multiline labels and escaped quotes', () => {
  const source = String.raw`model {
  root = system {
    left = system { leaf = service 'Left' }
    right = service 'Right'
    left.leaf -> right
      'Sends \'quoted\' content'
    this -> left.leaf { title "Root sends \"quoted\" content" }
  }
}`
  const positions = sourceIndex(source)
  assert.equal(positions.relationLine({ source: 'root.left.leaf', target: 'root.right', title: "Sends 'quoted' content" }), 4)
  assert.equal(positions.relationLine({ source: 'root', target: 'root.left.leaf', title: 'Root sends "quoted" content' }), 6)
})

test('orient uses real view blocks and ignores autoLayout in comments and strings', () => {
  const source = String.raw`model {
  root = system 'Root' {
    description 'Text that looks like a view:
      view phantom { autoLayout LeftRight }
    '
  }
}
views {
  view first of root {
    title 'autoLayout and braces } {'
    // autoLayout LeftRight }
    /* autoLayout LeftRight } */
    include *
  }
  dynamic view steps {
    root -> root 'An escaped quote \' and a brace }' { #done }
  }
  view fixed {
    include *
    autoLayout LeftRight
  }
}`
  assert.equal(orientationPoints(source).length, 2)
  const oriented = engine.orient(source, 'BottomTop')
  assert.equal(oriented.split('\n').length, source.split('\n').length)
  assert.equal((oriented.match(/autoLayout BottomTop/g) ?? []).length, 2)
  assert.ok(oriented.includes("view phantom { autoLayout LeftRight }"))
  assert.ok(oriented.includes('autoLayout LeftRight\n  }'))
  assert.equal(engine.orient(oriented, 'RightLeft'), oriented, 'existing directions win')
  assert.equal(engine.orient('views { view incomplete { include *', 'BottomTop'), 'views { view incomplete { include *')
})

test('generated view ids avoid static and dynamic user ids, including numbered collisions', async () => {
  for (const dynamic of [false, true]) {
    const source = `// diagram v1
model {
  shop = system 'Shop' {
    zone = system 'Zone' { api = service 'API' }
  }
}
views {
  ${dynamic ? "dynamic view diagram_shop { shop.zone.api -> shop.zone.api 'calls' }" : 'view diagram_shop { include * }'}
  view diagram_shop_2 { include * }
}`
    const result = await engine.compute(source)
    assert.deepEqual(result.errors, [], dynamic ? 'dynamic' : 'static')
    assert.deepEqual(result.problems, [])
    assert.equal(result.viewOfElement.shop, 'diagram_shop_3')
    assert.ok(result.views.some((view) => view.id === 'diagram_shop_3' && view.viewOf === 'shop'))
    assert.deepEqual(new Set(result.extras.map((view) => view.view)), new Set(['diagram_shop', 'diagram_shop_2']))
    assert.equal(new Set(result.views.map((view) => view.id)).size, result.views.length)
    for (const id of ['diagram_shop', 'diagram_shop_2']) {
      assert.ok(result.views.find((view) => view.id === id).nodes.every((node) => node.unfold === false), `${id} remains user-controlled`)
    }
  }
})

test('a user-scoped diagram_ view is never classified as generated', async () => {
  const source = `// diagram v1
model {
  shop = system 'Shop' {
    zone = system 'Zone' { api = service 'API' }
  }
}
views {
  view diagram_shop of shop { include * }
}`
  const result = await engine.compute(source)
  assert.deepEqual(result.errors, [])
  assert.equal(result.viewOfElement.shop, 'diagram_shop')
  const userView = result.views.find((view) => view.id === 'diagram_shop')
  assert.ok(userView.nodes.some((node) => node.id === 'shop.zone'))
  assert.ok(userView.nodes.every((node) => node.unfold === false))
})

test('only real index declarations suppress the generated unfolded overview', async () => {
  const source = `// diagram v1
/*
  view index { include * }
*/
model {
  shop = system 'Shop' {
    description 'Quoted view text:
      view index { include * }
    '
    zone = system 'Zone' { api = service 'API' }
  }
}`
  assert.equal(sourceIndex(source).viewIds.has('index'), false)
  const unfolded = await engine.compute(source, { expand: ['shop'] })
  assert.deepEqual(unfolded.errors, [])
  const index = unfolded.views.find((view) => view.id === 'index')
  assert.ok(index.nodes.some((node) => node.id === 'shop.zone'))
  assert.equal(index.nodes.find((node) => node.id === 'shop').unfold, true)

  const explicitSource = source + '\nviews { view index { include shop } }'
  assert.equal(sourceIndex(explicitSource).viewIds.has('index'), true)
  const explicit = await engine.compute(explicitSource, { expand: ['shop'] })
  assert.deepEqual(explicit.errors, [])
  const ownIndex = explicit.views.find((view) => view.id === 'index')
  assert.deepEqual(ownIndex.nodes.map((node) => node.id), ['shop'])
  assert.equal(ownIndex.nodes[0].unfold, false)
})

test('iconIds agrees with model and rendered views for both reference diagrams', async () => {
  for (const file of ['reference', 'web-shop']) {
    const source = readFileSync(new URL(`../examples/${file}.c4`, import.meta.url), 'utf8')
    const ids = await engine.iconIds(source)
    const result = await engine.compute(source)
    assert.deepEqual(result.errors, [], file)
    assert.ok(ids.size > 0)
    assert.deepEqual(ids, new Set(Object.values(result.model.icons).map((icon) => icon.icon).filter(Boolean)), file + ' model')
    assert.deepEqual(ids, viewIcons(result), file + ' views')
    ids.clear()
    assert.ok((await engine.iconIds(source)).size > 0, 'callers cannot mutate the cached set')
  }
})

test('iconIds handles duplicates, explicit none, legacy headers and invalid diagrams', async () => {
  const source = `// diagram v1
model {
  root = system 'Sample' {
    one = service 'API one' { icon tech:grafana }
    two = service 'API two' { icon tech:grafana }
    off = service 'PostgreSQL' { icon none }
  }
}`
  const ids = await engine.iconIds(source)
  assert.equal([...ids].filter((id) => id === 'tech:grafana').length, 1)
  assert.equal(ids.has(null), false)
  const result = await engine.compute(source, { expand: ['root'] })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(ids, viewIcons(result))
  assert.deepEqual(await engine.iconIds(source.replace('// diagram v1', '// carte v2')), ids)
  for (const invalid of ['', source.replace('// diagram v1', '// diagram v999'), '// diagram v1\nmodel { root = unknown \'Broken\' }', '// diagram v1\nmodel {']) {
    assert.deepEqual(await engine.iconIds(invalid), new Set())
    const first = await engine.compute(invalid)
    assert.ok(first.errors.length > 0)
    assert.ok(first.errors.every((error) => error.file === 'diagram.c4' || error.file === ''))
    assert.deepEqual((await engine.compute(invalid)).errors, first.errors)
  }
})


test('relation targets named after kinds do not consume the next declaration', async () => {
  for (const target of ['data', 'b.data']) {
    const source = `// diagram v1
model {
  a = system 'A' {
    inner = service 'Short'
  }
  data = system 'Data' {
    api = service 'API'
  }
  b = system 'B' {
    data = service 'Data target'
    x = service 'X'
    x -> ${target}
    db = data 'DB' {
      inner = service 'A very long title for the inner service here'
    }
  }
}`
    const expected = lineContaining(source, "inner = service 'A very long")
    assert.equal(sourceIndex(source).lineOf('b.db.inner'), expected, target)
    const result = await engine.compute(source)
    assert.deepEqual(result.errors, [])
    assert.equal(result.problems.find((p) => p.element === 'b.db.inner').line, expected, target)
  }
  const multiline = "model { system\n root 'Root' { data\n db 'DB' } }"
  assert.equal(sourceIndex(multiline).lineOf('root.db'), 1, 'multiline kind-first declarations remain supported')
})
