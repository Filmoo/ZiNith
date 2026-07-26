import type { Board } from './board'
import { countSafeCells, createBoard, floodOpen } from './board'
import type { BoardSpec } from './presets'
import { validateSpec } from './presets'
import { makeRng, sample } from './rng'
import { solve, viewFromBoard } from './solver'
import { topology } from './topology'

/**
 * Board generation (§4.4).
 *
 * No-guess is the default for every preset, which makes this load-bearing
 * rather than a nicety. Generation is rejection sampling: place mines at
 * random, ask the solver whether the board falls out from the opening click,
 * discard it if it does not. Expert is the expensive case — hence the
 * pre-generated pool in P3, which this module feeds.
 *
 * The opening cell is chosen by the generator, not the player. A pool cannot
 * know where someone will click, so a pooled board carries the start it was
 * proven solvable from and the game opens it on the player's behalf. Guess-mode
 * boards have no such constraint and are generated around the actual click.
 */

export interface GeneratedBoard {
  readonly board: Board
  readonly seed: number
  /**
   * The cell this board was proven solvable from. Always a zero, so opening it
   * yields an opening rather than a bare number.
   */
  readonly firstClick: number
  /** Rejection-sampling attempts spent. Instrumentation for pool tuning. */
  readonly attempts: number
}

export interface NoGuessOptions {
  /** Give up after this many rejected boards. */
  readonly maxAttempts?: number
  /** Passed through to the tank solver. */
  readonly enumerationBudget?: number
  /** Abort early — the pool refills on idle and must yield to the UI. */
  readonly shouldStop?: () => boolean
}

export class GenerationFailed extends Error {
  readonly attempts: number
  constructor(attempts: number) {
    super(`no no-guess board found in ${attempts} attempts`)
    this.attempts = attempts
  }
}

/**
 * Place mines uniformly at random, keeping `safeCell` and its neighbours clear
 * so the first click always opens into a zero.
 */
export function generateBoard(spec: BoardSpec, seed: number, safeCell: number): Board {
  validateSpec(spec)
  const topo = topology(spec.width, spec.height)
  if (safeCell < 0 || safeCell >= topo.size) throw new RangeError('safe cell outside board')

  const reserved = new Uint8Array(topo.size)
  reserved[safeCell] = 1
  for (const n of topo.neighbours[safeCell]) reserved[n] = 1

  const candidates: number[] = []
  for (let i = 0; i < topo.size; i++) if (reserved[i] === 0) candidates.push(i)
  if (candidates.length < spec.mines) {
    throw new RangeError(
      `${spec.mines} mines will not fit around a guaranteed opening on ${spec.width}×${spec.height}`,
    )
  }

  const rng = makeRng(seed)
  const picked = sample(rng, candidates.length, spec.mines).map((i) => candidates[i])
  return createBoard(spec, picked)
}

/**
 * Guess-mode generation (§4.4): skip the solver entirely. Instant, so it runs on
 * the player's actual first click and needs no pool.
 */
export function generateGuessBoard(
  spec: BoardSpec,
  seed: number,
  firstClick: number,
): GeneratedBoard {
  return { board: generateBoard(spec, seed, firstClick), seed, firstClick, attempts: 1 }
}

/**
 * Can this board be cleared from `firstClick` with no guess at any point?
 *
 * Opens everything the solver proves safe, marks what it proves is a mine, and
 * repeats. Stuck with cells left over means the board needs a guess. A
 * component that blows the enumeration budget counts as a failure: the answer
 * is unknown, and shipping a board we could not verify defeats the point.
 */
export function isNoGuess(board: Board, firstClick: number, enumerationBudget?: number): boolean {
  if (board.mine[firstClick] === 1) return false
  const size = board.width * board.height
  const revealed = new Uint8Array(size)
  const safeTotal = countSafeCells(board)
  let revealedCount = floodOpen(board, revealed, firstClick)

  while (revealedCount < safeTotal) {
    const result = solve(
      viewFromBoard(board, revealed),
      enumerationBudget === undefined ? {} : { enumerationBudget },
    )
    if (!result.exhaustive) return false
    if (result.safe.length === 0) return false
    for (const cell of result.safe) {
      // The solver is sound, so this should never fire — but a wrong "safe"
      // would silently ship an unsolvable board, so it is worth the branch.
      if (board.mine[cell] === 1) return false
      revealedCount += floodOpen(board, revealed, cell)
    }
  }
  return true
}

/**
 * Rejection-sample until a no-guess board turns up.
 *
 * The opening cell is redrawn on every attempt. Holding it fixed cuts the
 * acceptance rate substantially — some starts on a given mine layout are simply
 * not solvable — and the pool has no reason to prefer one start over another.
 */
export function generateNoGuessBoard(
  spec: BoardSpec,
  seed: number,
  options: NoGuessOptions = {},
): GeneratedBoard {
  validateSpec(spec)
  const { maxAttempts = 20_000, enumerationBudget, shouldStop } = options
  const topo = topology(spec.width, spec.height)
  const rng = makeRng(seed)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (shouldStop?.()) throw new GenerationFailed(attempt - 1)

    // Derive a per-attempt seed from the stream so the whole run reproduces
    // from the single seed the replay stores.
    const attemptSeed = rng.state()
    rng.next()
    const firstClick = rng.int(topo.size)

    let board: Board
    try {
      board = generateBoard(spec, attemptSeed, firstClick)
    } catch {
      // Mines do not fit around this particular opening; try another.
      continue
    }

    if (isNoGuess(board, firstClick, enumerationBudget)) {
      return { board, seed: attemptSeed, firstClick, attempts: attempt }
    }
  }

  throw new GenerationFailed(maxAttempts)
}
