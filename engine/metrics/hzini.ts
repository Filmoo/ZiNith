import type { Board } from '../board.ts'
import { solve } from '../solver/index.ts'
import { FLAGGED, HIDDEN, REVEALED, type SolverView } from '../types.ts'
import { greedySolve, type Click, type FlagOracle } from './greedy.ts'
import type { Sim } from './sim.ts'

export interface HZiniResult {
  value: number
  path: Click[]
  approximation: true
  /** opens made with no certain move available — the honest guesses */
  blindOpens: number
}

/**
 * The flag oracle HZiNi runs on: a mine may only be flagged once the solver can
 * prove it from what is currently revealed.
 *
 * Exported because learning mode needs the same restriction — a hint that says
 * "flag that" about a mine no rule can prove yet would be telling the player to
 * guess.
 */
export function solverOracle(b: Board): FlagOracle {
  const n = b.width * b.height
  const known = new Set<number>()
  return {
    refresh(sim: Sim) {
      const state = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        state[i] = sim.opened[i] ? REVEALED : sim.flagged[i] ? FLAGGED : HIDDEN
      }
      const view: SolverView = { width: b.width, height: b.height, state, adj: b.adj, totalMines: b.mineCount }
      const r = solve(view)
      known.clear()
      for (const d of r.deductions) {
        if (d.verdict !== 'mine') continue
        for (const c of d.subject) known.add(c)
      }
    },
    canFlag(cell: number) {
      return known.has(cell)
    },
  }
}

/**
 * The same greedy as ZiNi, but it may only flag mines the solver can prove
 * from what is currently revealed. Recomputed after every action.
 *
 * HZiNi >= ZiNi always: strictly less information, same algorithm.
 */
export function hzini(b: Board, firstClick: number): HZiniResult {
  const r = greedySolve(b, firstClick, solverOracle(b))
  return { value: r.value, path: r.path, approximation: true, blindOpens: r.blindOpens }
}
