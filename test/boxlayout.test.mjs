// Box header and group footer layout: pure geometry, no React.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headerLayout, footerParts } from '../src/viewer/boxlayout.js'

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w

test('a pill never shares the header row with the kind label or the icon', () => {
  for (const w of [120, 160, 200, 260, 320]) {
    for (const [lid, person, icon] of [
      [false, false, false],
      [false, false, true],
      [false, true, false],
      [true, false, false],
      [true, false, true],
    ]) {
      for (const label of ['✓ done', '≠ deviation · new', '◷ planned · new · assumed', '‖ waiting for you · removed']) {
        for (const kindText of ['service', 'COMPOSANT', 'données', '组件']) {
          const head = headerLayout({ x: 0, y: 0, w, lid, person, icon, kindText, label })
          const pill = { x: head.pill.x, w: head.pill.width }
          assert.ok(pill.x + pill.w <= w, 'pill stays inside the box')
          if (icon) assert.ok(!overlap(pill, { x: head.icon.x, w: head.icon.size }), `icon ${w} ${label}`)
          if (person && !icon) assert.ok(pill.x >= 44, 'person glyph kept clear')
          if (head.kind) {
            const width = [...kindText].length * 15 * 0.74
            const kind = head.kind.anchor === 'middle' ? { x: head.kind.x - width / 2, w: width } : { x: head.kind.x, w: width }
            assert.ok(!overlap(pill, kind), `kind ${w} ${lid} ${label} ${kindText}`)
          }
        }
      }
    }
  }
})

test('without a pill the header keeps its usual places', () => {
  assert.deepEqual(headerLayout({ x: 0, y: 0, w: 200, icon: true, kindText: 'service', label: '' }), {
    icon: { x: 10, y: 8, size: 38 },
    kind: { x: 57, y: 32 },
    pill: null,
  })
  assert.equal(headerLayout({ x: 0, y: 0, w: 200, lid: true, icon: true, kindText: 'data', label: '' }).kind, null)
})

test('group footer: count, up to three chips by severity, ellipsis and assumed count', () => {
  const node = { hidden: 30, assumedCount: 2, rollup: { byState: { done: 6, doing: 3, planned: 3, deviation: 1, impacted: 1 } } }
  const wide = footerParts(node, 1000, false)
  assert.deepEqual(
    wide.map((part) => part.text),
    ['⊕ 30', '≠1', '↻3', '◷3', '…', '?2'],
    'vocabulary (severity) order, not frequency',
  )
  assert.deepEqual(
    footerParts({ hidden: 4, rollup: { byState: { impacted: 1 } } }, 1000, true).map((part) => part.text),
    ['↗ 4', '↔1'],
  )
  const narrow = footerParts(node, 120, false)
  assert.equal(narrow[0].text, '⊕ 30', 'the count always stays')
  assert.ok(narrow.length < wide.length, 'chips are dropped from the right')
  assert.deepEqual(
    footerParts(node, 10, false).map((part) => part.text),
    ['⊕ 30'],
  )
  for (const part of wide) assert.doesNotMatch(part.text, /^\+\d/)
})

test('severe states are never hidden behind the ellipsis while milder ones show', () => {
  const node = { hidden: 40, rollup: { byState: { done: 20, impacted: 9, planned: 5, waiting: 1, blocked: 1 } } }
  for (const width of [1000, 260, 200, 160, 120]) {
    const texts = footerParts(node, width, false).map((part) => part.text)
    const shown = texts.slice(1).filter((text) => text !== '…')
    // Whatever fits is a prefix of the severity order: blocked, waiting, planned, impacted, done.
    assert.deepEqual(shown, ['⊘1', '‖1', '◷5', '↔9', '✓20'].slice(0, shown.length), `width ${width}`)
  }
})

test('a clickable count chip takes its padding into the footer budget', () => {
  const node = { hidden: 7, rollup: { byState: { done: 3, doing: 2, planned: 2 } } }
  const plain = footerParts(node, 150, false, false)
  const chip = footerParts(node, 150, false, true)
  assert.equal(chip[0].chip, true)
  assert.ok(chip.length <= plain.length)
})
