import test from 'node:test'
import assert from 'node:assert/strict'
import type { Grade } from '../engine/coach/grade.ts'
import { rankMistakes, scoreOf, severityOf, tally } from '../engine/coach/severity.ts'

const g = (over: Partial<Grade> & Pick<Grade, 'class' | 'moveIndex'>): Grade => ({
  costClicks: 0, costMs: 0, ...over,
})

test('ranking puts the fatal move first', () => {
  const grades: Grade[] = [
    g({ moveIndex: 0, class: 'necessary-guess' }),
    g({ moveIndex: 1, class: 'unnecessary-guess' }),
    g({ moveIndex: 2, class: 'suboptimal', costClicks: 1 }),
    g({ moveIndex: 3, class: 'unnecessary-guess' }),
  ]
  const ranked = rankMistakes(grades, { result: 'loss', events: new Array(4).fill({ t: 0, type: 'open', cell: 0 }) })
  assert.equal(ranked[0].grade.moveIndex, 3, 'the move that ended the game ranks first')
  assert.equal(ranked[0].severity, 'critical')
  assert.match(ranked[0].reason, /lost the game/)
})

test('a forced guess is never a mistake, even when it kills you', () => {
  const grades: Grade[] = [
    g({ moveIndex: 0, class: 'necessary-guess' }),
    g({ moveIndex: 1, class: 'necessary-guess' }),
  ]
  const ranked = rankMistakes(grades, { result: 'loss', events: new Array(2).fill({ t: 0, type: 'open', cell: 0 }) })
  assert.equal(ranked.length, 0, 'a board that gave you nothing is not something to fix')
})

test('an unnecessary guess outranks a wasted click', () => {
  const guess = scoreOf(g({ moveIndex: 1, class: 'unnecessary-guess' }))
  const waste = scoreOf(g({ moveIndex: 2, class: 'suboptimal', costClicks: 1 }))
  assert.ok(guess > waste, `guess ${guess} should outrank waste ${waste}`)
})

test('a provable error outranks an unnecessary guess', () => {
  const err = scoreOf(g({ moveIndex: 1, class: 'error', costClicks: 1 }))
  const guess = scoreOf(g({ moveIndex: 2, class: 'unnecessary-guess' }))
  assert.ok(err > guess)
})

test('time is capped so one long think cannot outweigh a detonation', () => {
  const slowWaste = scoreOf(g({ moveIndex: 1, class: 'suboptimal', costClicks: 1, costMs: 600_000 }))
  const fatalGuess = scoreOf(g({ moveIndex: 2, class: 'unnecessary-guess' }), { fatalIndex: 2 })
  assert.ok(fatalGuess > slowWaste, `fatal ${fatalGuess} must beat a ten-minute stall ${slowWaste}`)
})

test('non-mistake classes score zero and never appear', () => {
  assert.equal(scoreOf(g({ moveIndex: 0, class: 'optimal' })), 0)
  assert.equal(scoreOf(g({ moveIndex: 0, class: 'necessary-guess' })), 0)
  const ranked = rankMistakes([g({ moveIndex: 0, class: 'optimal' }), g({ moveIndex: 1, class: 'necessary-guess' })])
  assert.equal(ranked.length, 0)
})

test('severity bands and tally', () => {
  assert.equal(severityOf(1200), 'critical')
  assert.equal(severityOf(400), 'major')
  assert.equal(severityOf(60), 'minor')

  const ranked = rankMistakes([
    g({ moveIndex: 1, class: 'error', costClicks: 1 }),
    g({ moveIndex: 2, class: 'unnecessary-guess' }),
    g({ moveIndex: 3, class: 'suboptimal', costClicks: 1 }),
  ])
  const t = tally(ranked)
  assert.equal(t.total, 3)
  assert.equal(t.critical + t.major + t.minor, 3)
})

test('ties keep board order, so a band still reads chronologically', () => {
  const ranked = rankMistakes([
    g({ moveIndex: 7, class: 'unnecessary-guess' }),
    g({ moveIndex: 2, class: 'unnecessary-guess' }),
    g({ moveIndex: 5, class: 'unnecessary-guess' }),
  ])
  assert.deepEqual(ranked.map((m) => m.grade.moveIndex), [2, 5, 7])
})
