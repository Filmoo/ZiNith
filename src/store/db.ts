import Dexie, { type Table } from 'dexie'
import type { CachedGrades } from '../../engine/coach/grade.ts'
import {
  matchesFilter, recordOf, withGrades,
  type GameRecord, type HistoryFilter,
} from '../../engine/record.ts'
import { decode, type Replay } from '../../engine/replay.ts'

/**
 * Local storage for replays and coach output (§14.3, §8.4).
 *
 * Two tables rather than one because they have different lifetimes: a replay is
 * immutable and permanent, while grades are derived and get thrown away whenever
 * the solver changes (`CachedGrades.v`). Retention is unlimited per §8.4 —
 * ~10KB a game puts ten thousand games under 100MB — so there is no pruning
 * policy here on purpose.
 */
class ZinithDB extends Dexie {
  games!: Table<GameRecord, string>
  grades!: Table<CachedGrades, string>

  constructor() {
    super('zinith')
    this.version(1).stores({
      // `*mistakeClasses` is a multi-entry index: §14.3's highest-value query is
      // "show me every game with an unnecessary guess".
      games: 'id, startedAt, preset, result, pool, *mistakeClasses',
      grades: 'replayId',
    })
  }
}

export const db = new ZinithDB()

/**
 * Write a finished game. Called the moment the game ends, *before* the coach has
 * run — a game must appear in history immediately, not once the worker returns.
 * Idempotent, so an abandon that also trips the phase watcher cannot duplicate.
 */
export async function saveReplay(r: Replay): Promise<GameRecord> {
  const rec = recordOf(r)
  return db.transaction('rw', db.games, async () => {
    // A finished game can be written twice — once by the phase watcher, once by
    // the abandon path on "new game". `recordOf` knows nothing about the coach,
    // so a blind put would wipe grades that had already been folded in.
    const prev = await db.games.get(r.id)
    const merged: GameRecord = prev
      ? {
          ...rec,
          accuracy: prev.accuracy,
          clicksLost: prev.clicksLost,
          hesitationMs: prev.hesitationMs,
          mistakeClasses: prev.mistakeClasses,
          coachV: prev.coachV,
        }
      : rec
    await db.games.put(merged)
    return merged
  })
}

/** Fold coach output into the stored row once the worker returns (§8.4). */
export async function saveGrades(g: CachedGrades): Promise<void> {
  await db.transaction('rw', db.games, db.grades, async () => {
    await db.grades.put(g)
    const rec = await db.games.get(g.replayId)
    if (rec) await db.games.put(withGrades(rec, g))
  })
}

export function getGame(id: string): Promise<GameRecord | undefined> {
  return db.games.get(id)
}

export function getGrades(id: string): Promise<CachedGrades | undefined> {
  return db.grades.get(id)
}

export function replayOf(rec: GameRecord): Replay {
  return decode(rec.replay)
}

export interface ListOpts {
  limit?: number
  offset?: number
}

/**
 * History rows, newest first (§14.3).
 *
 * Filtering runs in JS over an index-ordered cursor rather than as a compound
 * index. Dexie cannot index the four filters together anyway, and the rows are
 * small enough that the cursor walk is cheaper than maintaining the indexes
 * would be.
 */
export async function listGames(
  filter: HistoryFilter = {},
  { limit = 50, offset = 0 }: ListOpts = {},
): Promise<GameRecord[]> {
  return db.games
    .orderBy('startedAt')
    .reverse()
    .filter((rec) => matchesFilter(rec, filter))
    .offset(offset)
    .limit(limit)
    .toArray()
}

export async function countGames(filter: HistoryFilter = {}): Promise<number> {
  return db.games.filter((rec) => matchesFilter(rec, filter)).count()
}

/** Every record, for the personal-best and trend computations on home (§14.1). */
export async function allGames(): Promise<GameRecord[]> {
  return db.games.orderBy('startedAt').toArray()
}
