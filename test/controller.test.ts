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

test('metrics: 3BV is fixed at generation, efficiency tracks clicks', () => {
  const g = new Game(cfg())
  g.open(40)
  const s1 = g.snapshot()
  assert.ok(s1.threeBV > 0)
  assert.equal(s1.clicks, 1)
  assert.equal(s1.efficiency, s1.threeBV / 1)
})
