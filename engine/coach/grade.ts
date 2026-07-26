import { canChord, chord, createBoard, open, solverView, toggleFlag, type Board } from '../board.ts'
import { hzini } from '../metrics/hzini.ts'
import { specOf, type Replay, type ReplayEvent } from '../replay.ts'
import { buildFrontier } from '../solver/index.ts'
import { tier1, tier2 } from '../solver/rules.ts'
import { tankSolve } from '../solver/tank.ts'
import type { CellId, Deduction, SolverView } from '../types.ts'
import { patternOf, type PatternId } from './patterns.ts'

/**
 * How a single move is judged.
 *
 * NOTE ON PROVENANCE: §8.2 of the delta says "classification table is
 * unchanged", meaning it is defined in the base build spec, which is not in this
 * repository. This set is therefore *inferred* from what §8.4 records per move
 * (`betterMove`, `deduction`, `patternId`, `costClicks`, `costMs`) and from
 * §14.3, which requires the query "show me every game with an unnecessary
 * guess" — so that class must exist by that name. Reconcile with the base spec
 * when it surfaces; the names are cheap to change, the machinery is not.
 */
export type CoachClass =
  /** Provably correct: the move was one the solver could justify. */
  | 'optimal'
  /** Correct but wasteful — it cost a click without revealing anything. */
  | 'suboptimal'
  /** Guessed while a certainty was on the board. The mistake that matters. */
  | 'unnecessary-guess'
  /** Nothing was deducible. Not a mistake; the board asked for a coin flip. */
  | 'necessary-guess'
  /** Provably wrong: opened a known mine, or flagged a cell that is not one. */
  | 'error'

export interface Grade {
  moveIndex: number
  class: CoachClass
  /** A cell the player could have taken instead, when one was provable. */
  betterMove?: CellId
  /** Minimised proof for this move, or for the move that was available. */
  deduction?: Deduction
  patternId?: PatternId
  /** Clicks this move wasted. */
  costClicks: number
  /** Time this move took, in ms. */
  costMs: number
}

/**
 * Per-pattern tally for one game, feeding the weak-spot card (§10.2).
 *
 * An *opportunity* is a position where the solver found that pattern available.
 * A *miss* is such a position where the player then guessed or erred instead of
 * taking a certainty. Note the asymmetry: if three patterns were available and
 * the player used one, the other two are not counted as missed — you only get
 * one move per position, so charging the alternatives would make every common
 * pattern look weak. §10.2 does not spell this out; this is the reading.
 */
export interface PatternStat {
  opportunities: number
  misses: number
}

/**
 * §8.4. `v` invalidates the cache whenever the solver or coach changes.
 *
 * `patternStats` is an addition to the interface as written in §8.4: §10.2 needs
 * per-pattern opportunity counts, and this pass is the only place they are known.
 */
export interface CachedGrades {
  replayId: string
  v: 1
  grades: Grade[]
  patternStats: Record<PatternId, PatternStat>
  summary: {
    /** Share of moves that were provable or forced. */
    accuracy: number
    /** Time spent above your own pace on moves that were already provable. */
    hesitationMs: number
    /** Clicks over the solver's own best line for this board. */
    clicksLost: number
  }
}

export const COACH_VERSION = 1 as const

export interface Available {
  safe: Set<CellId>
  mine: Set<CellId>
  /** First deduction that names each cell, for overlays and pattern stats. */
  proofOf: Map<CellId, Deduction>
  /** Distinct patterns provable in this position. */
  patterns: Set<PatternId>
  any: boolean
}

/**
 * Everything provable in this position — deliberately *not* `solve()`.
 *
 * `solve` stops at the first productive tier, which is right for playing: the
 * cheapest certainty is all you need to make a move. It is wrong for grading,
 * twice over.
 *
 * 1. With a satisfied number and a 1-1 both on the board, `solve` returns only
 *    the satisfied number, so a player who read the 1-1 would be marked as
 *    having guessed.
 * 2. Provability by these particular rules is not monotone. Revealing a cell can
 *    dismantle the subset relation that proved something, leaving a cell that
 *    genuinely was knowable now reachable only through enumeration. Escalating
 *    to the tank only when the local tiers come up empty therefore still lets
 *    the coach accuse a player who was right.
 *
 * So take the union of every tier, tank included. The cost is one enumeration
 * per move, which is affordable precisely because this runs once per game in a
 * worker (§8.2) — timed play must never call it.
 */
export function provableIn(view: SolverView): Available {
  const f = buildFrontier(view)
  const deductions: Deduction[] = f.inconsistent
    ? []
    : [...tier1(f), ...tier2(f), ...tankSolve(f, view, {}).deductions]

  const safe = new Set<CellId>()
  const mine = new Set<CellId>()
  const proofOf = new Map<CellId, Deduction>()
  const patterns = new Set<PatternId>()
  for (const d of deductions) {
    const target = d.verdict === 'safe' ? safe : mine
    for (const c of d.subject) {
      target.add(c)
      if (!proofOf.has(c)) proofOf.set(c, d)
    }
    patterns.add(patternOf(view, d).id)
  }
  return { safe, mine, proofOf, patterns, any: safe.size > 0 || mine.size > 0 }
}

/** Apply an event to the board exactly as the controller would have. */
function apply(b: Board, e: ReplayEvent): void {
  if (e.type === 'open') open(b, e.cell)
  else if (e.type === 'chord') chord(b, e.cell)
  else toggleFlag(b, e.cell)
}

/**
 * Grade a finished replay (§8.2, §8.4).
 *
 * Runs the solver once per move against the state *before* that move, which is
 * the only way to ask "what was knowable at the time". Pure and DOM-free, so it
 * belongs in a worker — timed play must never call this mid-game.
 */
export function gradeReplay(r: Replay): CachedGrades {
  const spec = specOf(r)
  const b = createBoard(spec)
  const grades: Grade[] = []

  let prevT = 0
  const provableAndSlow: number[] = []
  const patternStats: Record<PatternId, PatternStat> = {}
  const tally = (id: PatternId, missed: boolean) => {
    const s = (patternStats[id] ??= { opportunities: 0, misses: 0 })
    s.opportunities++
    if (missed) s.misses++
  }

  for (let i = 0; i < r.events.length; i++) {
    const e = r.events[i]
    const costMs = Math.max(0, e.t - prevT)
    prevT = e.t

    // The opening click cannot be deduced from an empty board, so it is never
    // graded as a mistake.
    if (i === 0) {
      apply(b, e)
      grades.push({ moveIndex: 0, class: 'necessary-guess', costClicks: 0, costMs })
      continue
    }

    const view = solverView(b)
    const av = provableIn(view)
    const g = judge(b, view, av, e, i, costMs)
    grades.push(g)

    if (av.any && (g.class === 'optimal' || g.class === 'unnecessary-guess')) {
      provableAndSlow.push(costMs)
    }
    if (av.any) {
      const missed = g.class === 'unnecessary-guess' || g.class === 'error'
      for (const id of av.patterns) tally(id, missed)
    }

    apply(b, e)
  }

  // Hesitation is measured against the player's own pace: time spent above the
  // median on moves that were already provable. An absolute threshold would just
  // measure how fast someone is, not where they stalled.
  const median = medianOf(provableAndSlow)
  const hesitationMs = provableAndSlow.reduce((a, ms) => a + Math.max(0, ms - median), 0)

  const graded = grades.length
  const good = grades.filter((g) => g.class === 'optimal' || g.class === 'necessary-guess').length

  /*
   * Only a finished board can be compared against HZiNi's full line. On a loss
   * the player stopped early, so `clicks - hzini` is negative and clamps to a
   * flattering 0 — it would report a botched game as having wasted nothing.
   * For those, count the clicks that provably achieved nothing instead. This
   * also skips an expensive greedy solve on every lost game.
   */
  const clicksLost =
    r.result === 'win'
      ? Math.max(0, r.events.length - hzini(createBoard(spec), spec.firstClick).value)
      : grades.reduce((a, g) => a + g.costClicks, 0)

  return {
    replayId: r.id,
    v: COACH_VERSION,
    grades,
    patternStats,
    summary: {
      accuracy: graded > 0 ? good / graded : 0,
      hesitationMs: Math.round(hesitationMs),
      clicksLost,
    },
  }
}

function judge(
  b: Board,
  view: SolverView,
  av: Available,
  e: ReplayEvent,
  i: number,
  costMs: number,
): Grade {
  const base = { moveIndex: i, costMs }
  const pattern = (cell: CellId) => {
    const d = av.proofOf.get(cell)
    if (!d) return {}
    const m = patternOf(view, d)
    return { deduction: m.deduction, patternId: m.id }
  }
  /** Something provable the player could have done instead. */
  const alternative = () => {
    const cell = av.safe.values().next().value ?? av.mine.values().next().value
    return cell === undefined ? {} : { betterMove: cell, ...pattern(cell) }
  }

  if (e.type === 'open') {
    if (av.mine.has(e.cell)) {
      // Opening a cell the solver had already proven to be a mine.
      return { ...base, class: 'error', costClicks: 1, ...pattern(e.cell) }
    }
    if (av.safe.has(e.cell)) return { ...base, class: 'optimal', costClicks: 0, ...pattern(e.cell) }
    if (av.any) return { ...base, class: 'unnecessary-guess', costClicks: 0, ...alternative() }
    return { ...base, class: 'necessary-guess', costClicks: 0 }
  }

  if (e.type === 'chord') {
    if (!canChord(b, e.cell)) {
      // A chord that could not fire: a click that did nothing at all.
      return { ...base, class: 'suboptimal', costClicks: 1 }
    }
    // Chording is how clicks are saved, so a legal chord is the efficient move.
    return { ...base, class: 'optimal', costClicks: 0 }
  }

  if (e.type === 'flag') {
    if (av.mine.has(e.cell)) return { ...base, class: 'optimal', costClicks: 0, ...pattern(e.cell) }
    if (!b.mines[e.cell]) {
      // Flagging a safe cell. Wrong, and it will break any chord that trusts it.
      return { ...base, class: 'error', costClicks: 1, ...alternative() }
    }
    // Genuinely a mine, but not provable yet — a lucky read, not a deduction.
    return { ...base, class: av.any ? 'unnecessary-guess' : 'necessary-guess', costClicks: 0 }
  }

  // Unflagging never reveals anything; it only undoes a click.
  return { ...base, class: 'suboptimal', costClicks: 1 }
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
