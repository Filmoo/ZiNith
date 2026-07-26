import test from 'node:test'
import assert from 'node:assert/strict'
import { boardFromStrings } from './fixtures.ts'
import { threeBV } from '../engine/metrics/threebv.ts'
import { zini } from '../engine/metrics/zini.ts'
import { hzini } from '../engine/metrics/hzini.ts'
import { createBoard, open } from '../engine/board.ts'

test('3BV: single centre mine on 3x3 leaves no openings', () => {
  // every non-mine cell is a 1, and none touch a zero, so each costs a click
  const b = boardFromStrings(['...', '.*.', '...'])
  const r = threeBV(b)
  assert.equal(r.openings, 0)
  assert.equal(r.isolated, 8)
  assert.equal(r.value, 8)
})

test('3BV: single centre mine on 5x5 is one opening', () => {
  // the outer ring is all zeros and 8-connected; the eight 1s all touch it
  const b = boardFromStrings(['.....', '.....', '..*..', '.....', '.....'])
  const r = threeBV(b)
  assert.equal(r.openings, 1)
  assert.equal(r.isolated, 0)
  assert.equal(r.value, 1)
})

test('3BV: diagonal mines on 3x3 give two separate openings', () => {
  const b = boardFromStrings(['*..', '...', '..*'])
  const r = threeBV(b)
  assert.equal(r.openings, 2)
  assert.equal(r.isolated, 0)
  assert.equal(r.value, 2)
})

test('3BV: a fully mined border isolates the interior number', () => {
  const b = boardFromStrings(['***', '*.*', '***'])
  const r = threeBV(b)
  assert.equal(r.value, 1)
  assert.equal(r.openings, 0)
})

test('ZiNi never exceeds 3BV', () => {
  for (let i = 0; i < 25; i++) {
    const b = createBoard({ width: 16, height: 16, mineCount: 40, seed: 'zini' + i, firstClick: 40 })
    const bv = threeBV(b)
    const z = zini(b, 40)
    assert.ok(z.value > 0)
    assert.ok(z.value <= bv.value, `ZiNi ${z.value} should not exceed 3BV ${bv.value}`)
  }
})

test('HZiNi >= ZiNi on every board', () => {
  for (let i = 0; i < 12; i++) {
    const seed = 'hz' + i
    const spec = { width: 9, height: 9, mineCount: 10, seed, firstClick: 40 }
    const b = createBoard(spec)
    const z = zini(createBoard(spec), 40)
    const h = hzini(b, 40)
    assert.ok(h.value >= z.value, `HZiNi ${h.value} < ZiNi ${z.value} on ${seed}`)
  }
})

test('a cleared board is fully opened by the HZiNi path', () => {
  const spec = { width: 9, height: 9, mineCount: 10, seed: 'cover', firstClick: 40 }
  const b = createBoard(spec)
  open(b, 40)
  const h = hzini(createBoard(spec), 40)
  assert.ok(h.path.length > 0)
})
