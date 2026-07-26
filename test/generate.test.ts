import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard, open, isWon } from '../engine/board.ts'
import { generateNoGuess, solveFully } from '../engine/generate.ts'
import { seededRandom } from './harness.ts'
import { solve } from '../engine/solver/index.ts'
import { solverView } from '../engine/board.ts'

test('first click always opens a cascade', () => {
  for (let i = 0; i < 200; i++) {
    const firstClick = (i * 37) % (30 * 16)
    const b = createBoard({ width: 30, height: 16, mineCount: 99, seed: 'fc' + i, firstClick })
    assert.equal(b.mines[firstClick], 0)
    assert.equal(b.adj[firstClick], 0, 'first click must have zero adjacent mines')
    const revealed = open(b, firstClick)
    assert.ok(revealed.length > 1, 'first click must cascade')
  }
})

test('dense custom boards fall back to merely-safe', () => {
  const b = createBoard({ width: 4, height: 4, mineCount: 14, seed: 'dense', firstClick: 5 })
  assert.equal(b.cascadeGuaranteed, false)
  assert.equal(b.mines[5], 0)
})

test('every generated no-guess board solves with certainty alone', () => {
  const rand = seededRandom(4242)
  for (const preset of [[9, 9, 10], [16, 16, 40]] as const) {
    const res = generateNoGuess(
      { width: preset[0], height: preset[1], mineCount: preset[2], firstClick: 40 },
      { rand, maxAttempts: 4000 },
    )
    assert.ok(res, `no-guess generation failed for ${preset}`)
    const b = createBoard(res.spec)
    open(b, res.spec.firstClick)
    const run = solveFully(b)
    assert.equal(run.stalled, false, 'a no-guess board must never stall')
    assert.equal(isWon(b), true)
  }
})

test('no-guess boards never need probabilities', () => {
  const rand = seededRandom(777)
  const res = generateNoGuess({ width: 16, height: 16, mineCount: 40, firstClick: 120 }, { rand, maxAttempts: 4000 })
  assert.ok(res)
  const b = createBoard(res.spec)
  open(b, res.spec.firstClick)
  for (let step = 0; step < 500; step++) {
    if (isWon(b)) break
    const r = solve(solverView(b))
    assert.equal(r.stuck, false, 'certain move must always exist')
    for (const d of r.deductions) {
      for (const c of d.subject) {
        if (b.state[c] !== 0) continue
        if (d.verdict === 'safe') open(b, c)
        else {
          b.state[c] = 2
          b.flagCount++
        }
      }
    }
  }
  assert.equal(isWon(b), true)
})
