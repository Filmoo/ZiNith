import test from 'node:test'
import assert from 'node:assert/strict'
import { boardFromStrings, idx } from './fixtures.ts'
import { LearningGame, type Blocked } from '../src/game/learningGame.ts'
import type { GameConfig } from '../src/game/controller.ts'
import { open as openCell } from '../engine/board.ts'
import { threeBV } from '../engine/metrics/threebv.ts'
import { FLAGGED, HIDDEN } from '../engine/types.ts'

/**
 * A `LearningGame` on a board the test wrote rather than one a seed produced.
 *
 * `Game` generates on the first click, so the sequence is: let it generate,
 * then swap the fixture in and replay that same opening click against it. The
 * 3BV progress counters are left pointing at the discarded board — these tests
 * assert on blocking and hints, never on metrics, and reconstructing them would
 * mean reaching into private state.
 */
function gameOn(rows: string[], firstClick: number): LearningGame {
  const fixture = boardFromStrings(rows)
  const cfg: GameConfig = {
    preset: 'beginner',
    width: fixture.width,
    height: fixture.height,
    mines: fixture.mineCount,
    noGuess: false,
    scheme: 'standard',
    chordSafety: true,
  }
  const g = new LearningGame(cfg, (base) => ({ ...base, seed: 'fixed' }))
  g.open(firstClick)
  g.board = fixture
  g.bv = threeBV(fixture).value
  openCell(fixture, firstClick)
  return g
}

const LATTICE = [
  '*.*.*',
  '.....',
  '*.*.*',
  '.....',
  '*.*.*',
]

/**
 * A corner boxed in by three mines, so opening it reveals a 3 with exactly three
 * hidden neighbours — a tier-1 `forced` deduction, immediately.
 *
 * The lattice cannot serve here: one revealed 4 with eight hidden neighbours
 * proves nothing at all, so a game there never reaches a position with a
 * certainty in it.
 */
const CORNER = [
  '.*....',
  '**....',
  '......',
  '......',
  '......',
]
const CORNER_FIRST = 0

test('blocks opening a cell that a chord would clear more cheaply', () => {
  // The brief's example: all the mines around a number are flagged, and there is
  // now a fast way and a slow way to break open what is left.
  const g = gameOn(LATTICE, idx(boardFromStrings(LATTICE), 1, 1))
  const b = g.board!
  const four = idx(b, 1, 1)
  assert.equal(b.adj[four], 4)

  const blocks: Blocked[] = []
  g.onBlocked = (x) => blocks.push(x)
  for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2]]) g.flag(idx(b, x, y))
  assert.equal(blocks.length, 0, 'flagging mines that enable the chord must be allowed')

  // Opening one of the chord's own targets by hand is correct and wasteful.
  const target = [idx(b, 1, 0), idx(b, 0, 1), idx(b, 2, 1), idx(b, 1, 2)]
    .find((c) => b.state[c] === HIDDEN)
  assert.ok(target !== undefined)

  g.open(target)
  assert.equal(b.state[target], HIDDEN, 'the wasteful open must not have been applied')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].reason, 'wastes-clicks')
  assert.ok(blocks[0].regret > 0, 'the block must quantify what it costs')
  assert.equal(blocks[0].advice?.type, 'chord', 'and it must point at the chord instead')
})

test('allows the chord it recommends', () => {
  const g = gameOn(LATTICE, idx(boardFromStrings(LATTICE), 1, 1))
  const b = g.board!
  const four = idx(b, 1, 1)
  for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2]]) g.flag(idx(b, x, y))

  const blocks: Blocked[] = []
  g.onBlocked = (x) => blocks.push(x)
  const before = b.revealedCount
  g.chord(four)
  assert.equal(blocks.length, 0, 'the recommended chord must never be rejected')
  assert.ok(b.revealedCount > before, 'and it must actually open cells')
})

/**
 * Plays the recommended move until `done` holds. Needed because a position only
 * a click or two old often has nothing provable in it yet, and the interesting
 * behaviour only exists once certainties do.
 */
function advanceUntil(g: LearningGame, done: () => boolean, maxSteps = 30): boolean {
  for (let i = 0; i < maxSteps; i++) {
    if (done()) return true
    const advice = g.current?.advice
    if (!advice) return false
    if (advice.type === 'open') g.open(advice.cell)
    else if (advice.type === 'flag') g.flag(advice.cell)
    else g.chord(advice.cell)
    if (g.phase !== 'playing') return done()
  }
  return done()
}

test('blocks opening a proven mine, and says so', () => {
  const g = gameOn(CORNER, CORNER_FIRST)
  const b = g.board!
  const reached = advanceUntil(g, () => (g.current?.available.mine.size ?? 0) > 0)
  assert.ok(reached, 'expected some mine to become provable')

  const mine = [...g.current!.available.mine][0]
  const blocks: Blocked[] = []
  g.onBlocked = (x) => blocks.push(x)
  g.open(mine)

  assert.equal(blocks.at(-1)?.reason, 'known-mine')
  assert.ok(!b.exploded, 'learning mode must not let a known mine detonate')
})

test('unflagging is never blocked — a correction is not a guess', () => {
  const g = gameOn(LATTICE, idx(boardFromStrings(LATTICE), 1, 1))
  const b = g.board!
  const mine = idx(b, 0, 0)
  g.flag(mine)
  assert.equal(b.state[mine], FLAGGED)

  const blocks: Blocked[] = []
  g.onBlocked = (x) => blocks.push(x)
  g.flag(mine)
  assert.equal(blocks.length, 0, 'taking a flag back must always be allowed')
  assert.equal(b.state[mine], HIDDEN)
})

test('the hint names both the move and its price', () => {
  const g = gameOn(CORNER, CORNER_FIRST)
  const hints: Array<{ advice: unknown; best: number; certain: boolean }> = []
  g.onHint = (h) => {
    if (h.analysis) {
      hints.push({
        advice: h.analysis.advice,
        best: h.analysis.bestAchievable,
        certain: h.analysis.hasCertainty,
      })
    }
  }
  // Advice is legitimately null while nothing is provable — the honest answer to
  // "what should I do" in a position that needs a guess is "no idea" — so this
  // fixture is chosen to have a certainty from the opening click onwards.
  const first = g.current
  assert.ok(first?.hasCertainty, 'CORNER should prove something immediately')
  assert.ok(first.advice, 'and therefore recommend something')

  assert.ok(first.bestAchievable > 0, 'the hint must know how many clicks remain')

  // Hints are emitted on state change. Play the advised move and check what
  // arrived — but only when the game is still going: a move that finishes the
  // board correctly reports no further advice.
  const move = first.advice
  if (move.type === 'open') g.open(move.cell)
  else if (move.type === 'flag') g.flag(move.cell)
  else g.chord(move.cell)

  if (g.phase === 'playing') {
    const last = hints.at(-1)
    assert.ok(last, 'a hint must be emitted after a move that leaves the game running')
    assert.ok(last.best > 0)
    assert.ok(last.certain && last.advice, 'and it must still say what to do next')
  }
})

test('nothing is blocked when the position genuinely needs a guess', () => {
  // A board with no deducible move anywhere: blocking on cost here would leak
  // mine positions, since the cost model is omniscient.
  const g = gameOn(['.*.', '...', '.*.'], idx(boardFromStrings(['.*.', '...', '.*.']), 1, 1))
  const b = g.board!
  const blocks: Blocked[] = []
  g.onBlocked = (x) => blocks.push(x)

  const hidden = [...b.state].findIndex((s, i) => s === HIDDEN && !b.mines[i])
  if (hidden >= 0 && !g.current?.hasCertainty) {
    g.open(hidden)
    assert.equal(blocks.length, 0, 'a forced guess must never be blocked')
  }
})
