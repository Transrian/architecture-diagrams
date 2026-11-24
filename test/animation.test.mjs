import { test } from 'node:test'
import assert from 'node:assert/strict'
import { animate, reducedMotion, frameProgress } from '../src/viewer/animation.js'

function frames(t, start = 0) {
  const queued = []
  const previous = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (callback) => { queued.push(callback); return queued.length }
  t.after(() => {
    if (previous === undefined) delete globalThis.requestAnimationFrame
    else globalThis.requestAnimationFrame = previous
  })
  t.mock.method(performance, 'now', () => start)
  return (now) => { assert.ok(queued.length); queued.shift()(now) }
}

test('shared animation schedules frames and ends exactly once', (t) => {
  const tick = frames(t)
  const token = {}
  const s = { fly: token }
  const progress = []
  let ended = 0
  animate(s, token, 100, (p) => progress.push(p), () => { ended++; s.fly = null })
  tick(25)
  tick(50)
  tick(100)
  assert.deepEqual(progress, [0.25, 0.5])
  assert.equal(ended, 1)
})

test('a queued frame predating the animation start cannot extrapolate geometry', (t) => {
  const tick = frames(t, 2000), token = {}, progress = []
  const s = { fly: token }
  let ended = 0
  animate(s, token, 100, p => progress.push(p), () => { ended++; s.fly = null })
  for (const now of [0, 1500, 2000, 2050, 2100]) tick(now)
  assert.deepEqual(progress, [0, 0, 0, 0.5])
  assert.equal(ended, 1)
})

test('flight, arrival and release progress stays inside both endpoints, including reduced motion', () => {
  assert.equal(frameProgress(2000, 0, 300), 0)
  assert.equal(frameProgress(2000, 2000, 300), 0)
  assert.equal(frameProgress(2000, 2150, 300), 0.5)
  assert.equal(frameProgress(2000, 2400, 300), 1)
  assert.equal(frameProgress(2000, 0, 0), 1)
})

test('input cancellation and zero-duration reduced-motion animations share token handling', (t) => {
  const tick = frames(t)
  const token = {}
  const s = { morph: token }
  let calls = 0
  animate(s, token, 100, () => calls++, () => calls++)
  s.morph = null
  tick(50)
  assert.equal(calls, 0)
  s.fly = token
  animate(s, token, 0, () => assert.fail('zero-duration animations must not interpolate'), () => calls++)
  tick(50)
  assert.equal(calls, 1)
})

test('scoped-context fades keep running during wheel input but cancel when replaced', (t) => {
  const tick = frames(t), token = {}, progress = []
  const s = { contextFade: token, fly: null }
  animate(s, token, 100, (p) => progress.push(p), () => { s.contextFade = null })
  tick(25)
  s.fly = null
  tick(50)
  assert.deepEqual(progress, [0.25, 0.5])
  s.contextFade = null
  tick(75)
  assert.deepEqual(progress, [0.25, 0.5])
})

test('reduced motion tolerates a browser without matchMedia', (t) => {
  const previous = globalThis.window
  t.after(() => {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  })
  globalThis.window = {}
  assert.equal(reducedMotion(), false)
  globalThis.window.matchMedia = () => ({ matches: true })
  assert.equal(reducedMotion(), true)
})
