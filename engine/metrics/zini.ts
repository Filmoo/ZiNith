import type { Board } from '../board.ts'
import { greedySolve, omniscientOracle, type Click } from './greedy.ts'

export interface ZiniResult {
  value: number
  /** the greedy click path, for the ghost overlay in replay (§8.3) */
  path: Click[]
  approximation: true
}

/**
 * ZiNi: minimum clicks with flags and chording, computed with full knowledge
 * of mine positions. Standard greedy approximation (§6.2).
 */
export function zini(b: Board, firstClick: number): ZiniResult {
  const r = greedySolve(b, firstClick, omniscientOracle)
  return { value: r.value, path: r.path, approximation: true }
}
