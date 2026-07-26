import type { BoardSpec } from './presets'
import { topology } from './topology'

/**
 * An immutable solved board: where the mines are, and what every cell's number
 * would read. Player-visible state lives in `game.ts` — a Board knows nothing
 * about what has been clicked.
 */
export interface Board {
  readonly width: number
  readonly height: number
  readonly mines: number
  /** 1 where a mine sits. Length `width * height`. */
  readonly mine: Uint8Array
  /** Adjacent mine count. Computed for mine cells too, but meaningless there. */
  readonly adjacent: Uint8Array
}

export function createBoard(spec: BoardSpec, mineIndices: Iterable<number>): Board {
  const { width, height } = spec
  const topo = topology(width, height)
  const mine = new Uint8Array(topo.size)

  let placed = 0
  for (const i of mineIndices) {
    if (i < 0 || i >= topo.size) throw new RangeError(`mine index ${i} outside board`)
    if (mine[i] === 1) throw new Error(`duplicate mine at index ${i}`)
    mine[i] = 1
    placed++
  }
  if (placed !== spec.mines) {
    throw new Error(`expected ${spec.mines} mines, received ${placed}`)
  }

  const adjacent = new Uint8Array(topo.size)
  for (let i = 0; i < topo.size; i++) {
    if (mine[i] === 0) continue
    for (const n of topo.neighbours[i]) adjacent[n]++
  }

  return { width, height, mines: spec.mines, mine, adjacent }
}

/**
 * Openings: 8-connected components of zero cells, together with the numbered
 * border that comes up with them. Clicking any cell of a component reveals the
 * whole thing in one click, which is what makes 3BV and ZiNi non-trivial.
 *
 * Computed once per board and reused by every metric.
 */
export interface Openings {
  /** Component id for zero cells, -1 for everything else. */
  readonly regionOf: Int32Array
  /** Cells revealed by clicking into each component: its zeros plus their border. */
  readonly reveal: readonly Int32Array[]
  readonly count: number
}

export function findOpenings(board: Board): Openings {
  const topo = topology(board.width, board.height)
  const regionOf = new Int32Array(topo.size).fill(-1)
  const reveal: Int32Array[] = []
  const stack: number[] = []
  // Marks border cells already added to the region under construction.
  const stamp = new Int32Array(topo.size).fill(-1)

  for (let start = 0; start < topo.size; start++) {
    if (board.adjacent[start] !== 0 || board.mine[start] === 1 || regionOf[start] !== -1) continue

    const id = reveal.length
    const cells: number[] = []
    stack.push(start)
    regionOf[start] = id

    while (stack.length > 0) {
      const cell = stack.pop() as number
      if (stamp[cell] !== id) {
        stamp[cell] = id
        cells.push(cell)
      }
      for (const n of topo.neighbours[cell]) {
        if (board.mine[n] === 1) continue
        if (board.adjacent[n] === 0) {
          if (regionOf[n] === -1) {
            regionOf[n] = id
            stack.push(n)
          }
        } else if (stamp[n] !== id) {
          // Numbered border: revealed with the opening, but does not extend it.
          stamp[n] = id
          cells.push(n)
        }
      }
    }

    reveal.push(Int32Array.from(cells))
  }

  return { regionOf, reveal, count: reveal.length }
}

/**
 * The cells a single left-click on `cell` would reveal on a fresh board — the
 * whole opening if it is a zero, otherwise just itself. Undefined for mines.
 */
export function revealSet(openings: Openings, cell: number): Int32Array {
  const region = openings.regionOf[cell]
  return region === -1 ? Int32Array.of(cell) : openings.reveal[region]
}

export function countSafeCells(board: Board): number {
  return board.width * board.height - board.mines
}

/**
 * Reveal a safe cell and, if it is a zero, its whole opening. Standalone rather
 * than a `Game` method because generation runs this millions of times while
 * hunting for a no-guess board and does not want the event log.
 *
 * Returns the number of newly revealed cells.
 */
export function floodOpen(board: Board, revealed: Uint8Array, cell: number): number {
  if (revealed[cell] === 1 || board.mine[cell] === 1) return 0
  const topo = topology(board.width, board.height)
  const stack = [cell]
  let count = 0
  while (stack.length > 0) {
    const current = stack.pop() as number
    if (revealed[current] === 1) continue
    revealed[current] = 1
    count++
    if (board.adjacent[current] !== 0) continue
    for (const n of topo.neighbours[current]) {
      if (revealed[n] === 0 && board.mine[n] === 0) stack.push(n)
    }
  }
  return count
}
