/**
 * §8.2 — the coach runs in a worker, automatically, the moment a game ends.
 *
 * It has to be off the main thread: grading unions every solver tier including
 * the tank for each move, which is hundreds of enumerations for an expert game.
 * Timed play never invokes any of this mid-game.
 *
 * The same worker also answers live hint requests for learning mode (§7.3),
 * which is one solver call per state change. Sharing the worker keeps module
 * init paid once — the engine is the bulk of the chunk and both jobs need all
 * of it.
 */
import { gradeReplay, type CachedGrades } from '../../engine/coach/grade.ts'
import { hintsFor, type Hints } from '../../engine/coach/hints.ts'
import type { Replay } from '../../engine/replay.ts'
import type { SolverView } from '../../engine/types.ts'

export type CoachRequest =
  | { kind: 'grade'; id: number; replay: Replay }
  | { kind: 'hints'; id: number; view: SolverView }

export type CoachResponse =
  | { kind: 'grade'; id: number; ok: true; grades: CachedGrades; ms: number }
  | { kind: 'hints'; id: number; ok: true; hints: Hints; ms: number }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', (e: MessageEvent<CoachRequest>) => {
  const req = e.data
  const t0 = performance.now()
  try {
    const res: CoachResponse =
      req.kind === 'grade'
        ? { kind: 'grade', id: req.id, ok: true, grades: gradeReplay(req.replay), ms: performance.now() - t0 }
        : { kind: 'hints', id: req.id, ok: true, hints: hintsFor(req.view), ms: performance.now() - t0 }
    ctx.postMessage(res)
  } catch (err) {
    const res: CoachResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ctx.postMessage(res)
  }
})
