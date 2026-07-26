import { createBoard, open, toggleFlag, isWon, solverView, type Board, type BoardSpec } from './board.ts'
import { solve } from './solver/index.ts'
import { FLAGGED, HIDDEN } from './types.ts'
import { randomSeed } from './rng.ts'

export interface SolveRun {
  solved: boolean
  /** stalled with cells still hidden — the board needs a guess */
  stalled: boolean
  steps: number
}

/**
 * Plays the board out using only certain deductions. Never guesses.
 * This is both the no-guess acceptance test and the HZiNi information oracle.
 */
export function solveFully(b: Board, maxComponent = 24): SolveRun {
  let steps = 0
  for (;;) {
    if (isWon(b) || b.exploded) return { solved: isWon(b), stalled: false, steps }
    const r = solve(solverView(b), { maxComponent })
    if (r.stuck) return { solved: false, stalled: true, steps }

    let changed = false
    for (const d of r.deductions) {
      for (const c of d.subject) {
        if (b.state[c] !== HIDDEN) continue
        if (d.verdict === 'safe') {
          open(b, c)
          changed = true
        } else {
          toggleFlag(b, c)
          changed = true
        }
      }
    }
    steps++
    if (!changed) return { solved: isWon(b), stalled: true, steps }
  }
}

export interface GenerateResult {
  spec: BoardSpec
  attempts: number
  ms: number
}

/**
 * Rejection sampling for no-guess boards (§4.4). Expensive at expert, which is
 * why this runs in a worker behind a pre-generated pool.
 */
export function generateNoGuess(
  base: Omit<BoardSpec, 'seed'>,
  opts: { maxAttempts?: number; rand?: () => number; maxComponent?: number } = {},
): GenerateResult | null {
  const maxAttempts = opts.maxAttempts ?? 2000
  const rand = opts.rand ?? Math.random
  const t0 = Date.now()

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const spec: BoardSpec = { ...base, seed: randomSeed(rand) }
    const scratch = createBoard(spec)
    open(scratch, spec.firstClick)
    const run = solveFully(scratch, opts.maxComponent)
    if (run.solved) return { spec, attempts: attempt, ms: Date.now() - t0 }
  }
  return null
}

/** Count flags placed, for the HUD mine counter. */
export function flagsPlaced(b: Board): number {
  let n = 0
  for (let i = 0; i < b.state.length; i++) if (b.state[i] === FLAGGED) n++
  return n
}
