import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard, open, solverView, type BoardSpec } from '../engine/board.ts'
import { solve } from '../engine/solver/index.ts'
import { generateNoGuess } from '../engine/generate.ts'
import { newReplay, type Replay } from '../engine/replay.ts'
import { gradeReplay, provableIn } from '../engine/coach/grade.ts'
import { PATTERNS, patternOf, teachingOrder, type Pattern } from '../engine/coach/patterns.ts'
import { measureFrequency, weakSpot, recommend } from '../engine/coach/curriculum.ts'

const spec = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  width: 16, height: 16, mineCount: 40, seed: 'coach-fixed', firstClick: 120, ...over,
})

/** A replay built by hand so the grader has something deterministic to judge. */
function replayOf(s: BoardSpec, moves: Array<{ t: number; type: Replay['events'][number]['type']; cell: number }>): Replay {
  const r = newReplay(s, 'intermediate', true, 'standard')
  r.events = moves
  r.result = 'abandoned'
  return r
}

test('pattern naming: a spent number is `satisfied`, a saturated one is `forced`', () => {
  // 3x3 with the single mine at 8; opening 0 reveals a 1 at 4's neighbours.
  const b = createBoard({ width: 3, height: 3, mineCount: 1, seed: 'x', firstClick: 0 })
  open(b, 0)
  const view = solverView(b)
  const r = solve(view)
  assert.ok(r.deductions.length > 0, 'a 3x3 with one mine must be solvable after the first click')
  const ids = new Set(r.deductions.map((d) => patternOf(view, d).id))
  for (const id of ids) {
    assert.ok(['satisfied', 'forced'].includes(id), `single-witness proof should be tier 1, got ${id}`)
  }
})

test('pattern naming: proof depth equals the minimal witness count', () => {
  const g = generateNoGuess(spec(), { maxAttempts: 2000 })
  assert.ok(g, 'generation must succeed')
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  const view = solverView(b)
  for (const d of solve(view).deductions) {
    const m = patternOf(view, d)
    assert.equal(m.depth, Math.max(1, m.deduction.witnesses.length))
    assert.ok(m.depth >= 1)
  }
})

test('pattern naming: a two-number signature is canonical under mirroring', () => {
  // Whatever the board, an id derived from two witnesses must never be '2-1':
  // it is canonicalised to '1-2' so both orientations aggregate together.
  const g = generateNoGuess(spec({ seed: 'mirror' }), { maxAttempts: 2000 })
  assert.ok(g)
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  const view = solverView(b)
  for (const d of solve(view).deductions) {
    const id = patternOf(view, d).id
    if (!/^\d+(-\d+)+$/.test(id)) continue
    const parts = id.split('-')
    const reversed = [...parts].reverse().join('-')
    assert.ok(id <= reversed, `${id} is not the canonical orientation`)
  }
})

test('every catalogued pattern has resolvable prerequisites', () => {
  const ids = new Set(PATTERNS.map((p) => p.id))
  for (const p of PATTERNS) {
    for (const r of p.requires) {
      assert.ok(ids.has(r), `${p.id} requires unknown pattern ${r}`)
    }
  }
})

test('teaching order respects the prerequisite DAG', () => {
  const order = teachingOrder(PATTERNS)
  const seen = new Set<string>()
  for (const p of order) {
    for (const r of p.requires) {
      assert.ok(seen.has(r), `${p.id} taught before its prerequisite ${r}`)
    }
    seen.add(p.id)
  }
  assert.equal(order.length, PATTERNS.length, 'no pattern may be dropped')
})

test('teaching order puts frequent patterns first within a tier', () => {
  const freq = new Map([['1-2', 500], ['1-1', 10], ['2-2', 1]])
  const order = teachingOrder(PATTERNS, freq)
  const tier2 = order.filter((p: Pattern) => p.tier === 2).map((p) => p.id)
  // 1-1 is a prerequisite of 1-2, so the DAG must still win over frequency.
  assert.ok(tier2.indexOf('1-1') < tier2.indexOf('1-2'), 'DAG must outrank frequency')
  assert.ok(tier2.indexOf('1-2') < tier2.indexOf('2-2'), 'frequency should order the rest')
})

test('grading: a solver-perfect game is all certainties and no guesses', () => {
  const g = generateNoGuess(spec({ seed: 'perfect' }), { maxAttempts: 2000 })
  assert.ok(g)
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  const moves: Replay['events'] = [{ t: 0, type: 'open', cell: g.spec.firstClick }]
  let t = 100
  for (let step = 0; step < 2000; step++) {
    const view = solverView(b)
    const r = solve(view)
    if (r.deductions.length === 0) break
    let progressed = false
    for (const d of r.deductions) {
      for (const c of d.subject) {
        if (b.state[c] !== 0) continue
        moves.push({ t, type: d.verdict === 'safe' ? 'open' : 'flag', cell: c })
        t += 100
        if (d.verdict === 'safe') open(b, c)
        else b.state[c] = 2, b.flagCount++
        progressed = true
      }
    }
    if (!progressed) break
  }

  const graded = gradeReplay(replayOf(g.spec, moves))
  const bad = graded.grades.filter((x) => x.class === 'unnecessary-guess' || x.class === 'error')
  assert.deepEqual(bad, [], 'a solver-driven game must contain no mistakes')
  assert.equal(graded.summary.accuracy, 1, 'accuracy must be 1 when every move was provable')
  assert.equal(graded.v, 1)
})

test('grading: guessing while a certainty exists is an unnecessary guess', () => {
  const g = generateNoGuess(spec({ seed: 'guessy' }), { maxAttempts: 2000 })
  assert.ok(g)
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  const view = solverView(b)
  // Use the coach's own notion of provable, not `solve`'s cheapest tier, or the
  // "unprovable" cell picked below may in fact have been knowable.
  const av = provableIn(view)
  assert.ok(av.any, 'need an available certainty to ignore')

  // Pick a hidden cell that is NOT provable, and open it instead.
  let ignorant = -1
  for (let i = 0; i < b.state.length; i++) {
    if (b.state[i] === 0 && !av.safe.has(i) && !av.mine.has(i) && !b.mines[i]) { ignorant = i; break }
  }
  assert.ok(ignorant >= 0, 'expected some non-provable safe cell')

  const graded = gradeReplay(replayOf(g.spec, [
    { t: 0, type: 'open', cell: g.spec.firstClick },
    { t: 500, type: 'open', cell: ignorant },
  ]))
  const second = graded.grades[1]
  assert.equal(second.class, 'unnecessary-guess')
  assert.ok(second.betterMove !== undefined, 'the coach must name a move that was available')
  assert.ok(second.patternId, 'and the pattern that proved it')
  assert.equal(second.costMs, 500)
})

test('grading: the opening click is never counted as a mistake', () => {
  const g = generateNoGuess(spec({ seed: 'opening' }), { maxAttempts: 2000 })
  assert.ok(g)
  const graded = gradeReplay(replayOf(g.spec, [{ t: 0, type: 'open', cell: g.spec.firstClick }]))
  assert.equal(graded.grades[0].class, 'necessary-guess')
  assert.equal(graded.summary.accuracy, 1)
})

test('grading: flagging a safe cell is an error', () => {
  const g = generateNoGuess(spec({ seed: 'wrongflag' }), { maxAttempts: 2000 })
  assert.ok(g)
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  let safeHidden = -1
  for (let i = 0; i < b.state.length; i++) if (b.state[i] === 0 && !b.mines[i]) { safeHidden = i; break }
  assert.ok(safeHidden >= 0)

  const graded = gradeReplay(replayOf(g.spec, [
    { t: 0, type: 'open', cell: g.spec.firstClick },
    { t: 300, type: 'flag', cell: safeHidden },
  ]))
  assert.equal(graded.grades[1].class, 'error')
  assert.equal(graded.grades[1].costClicks, 1)
})

test('grading: unflagging costs a click and reveals nothing', () => {
  const g = generateNoGuess(spec({ seed: 'unflag' }), { maxAttempts: 2000 })
  assert.ok(g)
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  let hidden = -1
  for (let i = 0; i < b.state.length; i++) if (b.state[i] === 0) { hidden = i; break }
  const graded = gradeReplay(replayOf(g.spec, [
    { t: 0, type: 'open', cell: g.spec.firstClick },
    { t: 100, type: 'flag', cell: hidden },
    { t: 200, type: 'unflag', cell: hidden },
  ]))
  assert.equal(graded.grades[2].class, 'suboptimal')
  assert.equal(graded.grades[2].costClicks, 1)
})

test('weak spot: suppressed below the opportunity floor, surfaced above it', () => {
  const mk = (id: string, opportunities: number, misses: number) => ({
    replayId: id, v: 1 as const, grades: [], patternStats: { [id]: { opportunities, misses } },
    summary: { accuracy: 1, hesitationMs: 0, clicksLost: 0 },
  })
  // 4 opportunities is under the floor of 5, so it must not be suggested.
  assert.equal(weakSpot([mk('1-2', 4, 4)]), null)
  const found = weakSpot([mk('1-2', 10, 5)])
  assert.ok(found)
  assert.equal(found.pattern.id, '1-2')
  assert.equal(found.missRate, 0.5)
})

test('weak spot: only the rolling window counts, so it decays as you improve', () => {
  const mk = (opportunities: number, misses: number) => ({
    replayId: 'r', v: 1 as const, grades: [], patternStats: { '1-2': { opportunities, misses } },
    summary: { accuracy: 1, hesitationMs: 0, clicksLost: 0 },
  })
  const history = [mk(20, 20), ...Array.from({ length: 20 }, () => mk(20, 0))]
  assert.equal(weakSpot(history, { window: 20 }), null, 'the old bad game must fall out of the window')
})

test('weak spot: a perfect record suggests nothing', () => {
  const clean = {
    replayId: 'r', v: 1 as const, grades: [], patternStats: { '1-1': { opportunities: 50, misses: 0 } },
    summary: { accuracy: 1, hesitationMs: 0, clicksLost: 0 },
  }
  assert.equal(weakSpot([clean]), null)
})

test('recommend: next in course skips what is learned and honours the entry tier', () => {
  const learned = new Set(['satisfied', 'forced'])
  const r = recommend([], learned, new Map(), new Map(), 1)
  assert.ok(r.nextInCourse)
  assert.ok(!learned.has(r.nextInCourse.id))
  const advanced = recommend([], new Set(), new Map(), new Map(), 3)
  assert.ok(advanced.nextInCourse)
  assert.ok(advanced.nextInCourse.tier >= 3, 'self-selected entry must skip the basics')
})

test('frequency instrumentation measures rather than assumes', () => {
  const specs: BoardSpec[] = []
  for (let i = 0; i < 12; i++) {
    const g = generateNoGuess(spec({ seed: `freq-${i}`, firstClick: 100 + i }), { maxAttempts: 2000 })
    if (g) specs.push(g.spec)
  }
  assert.ok(specs.length >= 8, 'need a sample to measure')

  const report = measureFrequency(specs)
  assert.equal(report.boards, specs.length)
  assert.ok(report.frequency.size > 0, 'some pattern must have fired')

  // Tier 1 is the bread and butter of every game: it must dominate the counts.
  const tier1 = (report.frequency.get('satisfied') ?? 0) + (report.frequency.get('forced') ?? 0)
  const total = [...report.frequency.values()].reduce((a, b) => a + b, 0)
  assert.ok(tier1 / total > 0.5, `tier 1 should dominate, was ${((tier1 / total) * 100).toFixed(0)}%`)

  for (const [id, d] of report.depth) {
    assert.ok(d >= 1, `${id} has nonsense depth ${d}`)
  }
})
