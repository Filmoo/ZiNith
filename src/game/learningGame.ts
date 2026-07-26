import { Game } from './controller.ts'
import { solverView } from '../../engine/board.ts'
import { FLAGGED } from '../../engine/types.ts'
import { provableIn, type Available } from '../../engine/coach/grade.ts'
import { patternOf, type PatternMatch } from '../../engine/coach/patterns.ts'

export type BlockReason = 'guess-available' | 'known-mine'

export interface Hint {
  available: Available
  /** The single deduction chosen to explain right now: lowest tier, then shallowest proof. */
  best: PatternMatch | null
}

const EMPTY_AVAILABLE: Available = {
  safe: new Set(), mine: new Set(), proofOf: new Map(), patterns: new Set(), any: false,
}

/**
 * §7.3 / §P8 — learning mode. Adds exactly three things to the base controller:
 * a live hint, move-blocking, and undo. Everything else — board, replay,
 * metrics — is the same `Game` timed play uses.
 *
 * Blocking is deliberately built on `provableIn`, the same "what was knowable"
 * definition `gradeReplay` uses to grade a finished game. That is what satisfies
 * §7.3's caveat: reject a move only if it is strictly worse than the best
 * available move by click count, and accept every tied move. Every cell in
 * `available.safe` is an equally provable open, so this never picks a favourite
 * among them — the arbitrary order HZiNi's greedy takes among independent
 * openings is not something a player can be penalised for either way.
 *
 * `Game`'s fields the base class touches (`board`, `phase`, replay bookkeeping)
 * are ordinary TypeScript-private, not real JS private fields, so overriding
 * `open`/`flag`/`chord`/`undo` and delegating to `super` is safe.
 */
export class LearningGame extends Game {
  onBlocked: ((cell: number, reason: BlockReason) => void) | null = null
  onHint: ((hint: Hint) => void) | null = null

  private pushHint(): void {
    if (!this.board || this.phase !== 'playing') {
      this.onHint?.({ available: EMPTY_AVAILABLE, best: null })
      return
    }
    const view = solverView(this.board)
    const av = provableIn(view)
    let best: PatternMatch | null = null
    for (const d of av.proofOf.values()) {
      const m = patternOf(view, d)
      if (!best || m.pattern.tier < best.pattern.tier || (m.pattern.tier === best.pattern.tier && m.depth < best.depth)) {
        best = m
      }
    }
    this.onHint?.({ available: av, best })
  }

  override open(cell: number): void {
    if (this.board && this.phase === 'playing') {
      const av = provableIn(solverView(this.board))
      if (av.any && !av.safe.has(cell) && !av.mine.has(cell)) {
        this.onBlocked?.(cell, 'guess-available')
        return
      }
      if (av.mine.has(cell)) {
        this.onBlocked?.(cell, 'known-mine')
        return
      }
    }
    super.open(cell)
    this.pushHint()
  }

  override flag(cell: number): void {
    if (this.board && this.phase === 'playing' && this.board.state[cell] !== FLAGGED) {
      // Only gate placing a *new* flag. Removing one is a correction, not a
      // guess, and blocking it would just be punitive.
      const av = provableIn(solverView(this.board))
      if (av.any && !av.mine.has(cell)) {
        this.onBlocked?.(cell, 'guess-available')
        return
      }
    }
    super.flag(cell)
    this.pushHint()
  }

  override chord(cell: number): void {
    super.chord(cell)
    this.pushHint()
  }

  override undo(): void {
    super.undo()
    this.pushHint()
  }
}
