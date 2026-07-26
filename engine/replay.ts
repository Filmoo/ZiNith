import type { BoardSpec } from './board.ts'

export type EventType = 'open' | 'flag' | 'unflag' | 'chord'
export type Result = 'win' | 'loss' | 'abandoned'
export type PresetId = 'beginner' | 'intermediate' | 'expert' | 'custom'

export interface ReplayEvent {
  /** ms since timer start */
  t: number
  type: EventType
  cell: number
}

/** The board is never stored — it is regenerated from the seed. */
export interface Replay {
  v: 1
  id: string
  seed: string
  preset: PresetId
  dims: [number, number]
  mines: number
  firstClick: number
  noGuess: boolean
  scheme: 'standard' | 'flag-first' | 'no-flag' | 'drag-flag'
  events: ReplayEvent[]
  result: Result
  duration: number
  startedAt: number
}

export function newReplay(spec: BoardSpec, preset: PresetId, noGuess: boolean, scheme: Replay['scheme']): Replay {
  return {
    v: 1,
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    seed: spec.seed,
    preset,
    dims: [spec.width, spec.height],
    mines: spec.mineCount,
    firstClick: spec.firstClick,
    noGuess,
    scheme,
    events: [],
    result: 'abandoned',
    duration: 0,
    startedAt: Date.now(),
  }
}

export function specOf(r: Replay): BoardSpec {
  return { width: r.dims[0], height: r.dims[1], mineCount: r.mines, seed: r.seed, firstClick: r.firstClick }
}

/** Compact wire form for export/import (§15). */
export function encode(r: Replay): string {
  const ev = r.events.map((e) => `${e.t}:${e.type[0]}${e.cell}`).join(',')
  return [r.v, r.id, r.seed, r.preset, r.dims.join('x'), r.mines, r.firstClick,
    r.noGuess ? 1 : 0, r.scheme, r.result, r.duration, r.startedAt, ev].join('|')
}

const TYPE_OF: Record<string, EventType> = { o: 'open', f: 'flag', u: 'unflag', c: 'chord' }

export function decode(s: string): Replay {
  const p = s.split('|')
  const [w, h] = p[4].split('x').map(Number)
  const events: ReplayEvent[] = p[12]
    ? p[12].split(',').map((tok) => {
        const [t, rest] = tok.split(':')
        return { t: Number(t), type: TYPE_OF[rest[0]], cell: Number(rest.slice(1)) }
      })
    : []
  return {
    v: 1, id: p[1], seed: p[2], preset: p[3] as PresetId, dims: [w, h], mines: Number(p[5]),
    firstClick: Number(p[6]), noGuess: p[7] === '1', scheme: p[8] as Replay['scheme'],
    result: p[9] as Result, duration: Number(p[10]), startedAt: Number(p[11]), events,
  }
}
