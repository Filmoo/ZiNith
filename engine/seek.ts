import { chord, createBoard, open, toggleFlag, type Board } from './board.ts'
import { specOf, type Replay, type ReplayEvent } from './replay.ts'
import { HIDDEN } from './types.ts'

/**
 * Replay reconstruction for the scrubber (§14.3).
 *
 * Scrubbing to an arbitrary move is a full re-simulation from the seed rather
 * than a stored snapshot per move. That sounds wasteful and is not: the board is
 * a few Uint8Arrays and an expert game is ~200 events, so a seek is microseconds
 * and costs no storage. It also cannot drift out of sync with the real rules,
 * which a snapshot cache eventually would.
 */

/** Apply one event exactly as the controller would have. */
export function applyEvent(b: Board, e: ReplayEvent): void {
  if (e.type === 'open') {
    if (b.state[e.cell] === HIDDEN) open(b, e.cell)
  } else if (e.type === 'chord') {
    chord(b, e.cell)
  } else {
    toggleFlag(b, e.cell)
  }
}

/**
 * The board as it stood after `moveCount` events. `moveCount === 0` is the
 * board before the first click — generated, but untouched.
 */
export function stateAfter(r: Replay, moveCount: number): Board {
  const b = createBoard(specOf(r))
  const n = Math.max(0, Math.min(moveCount, r.events.length))
  for (let i = 0; i < n; i++) applyEvent(b, r.events[i])
  return b
}

/** The state a given move was decided from — what the coach graded against. */
export function stateBefore(r: Replay, moveIndex: number): Board {
  return stateAfter(r, moveIndex)
}
