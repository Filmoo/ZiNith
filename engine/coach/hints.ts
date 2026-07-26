import type { CellId, SolverView } from '../types.ts'
import { provableIn } from './grade.ts'
import { patternOf, type PatternId } from './patterns.ts'

/**
 * Live hints for learning mode (§7.3, §8.2).
 *
 * Timed play never calls this — §8.2 is explicit that the solver stays off the
 * board while the clock runs. Learning mode is the one surface where a solver
 * call per state change is allowed, and §7.3 puts it in a worker for exactly
 * that reason.
 *
 * It reports *every* certainty rather than one suggestion. Optimal is rarely
 * unique, and showing a single "best move" would be a lie about a position with
 * four equally good ones — the same trap §7.3 flags for move blocking. Highlight
 * everything provable and let the player pick.
 */
export interface Hints {
  /** Cells provably safe to open. */
  safe: CellId[]
  /** Cells provably mined. */
  mine: CellId[]
  /** The proof for one of them, minimised — what an explanation would draw. */
  witnesses: CellId[]
  /** Named shape for that proof, when it has one. */
  patternId?: PatternId
  /** Nothing is provable: the board genuinely requires a guess. */
  stuck: boolean
}

export function hintsFor(view: SolverView): Hints {
  const av = provableIn(view)
  const safe = [...av.safe]
  const mine = [...av.mine]

  // Prefer explaining a safe cell: it is the move the player is about to make.
  // Falling back to a mine keeps the explanation non-empty on flag-only turns.
  const focus = safe[0] ?? mine[0]
  const proof = focus === undefined ? undefined : av.proofOf.get(focus)
  if (!proof) return { safe, mine, witnesses: [], stuck: !av.any }

  const named = patternOf(view, proof)
  return {
    safe,
    mine,
    witnesses: named.deduction.witnesses,
    patternId: named.id,
    stuck: !av.any,
  }
}
