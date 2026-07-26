import type { Board } from '../board.ts'
import { greedySolve, omniscientOracle, type Click } from './greedy.ts'
import { solverOracle } from './hzini.ts'

export interface ZiniResult {
  value: number
  /** the greedy click path, for the ghost overlay in replay (§8.3) */
  path: Click[]
  approximation: true
}

/**
 * ZiNi: minimum clicks with flags and chording, computed with full knowledge
 * of mine positions. Standard greedy approximation (§6.2).
 *
 * Runs the greedy twice — once unrestricted, once under HZiNi's solver-backed
 * flag oracle — and keeps the cheaper line.
 *
 * That is not hedging, it is what the definition requires. `HZiNi >= ZiNi` holds
 * because the omniscient player is strictly more capable: every line the
 * restricted oracle permits is also open to them. The *greedy* does not inherit
 * that, because it is a heuristic — more available chords means different local
 * choices, and a locally-best chord can be globally worse. On a 9x9 seeded
 * `hz0` the unrestricted run came out at 14 clicks against the restricted run's
 * 13, inverting the invariant. Letting the omniscient player also consider the
 * restricted line restores it by construction rather than by assertion.
 *
 * The second run costs a solve per action, so ZiNi is now roughly as expensive
 * as HZiNi. It is a metric, computed once per board, never in a hot path —
 * learning mode uses `hzini`/`greedyFrom` directly.
 */
export function zini(b: Board, firstClick: number): ZiniResult {
  const free = greedySolve(b, firstClick, omniscientOracle)
  const restricted = greedySolve(b, firstClick, solverOracle(b))
  const r = restricted.value < free.value ? restricted : free
  return { value: r.value, path: r.path, approximation: true }
}
