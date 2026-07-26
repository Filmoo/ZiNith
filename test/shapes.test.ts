import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard, open, solverView, toggleFlag, type BoardSpec } from '../engine/board.ts'
import { findShapes } from '../engine/coach/shapes.ts'
import { isPrimitive, PATTERNS, PRIMITIVES } from '../engine/coach/patterns.ts'
import { measureFrequency } from '../engine/coach/curriculum.ts'
import { generateNoGuess } from '../engine/generate.ts'
import { solve } from '../engine/solver/index.ts'
import { HIDDEN } from '../engine/types.ts'

const spec = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  width: 16, height: 16, mineCount: 40, seed: 'shapes-fixed', firstClick: 120, ...over,
})

/**
 * Soundness, and it matters more here than anywhere else in the pedagogy layer:
 * a shape that claims a safe cell is a mine would teach a player to lose.
 */
test('shape scan is sound against ground truth', () => {
  let checked = 0
  for (let i = 0; i < 40; i++) {
    const g = generateNoGuess(spec({ seed: `shape-sound-${i}`, firstClick: (i * 53) % 256 }), { maxAttempts: 3000 })
    assert.ok(g, 'generation must succeed')
    const b = createBoard(g.spec)
    open(b, g.spec.firstClick)

    for (let step = 0; step < 200; step++) {
      const view = solverView(b)
      for (const s of findShapes(view)) {
        for (const c of s.safe) {
          assert.equal(b.mines[c], 0, `shape ${s.id} called a mine safe at ${c}`)
          checked++
        }
        for (const c of s.mines) {
          assert.equal(b.mines[c], 1, `shape ${s.id} called a safe cell a mine at ${c}`)
          checked++
        }
      }

      const r = solve(view)
      if (r.deductions.length === 0) break
      let progressed = false
      for (const d of r.deductions) {
        for (const c of d.subject) {
          if (b.state[c] !== HIDDEN) continue
          if (d.verdict === 'safe') open(b, c)
          else toggleFlag(b, c)
          progressed = true
        }
      }
      if (!progressed || b.exploded) break
    }
  }
  assert.ok(checked > 500, `expected a real sample, only checked ${checked} claims`)
})

test('shape ids are canonical: a run reads the same from either end', () => {
  const g = generateNoGuess(spec(), { maxAttempts: 3000 })
  assert.ok(g)
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  for (const s of findShapes(solverView(b))) {
    const rev = s.id.split('-').reverse().join('-')
    assert.ok(s.id <= rev, `id ${s.id} is not the canonical orientation`)
    assert.ok(!s.id.includes('0'), `a spent number should never reach a run id: ${s.id}`)
  }
})

test('every shape occurrence forces at least one cell', () => {
  const g = generateNoGuess(spec({ seed: 'shape-forces' }), { maxAttempts: 3000 })
  assert.ok(g)
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  const shapes = findShapes(solverView(b))
  assert.ok(shapes.length > 0, 'an opened expert board should contain readable shapes')
  for (const s of shapes) {
    assert.ok(s.safe.length + s.mines.length > 0, `${s.id} was reported without forcing anything`)
    assert.ok(s.witnesses.length >= 2, `${s.id} has fewer than two witnesses`)
  }
})

test('the curriculum contains no single-number reads', () => {
  for (const p of PATTERNS) {
    assert.ok(!isPrimitive(p.id), `${p.id} is a solver primitive, not a lesson`)
    assert.ok(
      p.id.split('-').length >= 2 || p.tier === 4,
      `${p.id} has no interacting numbers, so it has no depth to teach`,
    )
  }
  // They still have to be nameable, or the coach cannot explain a one-number move.
  assert.equal(PRIMITIVES.length, 2)
  for (const p of PRIMITIVES) assert.ok(isPrimitive(p.id))
})

test('prerequisites stay inside the taught catalogue', () => {
  const ids = new Set(PATTERNS.map((p) => p.id))
  for (const p of PATTERNS) {
    for (const r of p.requires) {
      assert.ok(ids.has(r), `${p.id} requires ${r}, which is not taught`)
      assert.ok(!isPrimitive(r), `${p.id} requires the primitive ${r}`)
    }
  }
})

/**
 * The finding that motivated `shapes.ts`. 1-2-1 decomposes into two 1-2 reads,
 * so irreducible-proof counting reports it as vanishingly rare while the shape
 * is all over the board. If this ever inverts, the two metrics have collapsed
 * into one and the teaching order is being driven by the wrong number again.
 */
test('occurrence and irreducible-proof counts measure different things', () => {
  const specs: BoardSpec[] = []
  for (let i = 0; i < 12; i++) {
    const g = generateNoGuess(spec({ seed: `freq-${i}`, firstClick: (i * 37) % 256 }), { maxAttempts: 3000 })
    if (g) specs.push(g.spec)
  }
  const report = measureFrequency(specs)

  const seen = report.occurrences.get('1-2-1') ?? 0
  const fired = report.frequency.get('1-2-1') ?? 0
  assert.ok(seen > 0, '1-2-1 must show up as a shape on real expert boards')
  assert.ok(seen > fired * 5, `1-2-1 seen ${seen} vs fired ${fired}: the two metrics have collapsed`)

  // The primitives dominate irreducible proofs and are absent from shapes,
  // which is the whole reason the curriculum cannot be ordered by firings.
  const primitiveFirings = (report.frequency.get('satisfied') ?? 0) + (report.frequency.get('forced') ?? 0)
  const allFirings = [...report.frequency.values()].reduce((a, b) => a + b, 0)
  assert.ok(primitiveFirings / allFirings > 0.8, 'primitives should dominate irreducible proofs')
  assert.equal(report.occurrences.get('satisfied'), undefined)
  assert.equal(report.occurrences.get('forced'), undefined)
})
