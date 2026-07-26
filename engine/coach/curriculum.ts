import { createBoard, open, solverView, toggleFlag, type BoardSpec } from '../board.ts'
import { solve } from '../solver/index.ts'
import { HIDDEN } from '../types.ts'
import type { CachedGrades } from './grade.ts'
import { PATTERNS, patternOf, teachingOrder, type Pattern, type PatternId } from './patterns.ts'

/** §10.2 — the two cards shown side by side. */
export interface Recommendation {
  /** Next unlearned pattern in the derived order, from the chosen entry point. */
  nextInCourse: Pattern | null
  /** Highest miss rate over the rolling window, or null when the sample is thin. */
  weakSpot: { pattern: Pattern; missRate: number; opportunities: number } | null
}

export interface WeakSpotOpts {
  /** §10.2 — a rolling window of games, so the suggestion decays as you improve. */
  window?: number
  /** §10.2 — below this many opportunities the rate is noise, so suppress it. */
  minOpportunities?: number
}

/**
 * Highest miss rate over the last `window` games.
 *
 * Rate, not raw count: a raw count keeps re-suggesting whatever you have simply
 * seen most, and lags behind your learning curve instead of tracking it.
 */
export function weakSpot(
  recent: readonly CachedGrades[],
  { window = 20, minOpportunities = 5 }: WeakSpotOpts = {},
): Recommendation['weakSpot'] {
  const games = recent.slice(-window)
  const totals = new Map<PatternId, { opportunities: number; misses: number }>()
  for (const g of games) {
    for (const [id, s] of Object.entries(g.patternStats)) {
      const t = totals.get(id) ?? { opportunities: 0, misses: 0 }
      t.opportunities += s.opportunities
      t.misses += s.misses
      totals.set(id, t)
    }
  }

  let best: Recommendation['weakSpot'] = null
  for (const [id, t] of totals) {
    if (t.opportunities < minOpportunities) continue
    const missRate = t.misses / t.opportunities
    if (missRate <= 0) continue
    if (!best || missRate > best.missRate) {
      const pattern = PATTERNS.find((p) => p.id === id)
      if (pattern) best = { pattern, missRate, opportunities: t.opportunities }
    }
  }
  return best
}

/**
 * §10.2. `learned` is the set cleared to rung 2 (§10.3); `entry` is the
 * self-selected starting tier, so an experienced player skips the basics.
 */
export function recommend(
  recent: readonly CachedGrades[],
  learned: ReadonlySet<PatternId>,
  frequency: ReadonlyMap<PatternId, number> = new Map(),
  depth: ReadonlyMap<PatternId, number> = new Map(),
  entryTier = 1,
): Recommendation {
  const order = teachingOrder(PATTERNS, frequency, depth)
  const nextInCourse = order.find((p) => p.tier >= entryTier && !learned.has(p.id)) ?? null
  return { nextInCourse, weakSpot: weakSpot(recent) }
}

export interface FrequencyReport {
  /** Times each pattern was the proof for a move actually needed to solve. */
  frequency: Map<PatternId, number>
  /** Shallowest proof observed per pattern — the objective difficulty number. */
  depth: Map<PatternId, number>
  boards: number
}

/**
 * §10.1.2 — frequency instrumentation. Solve boards the way a perfect player
 * would and count which patterns actually carry the solve, so teaching order is
 * derived from data instead of folklore.
 *
 * This is the P7 tooling task, built on the P1 solver. Pure, so `npm test` and
 * `npm run bench` can both drive it.
 */
export function measureFrequency(specs: readonly BoardSpec[]): FrequencyReport {
  const frequency = new Map<PatternId, number>()
  const depth = new Map<PatternId, number>()

  for (const spec of specs) {
    const b = createBoard(spec)
    open(b, spec.firstClick)
    for (let guard = 0; guard < 5000; guard++) {
      const view = solverView(b)
      const r = solve(view)
      if (r.deductions.length === 0) break
      for (const d of r.deductions) {
        const m = patternOf(view, d)
        frequency.set(m.id, (frequency.get(m.id) ?? 0) + 1)
        const prev = depth.get(m.id)
        if (prev === undefined || m.depth < prev) depth.set(m.id, m.depth)
      }
      // Apply every certainty this round, then look again.
      let progressed = false
      for (const d of r.deductions) {
        for (const c of d.subject) {
          if (b.state[c] !== HIDDEN) continue
          if (d.verdict === 'safe') open(b, c)
          else toggleFlag(b, c)
          progressed = true
        }
      }
      if (!progressed || b.exploded) break
    }
  }

  return { frequency, depth, boards: specs.length }
}

/** Convenience: the derived teaching order for a measured report. */
export function orderFrom(report: FrequencyReport): Pattern[] {
  return teachingOrder(PATTERNS, report.frequency, report.depth)
}
