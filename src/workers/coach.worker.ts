/**
 * §8.2 — the coach runs in a worker, automatically, the moment a game ends.
 *
 * It has to be off the main thread: grading unions every solver tier including
 * the tank for each move, which is hundreds of enumerations for an expert game.
 * Timed play never invokes any of this mid-game.
 */
import { gradeReplay, type CachedGrades } from '../../engine/coach/grade.ts'
import type { Replay } from '../../engine/replay.ts'

export interface CoachRequest {
  id: number
  replay: Replay
}

export type CoachResponse =
  | { id: number; ok: true; grades: CachedGrades; ms: number }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', (e: MessageEvent<CoachRequest>) => {
  const { id, replay } = e.data
  const t0 = performance.now()
  try {
    const grades = gradeReplay(replay)
    const res: CoachResponse = { id, ok: true, grades, ms: performance.now() - t0 }
    ctx.postMessage(res)
  } catch (err) {
    const res: CoachResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ctx.postMessage(res)
  }
})
