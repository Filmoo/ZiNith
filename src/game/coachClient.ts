import type { CachedGrades } from '../../engine/coach/grade.ts'
import type { Replay } from '../../engine/replay.ts'
import type { CoachRequest, CoachResponse } from '../workers/coach.worker.ts'

/**
 * Promise wrapper over the coach worker. One worker, lazily created and kept
 * warm — spinning a new one per game would re-pay module init every time.
 */
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (g: CachedGrades) => void; reject: (e: Error) => void }>()

function ensure(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/coach.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (e: MessageEvent<CoachResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok) p.resolve(e.data.grades)
    else p.reject(new Error(e.data.error))
  })
  worker.addEventListener('error', (e) => {
    // A worker-level failure orphans every outstanding request.
    for (const [, p] of pending) p.reject(new Error(e.message || 'coach worker failed'))
    pending.clear()
  })
  return worker
}

export function gradeInWorker(replay: Replay): Promise<CachedGrades> {
  const w = ensure()
  const id = nextId++
  const req: CoachRequest = { id, replay }
  return new Promise<CachedGrades>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage(req)
  })
}
