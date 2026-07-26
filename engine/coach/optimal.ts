import { canChord, solverView, type Board } from '../board.ts'
import {
  greedyFrom, plainClickCost, simFromBoard, type Click, type ClickType,
} from '../metrics/greedy.ts'
import { solverOracle } from '../metrics/hzini.ts'
import { chordCells, openSim, type Sim } from '../metrics/sim.ts'
import { threeBV } from '../metrics/threebv.ts'
import { neighborIndex } from '../neighbors.ts'
import { provableIn, type Available } from './grade.ts'
import { patternOf } from './patterns.ts'

export type MoveKey = string
export const keyOf = (m: Click): MoveKey => `${m.type}:${m.cell}`

export interface OptimalPlan {
  /** Clicks a perfect player needs from here, by the HZiNi greedy. */
  best: number
  /** The whole greedy continuation, for debugging and for the drill ladder later. */
  path: Click[]
  /**
   * The action to take *now*: either a chord together with the flags it needs
   * first, or the set of equally-good opens.
   */
  step: Click[]
  /**
   * Every move that begins an equally good continuation. Membership is accepted
   * without re-costing; anything outside it gets costed exactly before being
   * called worse (see `regretOf`).
   */
  onPlan: Set<MoveKey>
  /** For a chord step: clicks saved versus opening those cells one at a time. */
  saves: number
}

/** Apply a player-legal move to a sim. Returns false if it is not legal there. */
function applyToSim(b: Board, s: Sim, m: Click): boolean {
  const ni = neighborIndex(b.width, b.height)
  if (m.type === 'flag') {
    if (s.opened[m.cell] || s.flagged[m.cell]) return false
    s.flagged[m.cell] = 1
    return true
  }
  if (m.type === 'open') {
    if (s.opened[m.cell] || s.flagged[m.cell]) return false
    if (b.mines[m.cell]) return false // costing a death is meaningless
    openSim(b, s, m.cell)
    return true
  }
  // Chord: opens every unflagged, unopened neighbour. Only legal on a revealed
  // number whose flags already match its count, which is the board's own rule.
  if (!s.opened[m.cell] || b.adj[m.cell] === 0) return false
  let flags = 0
  for (let k = 0; k < ni.count[m.cell]; k++) {
    if (s.flagged[ni.table[m.cell * 8 + k]]) flags++
  }
  if (flags !== b.adj[m.cell]) return false
  for (let k = 0; k < ni.count[m.cell]; k++) {
    const nb = ni.table[m.cell * 8 + k]
    if (b.mines[nb] || s.flagged[nb] || s.opened[nb]) continue
    openSim(b, s, nb)
  }
  return true
}

/**
 * What a perfect player would do next, and what it costs.
 *
 * This is what makes learning mode teach *efficiency* rather than only
 * correctness. Provability alone accepts "open a safe cell" forever; it never
 * says "those eight cells are one chord, not eight clicks".
 *
 * Only the greedy runs here — one pass, not one per candidate move — because
 * costing every legal move separately is tens of solver-backed greedy solves per
 * position. The step below is read off the single plan instead, and anything the
 * player does that falls outside it is costed exactly, once, at that moment.
 */
export function planFrom(b: Board, from = -1): OptimalPlan {
  const openingOf = threeBV(b).openingOf
  const s = simFromBoard(b)
  const r = greedyFrom(b, s, solverOracle(b), openingOf, from)
  const path = r.path

  const onPlan = new Set<MoveKey>()
  let step: Click[] = []
  let saves = 0

  const firstChord = path.findIndex((m) => m.type === 'chord')
  const leadsWithChord = firstChord >= 0 && path.slice(0, firstChord).every((m) => m.type === 'flag')

  if (leadsWithChord) {
    // The greedy's next real action is a chord, possibly needing flags first.
    // Every one of those flags, and the chord itself, is on-plan: their order
    // among themselves does not matter.
    step = path.slice(0, firstChord + 1)
    for (const m of step) onPlan.add(keyOf(m))
    const chord = path[firstChord]
    const cells = chordCells(b, simFromBoard(b), chord.cell)
    saves = Math.max(0, plainClickCost(cells, b, openingOf) - step.length)
  } else {
    /*
     * Nothing worth chording: the rest is opens. Cascades come first — opening a
     * numbered cell that an as-yet-unopened cascade would have revealed for free
     * wastes a click — but among cascades the order is irrelevant, and §7.3 is
     * explicit that independent openings must never be penalised.
     */
    const opens = path.filter((m) => m.type === 'open')
    const cascades = opens.filter((m) => b.adj[m.cell] === 0)
    step = cascades.length > 0 ? cascades : opens
    for (const m of step) onPlan.add(keyOf(m))
  }

  return { best: r.value, path, step, onPlan, saves }
}

/**
 * Exact cost of one move: the click itself plus the greedy continuation after
 * it. `Infinity` when the move is not legal from this position.
 */
export function costOf(b: Board, m: Click, openingOf?: Int32Array): number {
  const oo = openingOf ?? threeBV(b).openingOf
  const s = simFromBoard(b)
  if (!applyToSim(b, s, m)) return Infinity
  // Continue from the move just played: that is where the cursor now is.
  return 1 + greedyFrom(b, s, solverOracle(b), oo, m.cell).value
}

export interface MoveAdvice {
  type: ClickType
  cell: number
  /** Cells this move will open, for the overlay. */
  opens: number[]
  /** Cells that must be flagged first, if any. */
  flags: number[]
  /** Clicks this move saves against the naive alternative. 0 for a plain open. */
  saves: number
}

export interface PositionAnalysis extends OptimalPlan {
  /**
   * Cost of the best move the player can actually *justify* right now.
   *
   * This is the baseline regret is measured against, and it is not always
   * `best`. The greedy is omniscient, so its own next click can be a cell that
   * is merely lucky rather than provable. Scoring the player against a line they
   * have no way to find would mark every legal move as a mistake — §7.3's
   * infuriating case. `bestAchievable >= best` always.
   */
  bestAchievable: number
  /** What to show the player. Null only when nothing is provable at all. */
  advice: MoveAdvice | null
  /** False when the position genuinely requires a guess. */
  hasCertainty: boolean
  /**
   * What the solver can prove here, carried along rather than left for callers to
   * recompute. `provableIn` unions every tier including the tank, so asking again
   * costs a full solve — and the blocker needs these sets on the same click.
   */
  available: Available
}

/** Bounds the fallback search below; see `analyzePosition`. */
const MAX_FALLBACK_CANDIDATES = 16

/**
 * Everything learning mode needs about a position, in one consistent bundle.
 *
 * `advice` and `bestAchievable` have to be produced together: the advice must be
 * a move whose cost *is* the baseline, or the hint would recommend something the
 * blocker then rejects.
 */
export function analyzePosition(b: Board, from = -1): PositionAnalysis {
  const plan = planFrom(b, from)
  const av = provableIn(solverView(b))
  const hasCertainty = av.any

  // A chord is only advisable when the board itself would allow it.
  const chord = plan.step.find((m) => m.type === 'chord')
  if (chord && canChord(b, chord.cell)) {
    return {
      ...plan, hasCertainty, available: av, bestAchievable: plan.best,
      advice: {
        type: 'chord', cell: chord.cell, flags: [],
        opens: chordCells(b, simFromBoard(b), chord.cell), saves: plan.saves,
      },
    }
  }

  // The chord needs flags first; recommend one the solver can prove.
  const planFlags = plan.step.filter((m) => m.type === 'flag' && av.mine.has(m.cell)).map((m) => m.cell)
  if (chord && planFlags.length > 0) {
    return {
      ...plan, hasCertainty, available: av, bestAchievable: plan.best,
      advice: { type: 'flag', cell: planFlags[0], opens: [], flags: planFlags, saves: plan.saves },
    }
  }

  /*
   * Every open in `step` is equally good by click count, so the choice among
   * them is free — and it should be spent on teachability. Pick the one whose
   * proof is simplest: lowest tier, then fewest numbers.
   *
   * Without this the recommendation is whichever cell the greedy happened to
   * emit first, and its proof can be a twelve-witness tank enumeration while a
   * plain 1-1 sits available elsewhere. Optimal, and useless as a lesson.
   */
  const planOpens = plan.step.filter((m) => m.type === 'open' && av.safe.has(m.cell))
  if (planOpens.length > 0) {
    const view = solverView(b)
    const away = (c: number) => {
      if (from < 0) return 0
      return Math.max(
        Math.abs((c % b.width) - (from % b.width)),
        Math.abs(Math.floor(c / b.width) - Math.floor(from / b.width)),
      )
    }
    let pick = planOpens[0]
    let pickRank: [number, number, number] = [Infinity, Infinity, Infinity]
    for (const m of planOpens) {
      const d = av.proofOf.get(m.cell)
      // Teachability first, then proximity: these are all equal on cost, so the
      // choice is free, and it is worth spending on the clearest lesson before
      // the shortest mouse travel.
      const rank: [number, number, number] = d
        ? [patternOf(view, d).pattern.tier, patternOf(view, d).depth, away(m.cell)]
        : [Infinity, Infinity, away(m.cell)]
      const better = rank[0] < pickRank[0]
        || (rank[0] === pickRank[0] && rank[1] < pickRank[1])
        || (rank[0] === pickRank[0] && rank[1] === pickRank[1] && rank[2] < pickRank[2])
      if (better) { pick = m; pickRank = rank }
    }
    return {
      ...plan, hasCertainty, available: av, bestAchievable: plan.best,
      advice: { type: 'open', cell: pick.cell, opens: [pick.cell], flags: [], saves: 0 },
    }
  }

  /*
   * The plan's step is not provable. Fall back to the cheapest move the player
   * *can* prove, measured rather than assumed, and make that the baseline.
   *
   * Capped because this is the one path that costs a greedy solve per candidate.
   * The cap can only make `bestAchievable` too high, which biases towards
   * allowing moves rather than blocking them — the safe direction.
   */
  const candidates: Click[] = []
  for (const c of av.safe) candidates.push({ type: 'open', cell: c })
  for (const c of av.mine) candidates.push({ type: 'flag', cell: c })
  for (let c = 0; c < b.width * b.height; c++) if (canChord(b, c)) candidates.push({ type: 'chord', cell: c })

  const openingOf = threeBV(b).openingOf
  let bestMove: Click | null = null
  let bestCost = Infinity
  for (const m of candidates.slice(0, MAX_FALLBACK_CANDIDATES)) {
    const cost = costOf(b, m, openingOf)
    if (cost < bestCost) { bestCost = cost; bestMove = m }
  }

  if (!bestMove || !Number.isFinite(bestCost)) {
    return { ...plan, hasCertainty, available: av, bestAchievable: plan.best, advice: null }
  }

  // The chosen move is by construction the cheapest justifiable one, so it must
  // be treated as on-plan even though the greedy did not pick it.
  const onPlan = new Set(plan.onPlan)
  onPlan.add(keyOf(bestMove))
  const opens = bestMove.type === 'chord' ? chordCells(b, simFromBoard(b), bestMove.cell) : [bestMove.cell]
  return {
    ...plan, onPlan, hasCertainty, available: av, bestAchievable: bestCost,
    advice: {
      type: bestMove.type, cell: bestMove.cell, flags: bestMove.type === 'flag' ? [bestMove.cell] : [],
      opens: bestMove.type === 'flag' ? [] : opens, saves: 0,
    },
  }
}

/**
 * How many clicks a move throws away, measured rather than guessed.
 *
 * On-plan moves short-circuit to 0. Everything else is costed exactly, so the
 * greedy's arbitrary choice among genuinely tied lines can never be reported as
 * the player's mistake — which is precisely the failure §7.3 warns would make
 * learning mode infuriating.
 */
export function regretOf(b: Board, analysis: PositionAnalysis, m: Click): number {
  if (analysis.onPlan.has(keyOf(m))) return 0
  const cost = costOf(b, m)
  if (!Number.isFinite(cost)) return Infinity
  return Math.max(0, cost - analysis.bestAchievable)
}
