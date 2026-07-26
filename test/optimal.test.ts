import test from 'node:test'
import assert from 'node:assert/strict'
import { boardFromStrings, idx } from './fixtures.ts'
import { open, solverView, toggleFlag } from '../engine/board.ts'
import { provableIn } from '../engine/coach/grade.ts'
import { planFrom, costOf, regretOf, analyzePosition, keyOf } from '../engine/coach/optimal.ts'

/**
 * A 5x5 with three mines in a vertical line behind a wall of numbers. Opening
 * the far column cascades; the mines sit next to a 3 that becomes chordable once
 * they are flagged.
 *
 *   . . * . .
 *   . . * . .
 *   . . * . .
 *   . . . . .
 *   . . . . .
 */
const THREE_MINES = [
  '..*..',
  '..*..',
  '..*..',
  '.....',
  '.....',
]

/**
 * A 5x5 lattice of nine mines. Chosen because *every* safe cell touches at least
 * one mine, so the board contains no cascades at all — which makes chord-versus-
 * click comparisons clean: nothing is ever revealed for free.
 */
const LATTICE = [
  '*.*.*',
  '.....',
  '*.*.*',
  '.....',
  '*.*.*',
]

test('planFrom: an unfinished position has a positive cost and a next action', () => {
  // The lattice has no cascades, so one click cannot end the game — unlike an
  // open board, where a single cascade can finish it and leave `best` at 0.
  const b = boardFromStrings(LATTICE)
  open(b, idx(b, 1, 1))
  const plan = planFrom(b)
  assert.ok(plan.best > 0, 'clearing the rest must cost something')
  assert.ok(plan.step.length > 0, 'there must be a next action')
  assert.ok(plan.path.length >= plan.step.length)
})

test('on-plan moves have zero regret', () => {
  const b = boardFromStrings(THREE_MINES)
  open(b, idx(b, 0, 4))
  const analysis = analyzePosition(b)
  for (const m of analysis.step) {
    assert.equal(regretOf(b, analysis, m), 0, `${keyOf(m)} is the plan's own step yet scores regret`)
  }
})

test('chording beats opening the same cells one at a time', () => {
  /*
   * The exact case from the brief: with a number satisfied, there is a fast way
   * to break open what is left and a slow one.
   *
   * The comparison has to be against a cell the chord *itself* would have
   * opened. Costing some unrelated cell elsewhere on the board proves nothing —
   * that cell has to be opened eventually either way, so the totals differ for
   * reasons that have nothing to do with chording.
   */
  const b = boardFromStrings(LATTICE)
  const four = idx(b, 1, 1)
  open(b, four)
  assert.equal(b.adj[four], 4, 'expected a 4 with all four lattice mines around it')
  for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2]]) toggleFlag(b, idx(b, x, y))

  const chordCost = costOf(b, { type: 'chord', cell: four })
  assert.ok(Number.isFinite(chordCost), 'the chord must be legal once its flags are placed')

  // One of the cells this very chord would reveal.
  const targets = [idx(b, 1, 0), idx(b, 0, 1), idx(b, 2, 1), idx(b, 1, 2)]
  const single = targets.find((c) => b.state[c] === 0 && !b.mines[c])
  assert.ok(single !== undefined)
  const singleCost = costOf(b, { type: 'open', cell: single })

  assert.ok(
    chordCost < singleCost,
    `chording (${chordCost}) must beat opening one of its own targets (${singleCost})`,
  )
})

test('the plan never flags without a chord to pay for it', () => {
  /*
   * Flagging is a click, so flagging mines you will never chord against is the
   * classic efficiency leak — and it is the mechanism, not a special case, that
   * stops the advice recommending one: the greedy only ever emits flags as the
   * setup for a chord whose benefit already exceeds their cost.
   *
   * Asserted structurally rather than by costing one specific "useless" flag,
   * because on a small open board a single cascade tends to finish the game
   * outright, and once nothing is left to clear, flagging the last mine really
   * is the only move there is.
   */
  const b = boardFromStrings(LATTICE)
  open(b, idx(b, 1, 1))

  for (let i = 0; i < 20; i++) {
    const analysis = analyzePosition(b)
    const flags = analysis.step.filter((m) => m.type === 'flag')
    if (flags.length > 0) {
      assert.ok(
        analysis.step.some((m) => m.type === 'chord'),
        'the plan proposed flags with no chord to justify them',
      )
      assert.ok(analysis.saves > 0, 'a flag-then-chord step must save clicks to be worth proposing')
    }
    const advice = analysis.advice
    if (!advice) break
    if (advice.type === 'open') open(b, advice.cell)
    else if (advice.type === 'flag') toggleFlag(b, advice.cell)
    else break
  }
})

test('an off-plan flag costs the player a click', () => {
  // Same claim from the other side: once the plan is known, a flag outside it is
  // measurably worse, and by a whole click rather than a rounding error.
  const b = boardFromStrings(LATTICE)
  open(b, idx(b, 1, 1))
  const analysis = analyzePosition(b)

  const offPlan = [...analysis.step.filter((m) => m.type === 'flag').map((m) => m.cell)]
  let victim = -1
  for (let c = 0; c < b.state.length; c++) {
    if (b.mines[c] && b.state[c] === 0 && !offPlan.includes(c)) { victim = c; break }
  }
  assert.ok(victim >= 0, 'expected some mine the plan does not want flagged yet')

  const cost = costOf(b, { type: 'flag', cell: victim })
  assert.ok(
    cost > analysis.best,
    `flagging outside the plan (${cost}) must cost more than the plan itself (${analysis.best})`,
  )
})

test('regret is measured, so genuinely tied lines are never punished', () => {
  // §7.3: order among independent openings must never be penalised.
  const b = boardFromStrings([
    '.....*....',
    '..........',
    '..........',
    '*.........',
    '..........',
  ])
  open(b, idx(b, 8, 4))
  const analysis = analyzePosition(b)
  const opens = analysis.step.filter((m) => m.type === 'open')
  if (opens.length >= 2) {
    for (const m of opens) {
      assert.equal(regretOf(b, analysis, m), 0, 'every independent opening must be free to take first')
    }
  }
})

test('costOf rejects illegal moves rather than scoring them', () => {
  const b = boardFromStrings(THREE_MINES)
  open(b, idx(b, 0, 4))
  const revealed = b.state.findIndex((s: number) => s === 1)
  assert.ok(revealed >= 0)
  // Re-opening an open cell is not a move.
  assert.equal(costOf(b, { type: 'open', cell: revealed }), Infinity)
  // Nor is chording a number whose flags do not match.
  const unsatisfied = { type: 'chord' as const, cell: revealed }
  if (b.adj[revealed] > 0) assert.equal(costOf(b, unsatisfied), Infinity)
})

test('advice never points at a cell the solver cannot prove', () => {
  // The greedy is omniscient; the player is not. Recommending a merely-lucky
  // cell would be teaching a guess.
  const b = boardFromStrings(LATTICE)
  open(b, idx(b, 1, 1))
  const { advice } = analyzePosition(b)
  if (!advice) return
  const av = provableIn(solverView(b))
  if (advice.type === 'open') assert.ok(av.safe.has(advice.cell), 'recommended open must be provably safe')
  if (advice.type === 'flag') assert.ok(av.mine.has(advice.cell), 'recommended flag must be a provable mine')
})

test('the advice is never a move the blocker would reject', () => {
  // The hint and the blocker share one baseline, so this must hold at every
  // step — otherwise learning mode recommends a move and then refuses it.
  const b = boardFromStrings(LATTICE)
  open(b, idx(b, 1, 1))
  for (let i = 0; i < 20; i++) {
    const analysis = analyzePosition(b)
    const advice = analysis.advice
    if (!advice) break
    const move = { type: advice.type, cell: advice.cell }
    assert.equal(regretOf(b, analysis, move), 0, `advice at step ${i} scored as regret`)
    if (advice.type === 'open') open(b, advice.cell)
    else if (advice.type === 'flag') toggleFlag(b, advice.cell)
    else break
    if (b.exploded) { assert.fail('following the advice detonated a mine'); }
  }
})
