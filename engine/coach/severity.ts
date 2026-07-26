import type { Replay } from '../replay.ts'
import { MISTAKE_CLASSES } from '../record.ts'
import type { CoachClass, Grade } from './grade.ts'

/**
 * Not all mistakes are the same size, and a flat list of them buries the one
 * that matters. Reviewing a game is triage: the question is never "what did I
 * get wrong" but "what do I fix first".
 *
 * Ordering is by consequence, not by class name. A guess that ended the game
 * outranks a guess that happened to survive, even though the read was identical,
 * because the cost actually landed. A wasted click is real but recoverable and
 * sorts below both.
 */

export type Severity = 'critical' | 'major' | 'minor'

export interface RankedMistake {
  grade: Grade
  severity: Severity
  score: number
  /** One line for the UI, explaining why it sits where it does. */
  reason: string
}

/** Base weight per class. Only mistake classes appear here. */
const CLASS_WEIGHT: Partial<Record<CoachClass, number>> = {
  error: 400,
  'unnecessary-guess': 200,
  suboptimal: 40,
}

/** Ending the game dwarfs everything else it could be compared against. */
const FATAL_BONUS = 1000
const CLICK_WEIGHT = 25
/** Time is capped so one long think cannot outweigh a detonation. */
const MAX_TIME_PENALTY = 40

export interface RankOpts {
  /** Index of the move that ended the game, when it ended badly. */
  fatalIndex?: number
}

export function scoreOf(g: Grade, { fatalIndex }: RankOpts = {}): number {
  const base = CLASS_WEIGHT[g.class] ?? 0
  if (base === 0) return 0
  const fatal = fatalIndex !== undefined && g.moveIndex === fatalIndex ? FATAL_BONUS : 0
  const clicks = g.costClicks * CLICK_WEIGHT
  const time = Math.min(MAX_TIME_PENALTY, (Math.max(0, g.costMs) / 1000) * 4)
  return base + fatal + clicks + time
}

export function severityOf(score: number): Severity {
  if (score >= 500) return 'critical'
  if (score >= 150) return 'major'
  return 'minor'
}

function reasonFor(g: Grade, fatal: boolean): string {
  if (fatal) {
    return g.class === 'error'
      ? 'Opened a cell the board had already proven was a mine, and lost the game on it.'
      : 'Guessed with a certainty available, and lost the game on it.'
  }
  switch (g.class) {
    case 'error':
      return 'Provably wrong: the board already said this cell was a mine, or that flag was not one.'
    case 'unnecessary-guess':
      return 'A certainty was on the board. This move gambled instead of reading it.'
    case 'suboptimal':
      return 'A click that revealed nothing — pure cost.'
    default:
      return ''
  }
}

/**
 * Mistakes worst-first.
 *
 * `fatalIndex` is derived from the replay rather than the grades: the last event
 * of a lost game is the one that detonated. A *forced* guess that killed you is
 * deliberately not promoted — it was not a mistake, and surfacing it as the top
 * thing to fix would teach the wrong lesson about a board that gave you nothing.
 */
export function rankMistakes(grades: readonly Grade[], replay?: Pick<Replay, 'result' | 'events'>): RankedMistake[] {
  const fatalIndex =
    replay && replay.result === 'loss' && replay.events.length > 0
      ? replay.events.length - 1
      : undefined

  const out: RankedMistake[] = []
  for (const g of grades) {
    if (!MISTAKE_CLASSES.includes(g.class)) continue
    const score = scoreOf(g, fatalIndex === undefined ? {} : { fatalIndex })
    if (score <= 0) continue
    out.push({
      grade: g,
      score,
      severity: severityOf(score),
      reason: reasonFor(g, fatalIndex === g.moveIndex),
    })
  }

  // Worst first; ties keep board order so the list still reads chronologically
  // within a severity band.
  return out.sort((a, b) => b.score - a.score || a.grade.moveIndex - b.grade.moveIndex)
}

export interface MistakeTally {
  critical: number
  major: number
  minor: number
  total: number
}

export function tally(ranked: readonly RankedMistake[]): MistakeTally {
  const t: MistakeTally = { critical: 0, major: 0, minor: 0, total: ranked.length }
  for (const m of ranked) t[m.severity]++
  return t
}
