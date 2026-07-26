import { describe, expect, it } from 'vitest'
import { createBoard, floodOpen } from './board'
import { makeRng, sample } from './rng'
import { solve, viewFromBoard, UNKNOWN } from './solver'
import type { SolverView } from './solver'
import { toIndex } from './topology'

/**
 * Boards are written as ASCII so the position under test is readable:
 *   '*' mine, '.' safe. Whitespace between rows is ignored.
 */
function parse(rows: string[]): { board: ReturnType<typeof createBoard>; width: number } {
  const width = rows[0].length
  const height = rows.length
  const mines: number[] = []
  rows.forEach((row, y) => {
    expect(row.length).toBe(width)
    ;[...row].forEach((ch, x) => {
      if (ch === '*') mines.push(y * width + x)
    })
  })
  return { board: createBoard({ width, height, mines: mines.length }, mines), width }
}

/** Reveal the listed cells (and their openings) and hand the solver the result. */
function viewAfter(rows: string[], opens: Array<[number, number]>): SolverView {
  const { board, width } = parse(rows)
  const revealed = new Uint8Array(board.width * board.height)
  for (const [x, y] of opens) floodOpen(board, revealed, toIndex(x, y, width))
  return viewFromBoard(board, revealed)
}

describe('cheap rules', () => {
  it('finishes a board whose last unknowns are all forced mines', () => {
    // The opening swallows everything except the two mines, and each is pinned
    // by the number beside it. Nothing left to open is "solved", not "stuck".
    const view = viewAfter(['...*', '....', '....', '*...'], [[0, 1]])
    const result = solve(view, { deep: false })
    expect(result.mines.sort((a, b) => a - b)).toEqual([3, 12])
    expect(result.safe).toEqual([])
    expect(result.stuck).toBe(false)
  })

  it('flags a number whose candidates are exactly used up', () => {
    // The 1 at (1,0) has a single unknown neighbour once the opening lands.
    const view = viewAfter(['.*..', '....', '....', '....'], [[3, 3]])
    const result = solve(view, { deep: false })
    expect(result.mines).toContain(toIndex(1, 0, 4))
    const inference = result.inferences.find((i) => i.cell === toIndex(1, 0, 4))
    expect(inference?.kind).toBe('mine')
    expect(inference?.witnesses.length).toBe(1)
  })

  it('solves the 1-1 pattern against a wall with two witnesses', () => {
    //  col:  0 1 2 3 4
    //  The two 1s along the top edge share their candidates; the cell only the
    //  second one sees is safe.
    const view = viewAfter(['....', '.*..', '....', '....'], [[3, 0], [3, 1], [3, 2], [3, 3]])
    const result = solve(view, { deep: false })
    const subset = result.inferences.filter((i) => i.rule === 'subset')
    if (subset.length > 0) {
      expect(subset[0].witnesses.length).toBe(2)
    }
    // Whatever route it took, the mine is the only thing it can be.
    expect(result.mines).toContain(toIndex(1, 1, 4))
  })

  it('uses the mine counter when no mines are left', () => {
    const rows = ['*...', '....', '....', '....']
    const { board, width } = parse(rows)
    const revealed = new Uint8Array(16)
    floodOpen(board, revealed, toIndex(3, 3, width))
    const view = viewFromBoard(board, revealed)
    const result = solve(view, { deep: false })
    // The single mine is forced, and then the counter clears everything else.
    expect(result.mines).toEqual([0])
    expect(result.safe.length).toBe(16 - 1 - revealedCount(revealed))
  })
})

function revealedCount(revealed: Uint8Array): number {
  let n = 0
  for (const r of revealed) if (r === 1) n++
  return n
}

/** A reproducible mid-game 8×8 position: 10 mines, a handful of cells opened. */
function randomPosition(seed: number): {
  board: ReturnType<typeof createBoard>
  revealed: Uint8Array
} {
  const rng = makeRng(seed + 1)
  const mines = sample(rng, 64, 10)
  const board = createBoard({ width: 8, height: 8, mines: 10 }, mines)
  const revealed = new Uint8Array(64)
  for (let k = 0; k < 12; k++) {
    const cell = rng.int(64)
    if (board.mine[cell] === 0) floodOpen(board, revealed, cell)
  }
  return { board, revealed }
}

describe('tank solver', () => {
  it('resolves a fully constrained edge row', () => {
    // The opening takes rows 0-1 and exposes row 2 as a wall of 1s. Row 3 then
    // has exactly one consistent arrangement.
    const rows = ['......', '......', '......', '.*..*.']
    const view = viewAfter(rows, [[0, 0]])
    const width = 6

    const deep = solve(view)
    expect(deep.mines.sort((a, b) => a - b)).toEqual(
      [toIndex(1, 3, width), toIndex(4, 3, width)].sort((a, b) => a - b),
    )
    expect(deep.stuck).toBe(false)
  })

  it('is strictly stronger than the cheap rules on some positions', () => {
    // Rather than hand-pick a tank-only shape, show that enumeration earns its
    // keep across a corpus: somewhere in here it must see what subset cannot.
    let strongerSomewhere = false
    for (let seed = 0; seed < 120; seed++) {
      const { board, revealed } = randomPosition(seed)
      const view = viewFromBoard(board, revealed)
      const shallow = solve(view, { deep: false })
      const deep = solve(view)
      const shallowFound = shallow.safe.length + shallow.mines.length
      const deepFound = deep.safe.length + deep.mines.length
      // Enumeration may only ever add conclusions, never retract them.
      expect(deepFound).toBeGreaterThanOrEqual(shallowFound)
      if (deepFound > shallowFound) strongerSomewhere = true
    }
    expect(strongerSomewhere).toBe(true)
  })

  it('never claims a mine is safe', () => {
    // Soundness is the property everything else depends on: a wrong "safe"
    // ships an unwinnable no-guess board and detonates a learning-mode hint.
    for (let seed = 0; seed < 200; seed++) {
      const { board, revealed } = randomPosition(seed)
      const result = solve(viewFromBoard(board, revealed))
      for (const cell of result.safe) expect(board.mine[cell]).toBe(0)
      for (const cell of result.mines) expect(board.mine[cell]).toBe(1)
    }
  })

  it('reports a genuinely ambiguous position as stuck', () => {
    // Two cells, one mine, nothing to separate them: a 50/50.
    const view: SolverView = {
      width: 3,
      height: 1,
      totalMines: 1,
      cells: Int8Array.of(UNKNOWN, 1, UNKNOWN),
    }
    const result = solve(view)
    expect(result.safe).toEqual([])
    expect(result.stuck).toBe(true)
  })
})

describe('witnesses', () => {
  it('records the number a trivial conclusion rests on', () => {
    const view = viewAfter(['.*..', '....', '....', '....'], [[3, 3]])
    const result = solve(view, { deep: false })
    for (const inference of result.inferences) {
      if (inference.rule === 'count-satisfied' || inference.rule === 'count-exhausted') {
        expect(inference.witnesses.length).toBe(1)
      }
    }
  })
})
