import { createBoard, open, toggleFlag, solverView, isWon, type Board } from '../engine/board.ts'
import { solve } from '../engine/solver/index.ts'
import { HIDDEN } from '../engine/types.ts'
import { mulberry32 } from '../engine/rng.ts'

export interface Violation {
  seed: string
  cell: number
  claimed: 'safe' | 'mine'
  rule: string
}

/**
 * Plays a board with the solver, checking every claim against ground truth.
 * When the solver stalls we open a known-safe cell to push the game into new
 * states — the point is to visit many partial positions, not to play fairly.
 */
export function auditBoard(
  width: number, height: number, mineCount: number, seed: string, rand: () => number,
): { violations: Violation[]; board: Board; stalls: number } {
  const n = width * height
  const firstClick = Math.floor(rand() * n)
  const b = createBoard({ width, height, mineCount, seed, firstClick })
  open(b, firstClick)

  const violations: Violation[] = []
  let stalls = 0
  let guard = 0

  while (!isWon(b) && !b.exploded && guard++ < 5000) {
    const r = solve(solverView(b))

    for (const d of r.deductions) {
      for (const c of d.subject) {
        const isMine = b.mines[c] === 1
        if (d.verdict === 'safe' && isMine) violations.push({ seed, cell: c, claimed: 'safe', rule: d.rule })
        if (d.verdict === 'mine' && !isMine) violations.push({ seed, cell: c, claimed: 'mine', rule: d.rule })
      }
    }
    if (violations.length > 0) break

    if (r.stuck) {
      stalls++
      const safe: number[] = []
      for (let i = 0; i < n; i++) if (b.state[i] === HIDDEN && !b.mines[i]) safe.push(i)
      if (safe.length === 0) break
      open(b, safe[Math.floor(rand() * safe.length)])
      continue
    }

    let changed = false
    for (const d of r.deductions) {
      for (const c of d.subject) {
        if (b.state[c] !== HIDDEN) continue
        if (d.verdict === 'safe') open(b, c)
        else toggleFlag(b, c)
        changed = true
      }
    }
    if (!changed) break
  }

  return { violations, board: b, stalls }
}

export function seededRandom(seed: number): () => number {
  return mulberry32(seed)
}
