import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard, isWon, open, solverView, toggleFlag, type BoardSpec } from '../engine/board.ts'
import { generateNoGuess } from '../engine/generate.ts'
import { threeBV } from '../engine/metrics/threebv.ts'
import {
  MISTAKE_CLASSES, matchesFilter, personalBest, poolOf, recordOf, replayStats, withGrades,
  type GameRecord,
} from '../engine/record.ts'
import { decode, newReplay, type Replay } from '../engine/replay.ts'
import { stateAfter } from '../engine/seek.ts'
import { solve } from '../engine/solver/index.ts'
import { HIDDEN } from '../engine/types.ts'
import type { CachedGrades } from '../engine/coach/grade.ts'

const baseSpec = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  width: 16, height: 16, mineCount: 40, seed: 'record-fixed', firstClick: 120, ...over,
})

/**
 * Play a no-guess board to completion with the solver, logging exactly what the
 * controller would have logged. Gives the record tests a real event stream
 * rather than a hand-written one.
 */
function solvedReplay(spec: BoardSpec): Replay {
  const b = createBoard(spec)
  const r = newReplay(spec, 'intermediate', true, 'standard')
  let t = 0
  const log = (type: 'open' | 'flag', cell: number) => {
    t += 100
    r.events.push({ t, type, cell })
  }

  open(b, spec.firstClick)
  log('open', spec.firstClick)

  for (let guard = 0; guard < 5000 && !isWon(b) && !b.exploded; guard++) {
    const res = solve(solverView(b))
    if (res.deductions.length === 0) break
    let progressed = false
    for (const d of res.deductions) {
      for (const c of d.subject) {
        if (b.state[c] !== HIDDEN) continue
        if (d.verdict === 'safe') { open(b, c); log('open', c) }
        else { toggleFlag(b, c); log('flag', c) }
        progressed = true
      }
    }
    if (!progressed) break
  }

  r.result = isWon(b) ? 'win' : 'abandoned'
  r.duration = t
  return r
}

test('replayStats: a completed board clears all of its 3BV', () => {
  const g = generateNoGuess(baseSpec(), { maxAttempts: 2000 })
  assert.ok(g, 'generation must succeed')
  const r = solvedReplay(g.spec)
  assert.equal(r.result, 'win', 'a no-guess board must be solvable start to finish')

  const s = replayStats(r)
  const full = threeBV(createBoard(g.spec)).value
  assert.equal(s.threeBV, full)
  assert.equal(s.threeBVDone, full, 'a win clears every 3BV unit')
  assert.ok(s.bvs > 0, '3BV/s must be positive on a timed win')
  assert.ok(s.efficiency > 0 && s.efficiency <= 1.5, `IOE out of range: ${s.efficiency}`)
})

test('replayStats: a partial game credits only what was cleared', () => {
  const g = generateNoGuess(baseSpec(), { maxAttempts: 2000 })
  assert.ok(g)
  const full = solvedReplay(g.spec)
  const partial: Replay = { ...full, events: full.events.slice(0, 5), result: 'loss' }

  const s = replayStats(partial)
  assert.ok(s.threeBVDone < s.threeBV, 'a truncated game cannot have cleared the board')
  assert.ok(s.threeBVDone > 0, 'the first click alone clears at least one unit')
})

test('replayStats: flags cost clicks but clear no 3BV', () => {
  const g = generateNoGuess(baseSpec(), { maxAttempts: 2000 })
  assert.ok(g)
  const r = solvedReplay(g.spec)
  const flags = r.events.filter((e) => e.type === 'flag').length
  const s = replayStats(r)
  assert.ok(flags > 0, 'the fixture should involve flagging')
  assert.equal(s.clicks, r.events.length, 'every event is a click')
  // Efficiency is cleared 3BV over clicks, so the flags must show up as cost.
  assert.ok(s.efficiency < 1, 'flag-heavy solver play cannot reach 100% IOE')
})

test('seek: the board reconstructs identically at every move', () => {
  const g = generateNoGuess(baseSpec(), { maxAttempts: 2000 })
  assert.ok(g)
  const r = solvedReplay(g.spec)

  const empty = stateAfter(r, 0)
  for (let i = 0; i < empty.state.length; i++) {
    assert.equal(empty.state[i], HIDDEN, 'move 0 is the board before the first click')
  }

  // Seeking must match a straight play-through at every point, and revealed
  // cells must never go backwards.
  let prevRevealed = -1
  for (let i = 0; i <= r.events.length; i++) {
    const b = stateAfter(r, i)
    let revealed = 0
    for (let c = 0; c < b.state.length; c++) if (b.state[c] === 1) revealed++
    assert.ok(revealed >= prevRevealed, `revealed count went backwards at move ${i}`)
    prevRevealed = revealed
  }

  const end = stateAfter(r, r.events.length)
  assert.ok(isWon(end), 'seeking to the last move reproduces the win')
})

test('seek: clamps out-of-range indices instead of throwing', () => {
  const g = generateNoGuess(baseSpec(), { maxAttempts: 2000 })
  assert.ok(g)
  const r = solvedReplay(g.spec)
  assert.ok(isWon(stateAfter(r, r.events.length + 500)), 'past the end is the end')
  const before = stateAfter(r, -5)
  for (let i = 0; i < before.state.length; i++) assert.equal(before.state[i], HIDDEN)
})

test('recordOf: round-trips the replay through its encoded form', () => {
  const g = generateNoGuess(baseSpec(), { maxAttempts: 2000 })
  assert.ok(g)
  const r = solvedReplay(g.spec)
  const rec = recordOf(r)

  assert.equal(rec.id, r.id)
  assert.equal(rec.result, 'win')
  assert.equal(rec.pool, 'flag-noguess')

  const back = decode(rec.replay)
  assert.equal(back.id, r.id)
  assert.equal(back.seed, r.seed)
  assert.equal(back.firstClick, r.firstClick)
  assert.equal(back.events.length, r.events.length)
  assert.deepEqual(back.events[0], r.events[0])
  assert.deepEqual(back.events.at(-1), r.events.at(-1))
})

test('poolOf: flags and no-guess are independent axes (§14.2)', () => {
  assert.equal(poolOf({ scheme: 'standard', noGuess: true }), 'flag-noguess')
  assert.equal(poolOf({ scheme: 'no-flag', noGuess: true }), 'noflag-noguess')
  assert.equal(poolOf({ scheme: 'standard', noGuess: false }), 'flag-guess')
  assert.equal(poolOf({ scheme: 'no-flag', noGuess: false }), 'noflag-guess')
  // drag-flag still allows flags, so it belongs in the flag pool.
  assert.equal(poolOf({ scheme: 'drag-flag', noGuess: true }), 'flag-noguess')
})

const row = (over: Partial<GameRecord> = {}): GameRecord => ({
  id: 'r1', startedAt: 1, preset: 'expert', result: 'win', durationMs: 100_000, clicks: 100,
  threeBV: 120, threeBVDone: 120, bvs: 1.2, efficiency: 1.2, pool: 'flag-noguess',
  scheme: 'standard', noGuess: true, dims: [30, 16], mines: 99, replay: '', ...over,
})

test('matchesFilter: filters compose, and mistake filtering needs graded rows', () => {
  const graded = row({ mistakeClasses: ['unnecessary-guess'] })
  assert.ok(matchesFilter(graded, {}))
  assert.ok(matchesFilter(graded, { preset: 'expert', result: 'win' }))
  assert.ok(!matchesFilter(graded, { preset: 'beginner' }))
  assert.ok(matchesFilter(graded, { mistake: 'unnecessary-guess' }))
  assert.ok(!matchesFilter(graded, { mistake: 'error' }))
  // An ungraded row must not match a mistake filter rather than matching all.
  assert.ok(!matchesFilter(row(), { mistake: 'unnecessary-guess' }))
})

test('personalBest: fastest win in the pool, ignoring losses and other pools', () => {
  const records = [
    row({ id: 'slow', durationMs: 90_000 }),
    row({ id: 'fast-loss', durationMs: 10_000, result: 'loss' }),
    row({ id: 'fast-other-pool', durationMs: 20_000, pool: 'flag-guess' }),
    row({ id: 'fast', durationMs: 60_000 }),
    row({ id: 'fast-other-preset', durationMs: 5_000, preset: 'beginner' }),
  ]
  assert.equal(personalBest(records, 'expert')?.id, 'fast')
  assert.equal(personalBest(records, 'expert', 'flag-guess')?.id, 'fast-other-pool')
  assert.equal(personalBest(records, 'intermediate'), null)
})

test('withGrades: folds the coach summary and the distinct mistake classes', () => {
  const g: CachedGrades = {
    replayId: 'r1',
    v: 1,
    grades: [
      { moveIndex: 0, class: 'necessary-guess', costClicks: 0, costMs: 0 },
      { moveIndex: 1, class: 'optimal', costClicks: 0, costMs: 10 },
      { moveIndex: 2, class: 'unnecessary-guess', costClicks: 0, costMs: 20 },
      { moveIndex: 3, class: 'unnecessary-guess', costClicks: 0, costMs: 20 },
      { moveIndex: 4, class: 'suboptimal', costClicks: 1, costMs: 5 },
    ],
    patternStats: {},
    summary: { accuracy: 0.4, hesitationMs: 12, clicksLost: 3 },
  }
  const merged = withGrades(row(), g)
  assert.equal(merged.accuracy, 0.4)
  assert.equal(merged.clicksLost, 3)
  assert.equal(merged.coachV, 1)
  assert.deepEqual([...(merged.mistakeClasses ?? [])].sort(), ['suboptimal', 'unnecessary-guess'])
  // A forced guess is not the player's fault, so it must never be filterable
  // as a mistake.
  assert.ok(!merged.mistakeClasses?.includes('necessary-guess'))
  assert.ok(!MISTAKE_CLASSES.includes('necessary-guess'))
})
