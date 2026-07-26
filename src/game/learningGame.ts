import { Game } from './controller.ts'
import { canChord, solverView } from '../../engine/board.ts'
import { FLAGGED } from '../../engine/types.ts'
import { patternOf, type PatternMatch } from '../../engine/coach/patterns.ts'
import { analyzePosition, regretOf, type MoveAdvice, type PositionAnalysis } from '../../engine/coach/optimal.ts'
import type { Click } from '../../engine/metrics/greedy.ts'

export type BlockReason = 'guess-available' | 'known-mine' | 'wastes-clicks'

export interface Blocked {
  reason: BlockReason
  cell: number
  /** Clicks the rejected move would have thrown away. Only set for `wastes-clicks`. */
  regret: number
  advice: MoveAdvice | null
}

export interface Hint {
  /** Null before the first click and once the game is over. */
  analysis: PositionAnalysis | null
  /** The deduction worth explaining: lowest tier, then shallowest proof. */
  pattern: PatternMatch | null
}

const EMPTY: Hint = { analysis: null, pattern: null }

/**
 * §7.3 / §P8 — learning mode. Adds three things to the base controller: a live
 * hint, move-blocking, and undo. Board, replay and metrics stay the same ones
 * timed play uses.
 *
 * Blocking is in two stages, and the second is the one that teaches speed:
 *
 * 1. **Provability** — guessing while a certainty exists is rejected outright.
 * 2. **Cost** — among provable moves, a move is rejected only when it is
 *    *measured* strictly worse than the best justifiable move by click count.
 *    Opening eight cells one at a time when a single chord would clear them is
 *    perfectly correct and still wrong, and only this stage can say so.
 *
 * §7.3's caveat is satisfied by construction: regret is measured per move rather
 * than by comparing against one arbitrarily chosen optimal path, so every
 * genuinely tied line scores zero and the greedy's own tie-breaking is never
 * reported as the player's mistake.
 *
 * The analysis is recomputed synchronously after each move. §7.3 assumed that
 * would need a worker; measurement says otherwise — `npm run bench:optimal`
 * reports p90 3.9ms per expert position, inside a frame. Timed play still never
 * calls any of this.
 */
export class LearningGame extends Game {
  onBlocked: ((b: Blocked) => void) | null = null
  onHint: ((hint: Hint) => void) | null = null

  private analysis: PositionAnalysis | null = null
  /**
   * Which board `analysis` describes. Keyed on object identity rather than just
   * cleared on every move, because `undo` swaps in a freshly rebuilt board — and
   * a cache that silently described a different board would gate moves against
   * the wrong position.
   */
  private analysedBoard: object | null = null

  /**
   * The analysis of the position as it stands right now.
   *
   * Goes through `ensure` rather than returning the field: handing back a cached
   * analysis of a board that has since been replaced would be a stale answer to
   * a question whose whole point is being current.
   */
  get current(): PositionAnalysis | null { return this.ensure() }

  /** The analysis for the position as it stands, computed at most once per state. */
  private ensure(): PositionAnalysis | null {
    if (!this.board || this.phase !== 'playing') return null
    if (!this.analysis || this.analysedBoard !== this.board) {
      this.analysis = analyzePosition(this.board)
      this.analysedBoard = this.board
    }
    return this.analysis
  }

  private refresh(): void {
    this.analysis = null
    this.analysedBoard = null
    const a = this.ensure()
    if (!a || !this.board) { this.onHint?.(EMPTY); return }

    const view = solverView(this.board)
    // Explain the proof behind the recommended cells. A chord's cells are
    // consequences rather than deductions, so fall back to the whole position.
    const cells = a.advice ? (a.advice.type === 'flag' ? a.advice.flags : a.advice.opens) : []
    const proofs = cells.map((c) => a.available.proofOf.get(c)).filter((d) => d !== undefined)
    const candidates = proofs.length > 0 ? proofs : [...a.available.proofOf.values()]

    let pattern: PatternMatch | null = null
    for (const d of candidates) {
      const m = patternOf(view, d)
      const better = !pattern
        || m.pattern.tier < pattern.pattern.tier
        || (m.pattern.tier === pattern.pattern.tier && m.depth < pattern.depth)
      if (better) pattern = m
    }
    this.onHint?.({ analysis: a, pattern })
  }

  /**
   * Gate a move. Returns true when it may proceed; otherwise reports why.
   *
   * `provablyWrong` covers the first stage, which has to be decided per move
   * type — a flag wants a provable *mine*, an open wants a provable *safe*.
   */
  private gate(move: Click, provablyWrong: (a: PositionAnalysis) => BlockReason | null): boolean {
    const b = this.board
    if (!b || this.phase !== 'playing') return true
    const a = this.ensure()
    if (!a) return true

    /*
     * Nothing is provable: the position genuinely needs a guess, so nothing may
     * be blocked. Cost-based blocking especially must stay off here — the greedy
     * knows where the mines are, and vetoing a guess on cost would leak that.
     */
    if (!a.hasCertainty) return true

    const wrong = provablyWrong(a)
    if (wrong) {
      this.onBlocked?.({ reason: wrong, cell: move.cell, regret: 0, advice: a.advice })
      return false
    }

    const regret = regretOf(b, a, move)
    if (regret === 0) return true
    this.onBlocked?.({
      reason: 'wastes-clicks',
      cell: move.cell,
      regret: Number.isFinite(regret) ? regret : 0,
      advice: a.advice,
    })
    return false
  }

  override open(cell: number): void {
    const ok = this.gate({ type: 'open', cell }, (a) =>
      a.available.mine.has(cell) ? 'known-mine'
        : a.available.safe.has(cell) ? null
        : 'guess-available')
    if (!ok) return
    super.open(cell)
    this.refresh()
  }

  override flag(cell: number): void {
    // Only gate *placing* a flag. Removing one is a correction, not a guess, and
    // blocking it would just be punitive.
    const placing = this.board?.state[cell] !== FLAGGED
    const ok = !placing || this.gate({ type: 'flag', cell }, (a) =>
      a.available.mine.has(cell) ? null : 'guess-available')
    if (!ok) return
    super.flag(cell)
    this.refresh()
  }

  override chord(cell: number): void {
    const legal = this.board ? canChord(this.board, cell) : false
    const ok = !legal || this.gate({ type: 'chord', cell }, () => null)
    if (!ok) return
    super.chord(cell)
    this.refresh()
  }

  override undo(): void {
    super.undo()
    this.refresh()
  }
}
