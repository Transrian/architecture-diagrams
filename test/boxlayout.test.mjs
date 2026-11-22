// Box header and group footer layout: pure geometry, no React.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headerLayout, footerParts } from '../src/boxlayout.js'

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w

test('a pill never shares the header row with the kind label or the icon', () => {
  for (const w of [120, 160, 200, 260, 320]) {
    for (const [lid, person, icon] of [[false, false, false], [false, false, true], [false, true, false], [true, false, false], [true, false, true]]) {
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
  assert.deepEqual(headerLayout({ x: 0, y: 0, w: 200, icon: true, kindText: 'service', label: '' }), { icon: { x: 10, y: 8, size: 38 }, kind: { x: 57, y: 32 }, pill: null })
  assert.equal(headerLayout({ x: 0, y: 0, w: 200, lid: true, icon: true, kindText: 'data', label: '' }).kind, null)
})

test('group footer: count, up to three chips by frequency, ellipsis and assumed count', () => {
  const node = { hidden: 30, assumedCount: 2, rollup: { byState: { done: 6, doing: 3, planned: 3, deviation: 1, impacted: 1 } } }
  const wide = footerParts(node, 1000, false)
  assert.deepEqual(wide.map((part) => part.text), ['⊕ 30', '✓6', '↻3', '◷3', '…', '?2'], 'ties keep the vocabulary order')
  assert.deepEqual(footerParts({ hidden: 4, rollup: { byState: { impacted: 1 } } }, 1000, true).map((part) => part.text), ['↗ 4', '↔1'])
  const narrow = footerParts(node, 120, false)
  assert.equal(narrow[0].text, '⊕ 30', 'the count always stays')
  assert.ok(narrow.length < wide.length, 'chips are dropped from the right')
  assert.deepEqual(footerParts(node, 10, false).map((part) => part.text), ['⊕ 30'])
  for (const part of wide) assert.doesNotMatch(part.text, /^\+\d/)
})
