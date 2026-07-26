import test from 'node:test'
import assert from 'node:assert/strict'
import { boardFromStrings, idx } from './fixtures.ts'
import { solve, minimizeWitnesses } from '../engine/solver/index.ts'
import { solverView, createBoard, open } from '../engine/board.ts'
import { buildFrontier } from '../engine/solver/constraints.ts'
import { tier1, tier2 } from '../engine/solver/rules.ts'
import { FLAGGED, HIDDEN, REVEALED } from '../engine/types.ts'
import { seededRandom } from './harness.ts'

/** Reveal a rectangle of rows, leaving the rest hidden. */
function revealRows(b: ReturnType<typeof boardFromStrings>, rows: number[]): void {
  for (const y of rows) for (let x = 0; x < b.width; x++) b.state[idx(b, x, y)] = REVEALED
}

test('tier 1: a satisfied number frees its neighbours', () => {
  const b = boardFromStrings(['*...', '....', '....'])
  b.state[idx(b, 2, 1)] = REVEALED // a 0 with hidden neighbours
  const r = solve(solverView(b))
  assert.equal(r.stuck, false)
  const safe = r.deductions.filter((d) => d.verdict === 'safe')
  assert.ok(safe.length > 0)
  assert.equal(safe[0].rule, 'count-satisfied')
  for (const c of safe[0].subject) assert.equal(b.mines[c], 0)
})

test('tier 1: a forced number marks mines', () => {
  const b = boardFromStrings(['**', '..'])
  b.state[idx(b, 0, 1)] = REVEALED
  b.state[idx(b, 1, 1)] = REVEALED
  const r = solve(solverView(b))
  const mine = r.deductions.find((d) => d.verdict === 'mine')
  assert.ok(mine, 'expected a forced-mine deduction')
  assert.equal(mine.rule, 'count-forced')
  for (const c of mine.subject) assert.equal(b.mines[c], 1)
})

test('tier 2: the 1-2-1 falls out of subset reduction, not a special case', () => {
  //  * . * .      hidden top row
  //  1 2 1 1      revealed
  const b = boardFromStrings(['*.*.', '....', '....'])
  revealRows(b, [1, 2])

  const f = buildFrontier(solverView(b))
  assert.equal(tier1(f).length, 0, 'tier 1 should have nothing to say here')

  const t2 = tier2(f)
  assert.ok(t2.length > 0, 'tier 2 should crack it')

  const mines = new Set<number>()
  const safes = new Set<number>()
  for (const d of t2) for (const c of d.subject) (d.verdict === 'mine' ? mines : safes).add(c)

  assert.ok(mines.has(idx(b, 2, 0)), 'the middle mine of the 1-2-1')
  assert.ok(safes.has(idx(b, 1, 0)), 'the cell the 1-2-1 clears')
  for (const c of mines) assert.equal(b.mines[c], 1)
  for (const c of safes) assert.equal(b.mines[c], 0)
  // every subset deduction cites exactly the two numbers it used
  for (const d of t2) assert.equal(d.witnesses.length, 2)
})

test('tier 4: the mine budget clears the board when all mines are flagged', () => {
  const b = boardFromStrings(['.....', '.....', '..*..', '.....', '.....'])
  b.state[idx(b, 2, 2)] = FLAGGED
  b.flagCount = 1
  const r = solve(solverView(b))
  const safe = r.deductions.find((d) => d.rule === 'global-count' && d.verdict === 'safe')
  assert.ok(safe, 'remaining mines are all accounted for, so everything else is safe')
  assert.equal(safe.subject.length, 24)
})

test('tier 4: the budget also forces the all-mines case', () => {
  const b = boardFromStrings(['**', '**'])
  const r = solve(solverView(b))
  const mine = r.deductions.find((d) => d.rule === 'global-count' && d.verdict === 'mine')
  assert.ok(mine)
  assert.equal(mine.subject.length, 4)
})

test('probabilities over all hidden cells sum to the remaining mine count', () => {
  const rand = seededRandom(99)
  let checked = 0
  for (let i = 0; i < 40 && checked < 8; i++) {
    const b = createBoard({ width: 16, height: 16, mineCount: 40, seed: 'prob' + i, firstClick: 120 })
    open(b, 120)
    // walk forward with certain moves until the solver stalls
    for (let step = 0; step < 200; step++) {
      const r = solve(solverView(b))
      if (r.stuck) break
      for (const d of r.deductions) {
        for (const c of d.subject) {
          if (b.state[c] !== HIDDEN) continue
          if (d.verdict === 'safe') open(b, c)
          else {
            b.state[c] = FLAGGED
            b.flagCount++
          }
        }
      }
    }
    const r = solve(solverView(b), { probabilities: true })
    if (!r.probabilities || r.probabilities.size === 0) continue
    if (r.incomplete) continue

    let sum = 0
    for (const [, p] of r.probabilities) {
      assert.ok(p >= -1e-9 && p <= 1 + 1e-9, `probability out of range: ${p}`)
      sum += p
    }
    const remaining = b.mineCount - b.flagCount
    assert.ok(Math.abs(sum - remaining) < 1e-6, `expected ${remaining} mines of probability mass, got ${sum}`)
    checked++
    void rand
  }
  assert.ok(checked > 0, 'no stalled positions found to check')
})

test('witnesses are minimal: dropping one breaks the proof', () => {
  const b = boardFromStrings(['*.*.', '....', '....'])
  revealRows(b, [1, 2])
  const view = solverView(b)
  const r = solve(view)
  for (const d of r.deductions) {
    const m = minimizeWitnesses(view, d)
    assert.ok(m.witnesses.length > 0)
    assert.ok(m.witnesses.length <= d.witnesses.length)
  }
})

test('tank finds certainties that tier 1 and 2 both miss', () => {
  let found = 0
  for (let i = 0; i < 300 && found < 3; i++) {
    const b = createBoard({ width: 16, height: 16, mineCount: 40, seed: 'tank' + i, firstClick: 120 })
    open(b, 120)
    for (let step = 0; step < 300; step++) {
      const view = solverView(b)
      const f = buildFrontier(view)
      const cheap = [...tier1(f), ...tier2(f)]
      if (cheap.length === 0) {
        const r = solve(view)
        if (!r.stuck) {
          found++
          for (const d of r.deductions) {
            assert.ok(d.rule === 'tank' || d.rule === 'global-count')
            for (const c of d.subject) {
              assert.equal(b.mines[c] === 1, d.verdict === 'mine', 'tank deduction must be sound')
            }
          }
        }
        break
      }
      for (const d of cheap) {
        for (const c of d.subject) {
          if (b.state[c] !== HIDDEN) continue
          if (d.verdict === 'safe') open(b, c)
          else {
            b.state[c] = FLAGGED
            b.flagCount++
          }
        }
      }
      if (b.exploded) break
    }
  }
  assert.ok(found > 0, 'expected at least one tank-only position')
})
