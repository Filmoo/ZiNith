import { neighborIndex } from '../neighbors.ts'
import { HIDDEN, REVEALED, type CellId, type SolverView } from '../types.ts'
import { effectiveCount, type PatternId } from './patterns.ts'

/**
 * Shape occurrence — how often a named pattern is *on the board doing work*,
 * as opposed to how often it is the irreducible proof of something.
 *
 * These are different questions and the difference is not academic. The solver
 * attributes every deduction to its minimal witness set, so a textbook 1-2-1 is
 * never credited as `1-2-1`: it decomposes into two overlapping 1-2 reads plus a
 * satisfied number, each of which is a strictly smaller proof. Minimal-proof
 * instrumentation therefore reports 1-2-1 at ~0.04% of firings, which is true
 * and also useless for teaching — the shape is all over an expert board, and a
 * player who recognises the whole gestalt reads it in one glance instead of
 * three.
 *
 * So this module measures the other thing. It scans for collinear runs of
 * revealed numbers, works out what each run forces on its own, and names the run
 * by its effective counts. A shape counts as occurring whenever it is present
 * and resolves at least one cell, whether or not something cheaper also would
 * have. That is the number teaching order should follow, because it is the one
 * that predicts what you will actually see.
 */

export interface ShapeOccurrence {
  /** Count signature, canonicalised against its own reverse: `1-2-1`, `1-2`, … */
  id: PatternId
  /** The revealed numbers making up the run, in board order. */
  witnesses: CellId[]
  safe: CellId[]
  mines: CellId[]
}

/** Longest run considered. 1-2-2-1 is four, and nothing named is longer. */
const MAX_RUN = 4
/** Enumeration guard. A four-run touches at most ~10 hidden cells. */
const MAX_HIDDEN = 14

/**
 * Every named shape currently on the board that forces at least one cell.
 *
 * Runs are enumerated at every length from 2 to `MAX_RUN`, so a 1-2-1 is
 * reported alongside the 1-2 runs nested inside it. That overlap is deliberate:
 * both readings are genuinely available to the player, and collapsing to the
 * smallest would rebuild exactly the bias this module exists to correct.
 */
export function findShapes(view: SolverView): ShapeOccurrence[] {
  const { width, height } = view
  const ni = neighborIndex(width, height)
  const out: ShapeOccurrence[] = []

  const hiddenNeighbours = (cell: CellId): CellId[] => {
    const hs: CellId[] = []
    for (let k = 0; k < ni.count[cell]; k++) {
      const nb = ni.table[cell * 8 + k]
      if (view.state[nb] === HIDDEN) hs.push(nb)
    }
    return hs
  }

  const usable = (cell: CellId): boolean =>
    view.state[cell] === REVEALED && effectiveCount(view, cell) > 0

  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let len = 2; len <= MAX_RUN; len++) {
          const ex = x + dx * (len - 1)
          const ey = y + dy * (len - 1)
          if (ex >= width || ey >= height) break

          const run: CellId[] = []
          let ok = true
          for (let i = 0; i < len && ok; i++) {
            const c = (y + dy * i) * width + (x + dx * i)
            if (!usable(c)) ok = false
            else run.push(c)
          }
          if (!ok) continue

          const occ = solveRun(view, run, hiddenNeighbours)
          if (occ) out.push(occ)
        }
      }
    }
  }

  return out
}

/**
 * What a single run forces, considered in isolation.
 *
 * Brute force over the run's own hidden cells. The run is at most four numbers
 * so the union is small, and unlike the real solver this deliberately ignores
 * every constraint outside the run — the question being asked is what *this
 * shape* tells you, not what the position as a whole does.
 */
function solveRun(
  view: SolverView,
  run: CellId[],
  hiddenNeighbours: (c: CellId) => CellId[],
): ShapeOccurrence | null {
  const index = new Map<CellId, number>()
  const cells: CellId[] = []
  const constraints: Array<{ mask: number; count: number }> = []

  for (const w of run) {
    const hs = hiddenNeighbours(w)
    if (hs.length === 0) return null
    let mask = 0
    for (const h of hs) {
      let i = index.get(h)
      if (i === undefined) {
        i = cells.length
        if (i >= MAX_HIDDEN) return null
        index.set(h, i)
        cells.push(h)
      }
      mask |= 1 << i
    }
    constraints.push({ mask, count: effectiveCount(view, w) })
  }

  const n = cells.length
  if (n === 0) return null

  let solutions = 0
  let alwaysMine = (1 << n) - 1
  let alwaysSafe = (1 << n) - 1

  for (let assign = 0; assign < 1 << n; assign++) {
    let valid = true
    for (const c of constraints) {
      if (popcount(assign & c.mask) !== c.count) { valid = false; break }
    }
    if (!valid) continue
    solutions++
    alwaysMine &= assign
    alwaysSafe &= ~assign
  }

  // No consistent assignment means the run contradicts itself, which only
  // happens when the player has misflagged. Not a shape; not a lesson.
  if (solutions === 0) return null
  if (alwaysMine === 0 && alwaysSafe === 0) return null

  const mines: CellId[] = []
  const safe: CellId[] = []
  for (let i = 0; i < n; i++) {
    if (alwaysMine & (1 << i)) mines.push(cells[i])
    else if (alwaysSafe & (1 << i)) safe.push(cells[i])
  }

  return { id: signatureOf(view, run), witnesses: run, safe, mines }
}

/**
 * Name the run by its effective counts, canonicalised against its own reverse so
 * a 2-1 and a 1-2 are one lesson rather than two.
 */
function signatureOf(view: SolverView, run: CellId[]): PatternId {
  const counts = run.map((c) => effectiveCount(view, c))
  const fwd = counts.join('-')
  const rev = [...counts].reverse().join('-')
  return fwd <= rev ? fwd : rev
}

function popcount(x: number): number {
  let n = 0
  for (let v = x; v !== 0; v &= v - 1) n++
  return n
}
