import type { CachedGrades } from '../../engine/coach/grade.ts'
import type { Hints } from '../../engine/coach/hints.ts'
import type { Replay } from '../../engine/replay.ts'
import type { SolverView } from '../../engine/types.ts'
import type { CoachRequest, CoachResponse } from '../workers/coach.worker.ts'

/**
 * Promise wrapper over the coach worker. One worker, lazily created and kept
 * warm — spinning a new one per game would re-pay module init every time, and
 * learning mode asks it a question after every single move.
 */
let worker: Worker | null = null
let nextId = 1
type Pending = { resolve: (v: never) => void; reject: (e: Error) => void }
const pending = new Map<number, Pending>()

function ensure(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/coach.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (e: MessageEvent<CoachResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (!e.data.ok) p.reject(new Error(e.data.error))
    else if (e.data.kind === 'grade') (p.resolve as (g: CachedGrades) => void)(e.data.grades)
    else (p.resolve as (h: Hints) => void)(e.data.hints)
  })
  worker.addEventListener('error', (e) => {
    // A worker-level failure orphans every outstanding request.
    for (const [, p] of pending) p.reject(new Error(e.message || 'coach worker failed'))
    pending.clear()
  })
  return worker
}

function send<T>(req: CoachRequest): Promise<T> {
  const w = ensure()
  return new Promise<T>((resolve, reject) => {
    pending.set(req.id, { resolve, reject } as unknown as Pending)
    w.postMessage(req)
  })
}

export function gradeInWorker(replay: Replay): Promise<CachedGrades> {
  return send<CachedGrades>({ kind: 'grade', id: nextId++, replay })
}

/**
 * Live hints for learning mode. The view is structured-cloned, so the worker
 * gets a snapshot and cannot be confused by the board mutating underneath it.
 */
export function hintsInWorker(view: SolverView): Promise<Hints> {
  return send<Hints>({ kind: 'hints', id: nextId++, view })
}
