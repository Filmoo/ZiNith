import { describe, expect, it } from 'vitest'
import { createBoard } from './board'
import {
  GenerationFailed,
  generateBoard,
  generateGuessBoard,
  generateNoGuessBoard,
  isNoGuess,
} from './generate'
import { PRESETS, PRESET_ORDER } from './presets'
import { topology } from './topology'

describe('placement', () => {
  it('keeps the first click and its neighbours clear so it opens a zero', () => {
    for (let seed = 0; seed < 30; seed++) {
      const spec = PRESETS.intermediate
      const safeCell = seed * 7 + 20
      const board = generateBoard(spec, seed, safeCell)
      expect(board.mine[safeCell]).toBe(0)
      expect(board.adjacent[safeCell]).toBe(0)
      for (const n of topology(spec.width, spec.height).neighbours[safeCell]) {
        expect(board.mine[n]).toBe(0)
      }
    }
  })

  it('places exactly the requested number of mines', () => {
    for (const id of PRESET_ORDER) {
      const spec = PRESETS[id]
      const board = generateBoard(spec, 99, 0)
      let count = 0
      for (const m of board.mine) count += m
      expect(count).toBe(spec.mines)
    }
  })

  it('is reproducible from its seed (§14.3)', () => {
    const a = generateBoard(PRESETS.expert, 123456, 40)
    const b = generateBoard(PRESETS.expert, 123456, 40)
    expect([...a.mine]).toEqual([...b.mine])
  })

  it('refuses a board too dense to leave room for an opening', () => {
    // 3x3 with 8 mines: the reserved zone around any cell is the whole board.
    expect(() => generateBoard({ width: 3, height: 3, mines: 8 }, 1, 4)).toThrow(RangeError)
  })
})

describe('isNoGuess', () => {
  it('accepts a board that falls out from the opening', () => {
    const { board, firstClick } = generateNoGuessBoard(PRESETS.beginner, 2024, {
      maxAttempts: 500,
    })
    expect(isNoGuess(board, firstClick)).toBe(true)
  })

  it('rejects a board with an unavoidable 50/50', () => {
    // Mines above and below a corridor: the two cells beside the 1 are
    // indistinguishable and the counter does not separate them.
    const rows = ['.*.', '...', '.*.']
    const width = 3
    const mines: number[] = []
    rows.forEach((row, y) => {
      ;[...row].forEach((ch, x) => {
        if (ch === '*') mines.push(y * width + x)
      })
    })
    const board = createBoard({ width, height: 3, mines: 2 }, mines)
    expect(isNoGuess(board, 4)).toBe(false)
  })

  it('agrees with the board it just accepted, every time', () => {
    // Round-trip: whatever the generator hands back must survive re-checking.
    for (let seed = 0; seed < 25; seed++) {
      const { board, firstClick } = generateNoGuessBoard(PRESETS.intermediate, seed + 60, {
        maxAttempts: 1000,
      })
      expect(isNoGuess(board, firstClick)).toBe(true)
    }
  })
})

describe('no-guess generation', () => {
  it('produces a solvable board for every preset (§4.4)', () => {
    for (const id of PRESET_ORDER) {
      const spec = PRESETS[id]
      const result = generateNoGuessBoard(spec, 7, { maxAttempts: 3000 })
      expect(result.attempts).toBeGreaterThan(0)
      expect(isNoGuess(result.board, result.firstClick)).toBe(true)
      let count = 0
      for (const m of result.board.mine) count += m
      expect(count).toBe(spec.mines)
    }
  })

  it('reproduces the same board from the seed it reports', () => {
    const result = generateNoGuessBoard(PRESETS.expert, 88, { maxAttempts: 3000 })
    // The returned seed is the accepted attempt's seed, not the run's seed, so
    // a replay can rebuild the board without re-running the search.
    const rebuilt = generateBoard(PRESETS.expert, result.seed, result.firstClick)
    expect([...rebuilt.mine]).toEqual([...result.board.mine])
  })

  it('gives up rather than spinning forever', () => {
    expect(() =>
      generateNoGuessBoard({ width: 5, height: 5, mines: 20 }, 1, { maxAttempts: 40 }),
    ).toThrow(GenerationFailed)
  })

  it('honours an abort request from the pool', () => {
    // Unconditional: a "stop after N attempts" abort races the search, which
    // finds an Expert board in a handful of attempts often enough to flake.
    expect(() =>
      generateNoGuessBoard(PRESETS.expert, 5, { maxAttempts: 5000, shouldStop: () => true }),
    ).toThrow(GenerationFailed)
  })
})

describe('guess-mode generation', () => {
  it('skips the solver entirely (§4.4)', () => {
    const result = generateGuessBoard(PRESETS.expert, 11, 40)
    expect(result.attempts).toBe(1)
    expect(result.board.adjacent[40]).toBe(0)
  })
})
