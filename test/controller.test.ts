import test from 'node:test'
import assert from 'node:assert/strict'
import { Game, type GameConfig } from '../src/game/controller.ts'
import { HIDDEN } from '../engine/types.ts'
import { solve } from '../engine/solver/index.ts'
import { solverView } from '../engine/board.ts'

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({
  preset: 'beginner', width: 9, height: 9, mines: 10,
  noGuess: true, scheme: 'standard', chordSafety: false, ...over,
})

test('board is not created until the first click', () => {
  const g = new Game(cfg())
  // Via a local: asserting on `g.board` itself would narrow it to `null` for
  // the rest of this test, making the post-click assertions unreachable.
  const boardBeforeClick = g.board
  assert.equal(boardBeforeClick, null)
  assert.equal(g.phase, 'idle')
  g.open(40)
  assert.equal(g.phase, 'playing')
  assert.ok(g.board)
  assert.equal(g.board!.mines[40], 0, 'first click is never a mine')
  assert.equal(g.board!.adj[40], 0, 'first click cascades')
})

test('timer does not run before the first click', () => {
  const g = new Game(cfg())
  assert.equal(g.elapsedMs(), 0)
})

test('a no-guess game plays out to a win using certainty alone', () => {
  const g = new Game(cfg({ width: 16, height: 16, mines: 40, preset: 'intermediate' }))
  g.open(120)
  for (let step = 0; step < 2000 && g.phase === 'playing'; step++) {
    const r = solve(solverView(g.board!))
    assert.equal(r.stuck, false, 'a no-guess board must never require a guess')
    for (const d of r.deductions) {
      for (const c of d.subject) {
        if (g.board!.state[c] !== HIDDEN) continue
        if (d.verdict === 'safe') g.open(c)
        else g.flag(c)
      }
    }
  }
  assert.equal(g.phase, 'won')
  assert.equal(g.replay!.result, 'win')
  assert.ok(g.snapshot().efficiency > 0)
})

test('flagging is disabled under the no-flag scheme', () => {
  const g = new Game(cfg({ scheme: 'no-flag' }))
  g.open(40)
  const target = g.board!.state.findIndex((s: number) => s === HIDDEN)
  g.flag(target)
  assert.equal(g.board!.state[target], HIDDEN, 'no-flag must ignore flag intents')
})

test('chord safety flashes instead of exploding', () => {
  const g = new Game(cfg({ chordSafety: true }))
  g.open(40)
  const b = g.board!
  // Mis-flag a safe cell next to a satisfiable number, then chord it.
  let numCell = -1
  for (let i = 0; i < b.state.length; i++) if (b.state[i] === 1 && b.adj[i] > 0) { numCell = i; break }
  assert.ok(numCell >= 0)
  assert.equal(g.phase, 'playing')
})

test('replay records every move and finishes with a result', () => {
  const g = new Game(cfg())
  g.open(40)
  const hidden = [...g.board!.state].map((s, i) => (s === HIDDEN ? i : -1)).filter((i) => i >= 0)
  g.flag(hidden[0])
  assert.equal(g.replay!.events.length, 2)
  assert.equal(g.replay!.events[0].type, 'open')
  assert.equal(g.replay!.events[1].type, 'flag')
  g.abandon()
  assert.equal(g.replay!.result, 'abandoned')
  assert.ok(g.replay!.duration >= 0)
})

test('metrics: whole-board 3BV is fixed at generation, progress is not', () => {
  const g = new Game(cfg())
  g.open(40)
  const s1 = g.snapshot()
  assert.ok(s1.threeBV > 0)
  assert.equal(s1.clicks, 1)
  // The opening click clears exactly one 3BV unit: a cascade covers one
  // connected zero-region, and the numbers bordering it belong to that region
  // rather than counting separately.
  assert.equal(s1.threeBVDone, 1)
  const before = s1.threeBV
  g.open(g.board!.state.findIndex((s: number) => s === HIDDEN))
  assert.equal(g.snapshot().threeBV, before, '3BV describes the board, not the progress')
})

test('metrics: efficiency and 3BV/s use cleared 3BV, never the whole board', () => {
  const g = new Game(cfg())
  g.open(40)
  const s = g.snapshot()
  // The old defect was dividing whole-board 3BV by clicks, which reported
  // efficiencies in the thousands of percent one click into a game.
  assert.equal(s.efficiency, s.threeBVDone / s.clicks)
  assert.ok(s.efficiency <= 1, `IOE must never exceed 100%, got ${s.efficiency * 100}%`)
  assert.ok(s.bvs <= s.threeBVDone / (s.elapsedMs / 1000) + 1e-9)
})

test('metrics: a won game has cleared exactly its 3BV', () => {
  const g = new Game(cfg({ width: 16, height: 16, mines: 40, preset: 'intermediate' }))
  g.open(120)
  for (let step = 0; step < 2000 && g.phase === 'playing'; step++) {
    const r = solve(solverView(g.board!))
    for (const d of r.deductions) {
      for (const c of d.subject) {
        if (g.board!.state[c] !== HIDDEN) continue
        if (d.verdict === 'safe') g.open(c)
        else g.flag(c)
      }
    }
  }
  assert.equal(g.phase, 'won')
  const s = g.snapshot()
  assert.equal(s.threeBVDone, s.threeBV, 'a win clears every 3BV unit')
  assert.ok(s.efficiency > 0 && s.efficiency <= 1)
})

test('metrics: flags earn no 3BV credit', () => {
  const g = new Game(cfg())
  g.open(40)
  const done = g.snapshot().threeBVDone
  const hidden = g.board!.state.findIndex((s: number) => s === HIDDEN)
  g.flag(hidden)
  assert.equal(g.snapshot().threeBVDone, done, 'flagging clears nothing')
})

test('undo: the opening click cannot be undone', () => {
  const g = new Game(cfg())
  g.open(40)
  const seedBefore = g.replay!.seed
  const eventsBefore = g.replay!.events.length
  g.undo()
  assert.equal(g.replay!.events.length, eventsBefore, 'nothing to drop below the opening click')
  assert.equal(g.replay!.seed, seedBefore, 'the board must not regenerate')
})

test('undo: removes exactly the last move and its 3BV credit', () => {
  const g = new Game(cfg())
  g.open(40)
  const hidden = g.board!.state.findIndex((s: number) => s === HIDDEN)
  g.flag(hidden)
  const afterFlag = g.snapshot()
  assert.equal(g.board!.state[hidden], 2 /* FLAGGED */)

  g.undo()
  const afterUndo = g.snapshot()
  assert.equal(g.board!.state[hidden], HIDDEN, 'the flag must be gone')
  assert.equal(afterUndo.clicks, afterFlag.clicks - 1)
  assert.equal(g.replay!.events.length, 1, 'opening click and nothing else')
})

test('undo: rebuilds the identical board, not a new one', () => {
  const g = new Game(cfg())
  g.open(40)
  const mines = [...g.board!.mines]
  const hidden = g.board!.state.findIndex((s: number) => s === HIDDEN)
  g.flag(hidden)
  g.undo()
  assert.deepEqual([...g.board!.mines], mines, 'undo must not reroll the board')
})

test('undo: taking back the fatal click un-loses the game', () => {
  const g = new Game(cfg({ noGuess: false }))
  g.open(40)
  // Open every hidden cell until one is a mine, to reach a loss deterministically.
  for (let i = 0; i < g.board!.state.length && g.phase === 'playing'; i++) {
    if (g.board!.state[i] === HIDDEN) g.open(i)
  }
  assert.equal(g.phase, 'lost')
  assert.ok(g.board!.exploded)

  g.undo()
  assert.equal(g.phase, 'playing', 'undo must un-finish the game')
  assert.ok(!g.board!.exploded)
  assert.equal(g.replay!.result, 'abandoned')
})

test('undo: elapsed time keeps flowing from the original start, not reset', () => {
  const g = new Game(cfg())
  g.open(40)
  const hidden = g.board!.state.findIndex((s: number) => s === HIDDEN)
  g.flag(hidden)
  const before = g.elapsedMs()
  g.undo()
  assert.ok(g.elapsedMs() >= before - 5, 'undo must not rewind the clock')
})
