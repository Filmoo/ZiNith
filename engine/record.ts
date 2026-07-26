import { chord, createBoard, open, toggleFlag, type Board } from './board.ts'
import type { CachedGrades, CoachClass } from './coach/grade.ts'
import { threeBV } from './metrics/threebv.ts'
import { encode, specOf, type PresetId, type Replay, type Result } from './replay.ts'
import { HIDDEN } from './types.ts'

/**
 * The history row (§14.3) and the PB pools (§14.2).
 *
 * Everything here is derived from a `Replay` — the board is regenerated from the
 * seed, so a record stores no board and stays small. Kept in `/engine` rather
 * than in the store because it is pure: the numbers a history row shows are
 * rules, not storage, and they are worth testing headlessly.
 */

export type FlagPool = 'flag' | 'noflag'
export type GuessPool = 'noguess' | 'guess'
export type PoolId = `${FlagPool}-${GuessPool}`

/** §14.2 — the only pool shown on home. Everything else sits behind a filter. */
export const STANDARD_POOL: PoolId = 'flag-noguess'

export function poolOf(r: Pick<Replay, 'scheme' | 'noGuess'>): PoolId {
  return `${r.scheme === 'no-flag' ? 'noflag' : 'flag'}-${r.noGuess ? 'noguess' : 'guess'}`
}

/**
 * Classes that count as a mistake for the §14.3 filter.
 *
 * `necessary-guess` is deliberately absent: the board asked for a coin flip, so
 * filtering on it would surface games the player could not have played better.
 */
export const MISTAKE_CLASSES: readonly CoachClass[] = ['unnecessary-guess', 'error', 'suboptimal']

export interface GameRecord {
  id: string
  startedAt: number
  preset: PresetId
  result: Result
  durationMs: number
  clicks: number
  /** Whole-board 3BV. */
  threeBV: number
  /** 3BV actually cleared — equals `threeBV` on a win, less on a loss. */
  threeBVDone: number
  /** Cleared 3BV per second, so a lost game is not flattered by the full board. */
  bvs: number
  /** IOE: cleared 3BV over clicks spent. Chording can push it above 1. */
  efficiency: number
  pool: PoolId
  scheme: Replay['scheme']
  noGuess: boolean
  /** Played with hints on. Excluded from personal bests (§7.3). */
  learning: boolean
  dims: [number, number]
  mines: number
  /** Compact wire form (§8.1). Under 2KB for an expert game. */
  replay: string

  // Coach-derived. Absent until grading lands, which happens after the record is
  // written — a game must appear in history immediately, not once the worker
  // finishes.
  accuracy?: number
  clicksLost?: number
  hesitationMs?: number
  /** Distinct mistake classes present, for the §14.3 filter. */
  mistakeClasses?: CoachClass[]
  /** Mirrors `CachedGrades.v`, so a solver change invalidates the row's stats. */
  coachV?: number
}

export interface ReplayStats {
  threeBV: number
  threeBVDone: number
  clicks: number
  bvs: number
  efficiency: number
}

/**
 * Replay the event log to find how much 3BV the player actually cleared.
 *
 * A 3BV unit is either an opening — done the moment any of its zero cells is
 * revealed, since the cascade takes the rest — or a numbered cell no opening
 * touches. A numbered cell that *is* adjacent to an opening carries no unit of
 * its own, which is why neither branch below credits it.
 */
export function replayStats(r: Replay): ReplayStats {
  const spec = specOf(r)
  const b = createBoard(spec)
  const bv = threeBV(b)
  const oo = bv.openingOf

  const credited = new Uint8Array(b.width * b.height)
  const openingsDone = new Set<number>()
  let isolatedDone = 0

  const credit = (cells: number[]) => {
    for (const c of cells) {
      if (credited[c] || b.mines[c]) continue
      credited[c] = 1
      if (b.adj[c] === 0) openingsDone.add(oo[c])
      else if (oo[c] === -1) isolatedDone++
    }
  }

  for (const e of r.events) {
    if (e.type === 'open') {
      if (b.state[e.cell] === HIDDEN) credit(open(b, e.cell))
    } else if (e.type === 'chord') {
      credit(chord(b, e.cell))
    } else {
      toggleFlag(b, e.cell)
    }
  }

  const threeBVDone = openingsDone.size + isolatedDone
  const clicks = r.events.length
  const secs = r.duration / 1000
  return {
    threeBV: bv.value,
    threeBVDone,
    clicks,
    bvs: secs > 0 ? threeBVDone / secs : 0,
    efficiency: clicks > 0 ? threeBVDone / clicks : 0,
  }
}

export function recordOf(r: Replay): GameRecord {
  const s = replayStats(r)
  return {
    id: r.id,
    startedAt: r.startedAt,
    preset: r.preset,
    result: r.result,
    durationMs: r.duration,
    clicks: s.clicks,
    threeBV: s.threeBV,
    threeBVDone: s.threeBVDone,
    bvs: s.bvs,
    efficiency: s.efficiency,
    pool: poolOf(r),
    scheme: r.scheme,
    noGuess: r.noGuess,
    learning: r.learning,
    dims: r.dims,
    mines: r.mines,
    replay: encode(r),
  }
}

/** Fold coach output into a row once the worker returns. */
export function withGrades(rec: GameRecord, g: CachedGrades): GameRecord {
  const present = new Set<CoachClass>()
  for (const grade of g.grades) {
    if (MISTAKE_CLASSES.includes(grade.class)) present.add(grade.class)
  }
  return {
    ...rec,
    accuracy: g.summary.accuracy,
    clicksLost: g.summary.clicksLost,
    hesitationMs: g.summary.hesitationMs,
    mistakeClasses: [...present],
    coachV: g.v,
  }
}

export interface HistoryFilter {
  preset?: PresetId
  result?: Result
  pool?: PoolId
  /** §14.3 — "show me every game with an unnecessary guess". */
  mistake?: CoachClass
}

export function matchesFilter(rec: GameRecord, f: HistoryFilter): boolean {
  if (f.preset && rec.preset !== f.preset) return false
  if (f.result && rec.result !== f.result) return false
  if (f.pool && rec.pool !== f.pool) return false
  if (f.mistake && !(rec.mistakeClasses ?? []).includes(f.mistake)) return false
  return true
}

/**
 * Personal best for a pool: fastest *win*, ties broken by 3BV/s.
 *
 * Losses and abandons are excluded — §4.5 writes them to stats, but a PB is a
 * completed board by definition.
 */
export function personalBest(
  records: readonly GameRecord[],
  preset: PresetId,
  pool: PoolId = STANDARD_POOL,
): GameRecord | null {
  let best: GameRecord | null = null
  for (const r of records) {
    // A time set with every certainty highlighted is not a personal best.
    if (r.learning) continue
    if (r.preset !== preset || r.pool !== pool || r.result !== 'win') continue
    if (!best || r.durationMs < best.durationMs) best = r
  }
  return best
}

/** Board a record refers to, for replay reconstruction. */
export function boardOf(r: Replay): Board {
  return createBoard(specOf(r))
}
