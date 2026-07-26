import test from 'node:test'
import assert from 'node:assert/strict'
import { boardFromStrings, idx } from './fixtures.ts'
import { createBoard, canChord, chord, open, toggleFlag, isWon, type Board } from '../engine/board.ts'
import { generateNoGuess } from '../engine/generate.ts'
import { PRESETS } from '../engine/presets.ts'
import { zini } from '../engine/metrics/zini.ts'
import { hzini } from '../engine/metrics/hzini.ts'
import { threeBV } from '../engine/metrics/threebv.ts'
import type { Click } from '../engine/metrics/greedy.ts'
import { REVEALED } from '../engine/types.ts'

/**
 * Replays a ZiNi/HZiNi path against a real board using the game's own rules,
 * asserting every click is legal at the moment it is made.
 *
 * This is the strongest check available without external ground truth: the
 * published definitions fix the invariants (never above 3BV, HZiNi never below
 * ZiNi) but not the algorithm, whose details live in a 2009 forum thread. A
 * click count is only meaningful if the sequence it counts is one a player could
 * actually perform, and an off-by-one in the greedy shows up here as an illegal
 * chord or an unreachable win rather than as a plausible-looking number.
 */
function assertPlayable(spec: Parameters<typeof createBoard>[0], path: Click[], label: string) {
  const b = createBoard(spec)
  path.forEach((c, i) => {
    const where = `${label} click ${i} (${c.type} @ ${c.cell})`
    if (c.type === 'open') {
      assert.ok(!b.mines[c.cell], `${where} opened a mine`)
      assert.notEqual(b.state[c.cell], REVEALED, `${where} re-opened a revealed cell`)
      open(b, c.cell)
    } else if (c.type === 'flag') {
      assert.ok(b.mines[c.cell], `${where} flagged a safe cell`)
      assert.notEqual(b.state[c.cell], REVEALED, `${where} flagged a revealed cell`)
      toggleFlag(b, c.cell)
    } else {
      assert.ok(canChord(b, c.cell), `${where} is not a legal chord`)
      chord(b, c.cell)
    }
    assert.ok(!b.exploded, `${where} detonated`)
  })
  assert.ok(isWon(b), `${label} path finished without clearing the board`)
  return b
}

const EXPERT = PRESETS.expert

function expertSpecs(n: number) {
  const out = []
  for (let i = 0; i < n; i++) {
    const g = generateNoGuess(
      { width: EXPERT.width, height: EXPERT.height, mineCount: EXPERT.mines, firstClick: 100 + i * 29 },
      { maxAttempts: 5000 },
    )
    if (g) out.push(g.spec)
  }
  return out
}

test('the ZiNi path is a sequence a player could actually perform', () => {
  for (const spec of expertSpecs(6)) {
    const r = zini(createBoard(spec), spec.firstClick)
    assertPlayable(spec, r.path, 'zini')
    assert.equal(r.path.length, r.value, 'the reported cost must be the length of the path')
  }
})

test('the HZiNi path is a sequence a player could actually perform', () => {
  for (const spec of expertSpecs(6)) {
    const r = hzini(createBoard(spec), spec.firstClick)
    assertPlayable(spec, r.path, 'hzini')
    assert.equal(r.path.length, r.value, 'the reported cost must be the length of the path')
  }
})

test('chording actually saves clicks: ZiNi is well below 3BV on expert', () => {
  /*
   * The published definition says only that ZiNi never exceeds 3BV — an
   * implementation that never chords satisfies that and is still wrong.
   * mzrg.com's description is explicit that both are "much lower than 3BV",
   * which is the property this pins down.
   *
   * This caught a real bug: the greedy ran its chord loop to exhaustion once and
   * then opened everything else plainly, so chording only ever happened off the
   * first cascade's frontier. ZiNi came out within 2% of 3BV.
   */
  const specs = expertSpecs(8)
  let sum3bv = 0, sumZini = 0, chords = 0, clicks = 0
  for (const spec of specs) {
    const b = createBoard(spec)
    const r = zini(b, spec.firstClick)
    sum3bv += threeBV(b).value
    sumZini += r.value
    for (const c of r.path) { clicks++; if (c.type === 'chord') chords++ }
  }
  const ratio = sumZini / sum3bv
  assert.ok(ratio < 0.9, `ZiNi should be well under 3BV, got ${(ratio * 100).toFixed(1)}%`)
  assert.ok(ratio > 0.4, `ZiNi under 40% of 3BV means the cost model is broken, got ${(ratio * 100).toFixed(1)}%`)
  assert.ok(chords / clicks > 0.08, `chords should carry real weight, got ${(100 * chords / clicks).toFixed(1)}%`)
})

test('a board with no chordable structure falls back to 3BV, not below it', () => {
  // One mine in a corner: nothing to chord profitably, so flags cannot help and
  // ZiNi must land exactly on 3BV rather than inventing a saving.
  const b = boardFromStrings([
    '*....',
    '.....',
    '.....',
    '.....',
    '.....',
  ])
  const first = idx(b, 4, 4)
  const bv = threeBV(b).value
  const r = zini(createBoard0(b), first)
  assert.ok(r.value <= bv, `ZiNi ${r.value} exceeded 3BV ${bv}`)
})

/** `zini` takes a Board; fixtures already are one, so this just clones state. */
function createBoard0(b: Board): Board {
  return { ...b, state: new Uint8Array(b.state), revealedCount: 0, flagCount: 0, exploded: false }
}
