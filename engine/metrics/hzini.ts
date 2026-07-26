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
 * The same greedy as ZiNi, but it may only flag mines the solver can prove
 * from what is currently revealed. Recomputed after every action.
 *
 * HZiNi >= ZiNi always: strictly less information, same algorithm.
 */
export function hzini(b: Board, firstClick: number): HZiniResult {
  const n = b.width * b.height

  const oracle: FlagOracle = {
    known: new Set<number>(),
    refresh(sim: Sim) {
      const state = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        state[i] = sim.opened[i] ? REVEALED : sim.flagged[i] ? FLAGGED : HIDDEN
      }
      const view: SolverView = { width: b.width, height: b.height, state, adj: b.adj, totalMines: b.mineCount }
      const r = solve(view)
      this.known.clear()
      for (const d of r.deductions) {
        if (d.verdict !== 'mine') continue
        for (const c of d.subject) this.known.add(c)
      }
    },
    canFlag(cell: number) {
      return this.known.has(cell)
    },
  } as FlagOracle & { known: Set<number> }

  const r = greedySolve(b, firstClick, oracle)
  return { value: r.value, path: r.path, approximation: true, blindOpens: r.blindOpens }
}
