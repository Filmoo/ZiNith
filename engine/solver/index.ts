import type { SolveOpts, SolveResult, SolverView } from '../types.ts'
import { buildFrontier } from './constraints.ts'
import { tier1, tier2 } from './rules.ts'
import { tankSolve } from './tank.ts'

export { buildFrontier } from './constraints.ts'
export { components, enumerateComponent } from './tank.ts'
export { minimizeWitnesses, provesLocally } from './minimize.ts'

/**
 * Runs the tiers cheapest-first and stops at the first that produces anything,
 * unless probabilities were asked for — those only come out of the tank.
 */
export function solve(view: SolverView, opts: SolveOpts = {}): SolveResult {
  const f = buildFrontier(view)
  if (f.inconsistent) return { deductions: [], stuck: true, incomplete: false }

  if (!opts.probabilities) {
    const t1 = tier1(f)
    if (t1.length > 0) return { deductions: t1, stuck: false, incomplete: false }

    const t2 = tier2(f)
    if (t2.length > 0) return { deductions: t2, stuck: false, incomplete: false }
  }

  const t = tankSolve(f, view, opts)
  if (opts.probabilities && t.deductions.length === 0) {
    // still surface the cheap tiers so the caller sees every certain move
    const cheap = [...tier1(f), ...tier2(f)]
    if (cheap.length > 0) {
      return { deductions: cheap, probabilities: t.probabilities, stuck: false, incomplete: t.incomplete }
    }
  }
  return {
    deductions: t.deductions,
    probabilities: t.probabilities,
    stuck: t.deductions.length === 0,
    incomplete: t.incomplete,
  }
}
