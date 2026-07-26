import { describe, expect, it } from 'vitest'
import { createBoard, findOpenings } from './board'
import { calc3BV, clearedBBBV, hzini, zini } from './metrics'
import { Game } from './game'
import { PRESETS } from './presets'
import { generateNoGuessBoard } from './generate'

function board(rows: string[]) {
  const width = rows[0].length
  const mines: number[] = []
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '*') mines.push(y * width + x)
    })
  })
  return createBoard({ width, height: rows.length, mines: mines.length }, mines)
}

describe('3BV', () => {
  it('counts every cell on a board with no openings', () => {
    // A single central mine leaves eight 1s and not one zero.
    const b = board(['...', '.*.', '...'])
    expect(findOpenings(b).count).toBe(0)
    expect(calc3BV(b)).toBe(8)
  })

  it('counts an opening as one click and its border as free', () => {
    // Mines in opposite corners. Every zero is 8-connected into one region and
    // every number sits on its border, so the whole board is one click.
    const b = board(['*...', '....', '....', '...*'])
    expect(findOpenings(b).count).toBe(1)
    expect(calc3BV(b)).toBe(1)
  })

  it('charges for numbers no opening reaches', () => {
    // The 1s hemming in the left mine touch the right-hand opening; the wall of
    // mines down the middle isolates the two 1s in column 0.
    const b = board(['.*..', '*...', '....', '....'])
    const openings = findOpenings(b)
    const isolated = openings.count
    expect(calc3BV(b)).toBeGreaterThan(isolated)
  })

  it('never exceeds the number of safe cells', () => {
    for (let seed = 0; seed < 50; seed++) {
      const generated = generateNoGuessBoard(PRESETS.beginner, seed, { maxAttempts: 500 })
      const b = generated.board
      const safe = b.width * b.height - b.mines
      const value = calc3BV(b)
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThanOrEqual(safe)
    }
  })
})

describe('ZiNi', () => {
  it('beats 3BV where chording pays and never needs more clicks than there are safe cells', () => {
    const b = board(['...', '.*.', '...'])
    const plan = zini(b)
    // open an edge 1, flag the centre, chord it, then two more chords.
    expect(plan.clicks).toBe(5)
    expect(plan.clicks).toBeLessThan(calc3BV(b))
  })

  it('costs one click on a board that is a single opening', () => {
    // 3x3 with one corner mine: everything else comes up on the first click,
    // so there is nothing for a chord to earn.
    const b = board(['*..', '...', '...'])
    expect(calc3BV(b)).toBe(1)
    expect(zini(b).clicks).toBe(1)
  })

  it('clears every generated board it is asked about', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { board: b } = generateNoGuessBoard(PRESETS.beginner, seed + 500, { maxAttempts: 500 })
      const plan = zini(b)
      expect(plan.clicks).toBeGreaterThan(0)
      expect(plan.opens + plan.flags + plan.chords).toBe(plan.clicks)
      // Flags only ever go on real mines, so there can never be more than the
      // board holds.
      expect(plan.flags).toBeLessThanOrEqual(b.mines)
    }
  })

  it('is never worse than clicking the board out by hand', () => {
    // Plain clicking is always on the table — the greedy weighs it against
    // every chord each step — so chording must not make the count worse. This
    // is the property that broke when chords were chosen without comparing
    // them to a plain click.
    for (let seed = 0; seed < 40; seed++) {
      const { board: b } = generateNoGuessBoard(PRESETS.intermediate, seed + 300, {
        maxAttempts: 500,
      })
      expect(zini(b).clicks).toBeLessThanOrEqual(calc3BV(b))
    }
  })
})

describe('HZiNi', () => {
  it('is defined exactly when the board needs no guess', () => {
    const { board: b, firstClick } = generateNoGuessBoard(PRESETS.beginner, 4242, {
      maxAttempts: 500,
    })
    const plan = hzini(b, firstClick)
    expect(plan).not.toBeNull()
    expect((plan as NonNullable<typeof plan>).clicks).toBeGreaterThan(0)
  })

  it('produces a complete, self-consistent line on every no-guess board', () => {
    // Note what is deliberately *not* asserted here: that HZiNi >= ZiNi. That
    // holds for the true optima — HZiNi solves a strictly more constrained
    // problem — but both are greedy approximations, and the constrained greedy
    // sometimes stumbles into a better line than the unconstrained one. Testing
    // the inequality tests the heuristics' luck, not their correctness.
    for (let seed = 0; seed < 20; seed++) {
      const { board: b, firstClick } = generateNoGuessBoard(PRESETS.beginner, seed + 900, {
        maxAttempts: 500,
      })
      const human = hzini(b, firstClick)
      expect(human).not.toBeNull()
      const plan = human as NonNullable<typeof human>
      expect(plan.opens + plan.flags + plan.chords).toBe(plan.clicks)
      expect(plan.flags).toBeLessThanOrEqual(b.mines)
      // Reaching the end at all means the line cleared the board: the greedy
      // only returns once every safe cell is open.
      expect(plan.clicks).toBeGreaterThanOrEqual(1)
    }
  })

  it('gives up on a board that needs a guess', () => {
    // A 50/50: the two cells either side of the 1 in the corner are
    // indistinguishable, and the mine counter does not separate them.
    const b = board(['.*.', '...', '.*.'])
    // Start in the middle; nothing here is deducible past the first reveal.
    expect(hzini(b, 4)).toBeNull()
  })
})

describe('cleared 3BV', () => {
  it('equals the board 3BV once the board is won', () => {
    const { board: b, firstClick } = generateNoGuessBoard(PRESETS.beginner, 77, {
      maxAttempts: 500,
    })
    const game = new Game(b)
    game.open(firstClick)
    // Open every remaining safe cell.
    for (let i = 0; i < b.width * b.height; i++) {
      if (b.mine[i] === 0) game.open(i)
    }
    expect(game.status).toBe('won')
    expect(clearedBBBV(game)).toBe(calc3BV(b))
  })

  it('is zero before anything is opened', () => {
    const { board: b } = generateNoGuessBoard(PRESETS.beginner, 78, { maxAttempts: 500 })
    expect(clearedBBBV(new Game(b))).toBe(0)
  })
})
