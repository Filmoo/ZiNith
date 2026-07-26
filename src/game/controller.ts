import {
  createBoard, open, toggleFlag, canChord, chord, chordWouldExplode, isWon,
  type Board, type BoardSpec,
} from '../../engine/board.ts'
import { generateNoGuess } from '../../engine/generate.ts'
import { newReplay, type Replay, type PresetId, type EventType } from '../../engine/replay.ts'
import { threeBV } from '../../engine/metrics/threebv.ts'
import { HIDDEN, FLAGGED } from '../../engine/types.ts'

export type Scheme = 'standard' | 'flag-first' | 'no-flag' | 'drag-flag'
export type Phase = 'idle' | 'playing' | 'won' | 'lost'

/** One tick of the solve ribbon (§8.3). Colour comes later from the coach. */
export interface Tick { type: EventType; atMs: number; durMs: number }

export interface GameConfig {
  preset: PresetId
  width: number
  height: number
  mines: number
  noGuess: boolean
  scheme: Scheme
  /** §7.3 — on in learning, off in play. */
  chordSafety: boolean
}

export interface Snapshot {
  phase: Phase
  elapsedMs: number
  minesLeft: number
  clicks: number
  threeBV: number
  bvs: number
  efficiency: number
  ticks: Tick[]
}

/**
 * Framework-free game controller. Owns the board and the replay log; React
 * only subscribes. Generation happens on the first click (§4.3) — measured at
 * p99 53ms for expert, so no pre-generated pool is required.
 */
export class Game {
  readonly cfg: GameConfig
  board: Board | null = null
  phase: Phase = 'idle'
  replay: Replay | null = null
  ticks: Tick[] = []
  clicks = 0
  bv = 0
  /** Cells needing repaint since the last frame. */
  dirty = new Set<number>()
  private startPerf = 0
  private endPerf = 0
  private lastMoveMs = 0
  private listeners = new Set<() => void>()
  private generate: (base: Omit<BoardSpec, 'seed'>) => BoardSpec | null

  constructor(cfg: GameConfig, generate?: (b: Omit<BoardSpec, 'seed'>) => BoardSpec | null) {
    this.cfg = cfg
    this.generate = generate ?? ((base) => {
      if (!cfg.noGuess) return { ...base, seed: Math.random().toString(36).slice(2, 10) }
      const r = generateNoGuess(base, { maxAttempts: 5000 })
      return r ? r.spec : { ...base, seed: Math.random().toString(36).slice(2, 10) }
    })
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  private emit() { for (const fn of this.listeners) fn() }

  get size() { return this.cfg.width * this.cfg.height }

  elapsedMs(): number {
    if (this.phase === 'idle') return 0
    const end = this.phase === 'playing' ? performance.now() : this.endPerf
    return end - this.startPerf
  }

  /** Opening a cell. On the first click this also creates the board. */
  open(cell: number): void {
    if (this.phase === 'won' || this.phase === 'lost') return
    if (this.phase === 'idle') {
      const spec = this.generate({
        width: this.cfg.width, height: this.cfg.height,
        mineCount: this.cfg.mines, firstClick: cell,
      })
      if (!spec) return
      this.board = createBoard(spec)
      this.bv = threeBV(this.board).value
      this.replay = newReplay(spec, this.cfg.preset, this.cfg.noGuess, this.cfg.scheme)
      this.startPerf = performance.now()
      this.lastMoveMs = 0
      this.phase = 'playing'
    }
    const b = this.board!
    if (b.state[cell] !== HIDDEN) return
    this.markDirty(open(b, cell))
    this.record('open', cell)
    this.settle()
  }

  flag(cell: number): void {
    if (this.phase !== 'playing' || this.cfg.scheme === 'no-flag') return
    const b = this.board!
    if (b.state[cell] !== HIDDEN && b.state[cell] !== FLAGGED) return
    const nowFlagged = toggleFlag(b, cell)
    this.dirty.add(cell)
    this.record(nowFlagged ? 'flag' : 'unflag', cell)
    this.settle()
  }

  chord(cell: number): void {
    if (this.phase !== 'playing' || this.cfg.scheme === 'no-flag') return
    const b = this.board!
    if (!canChord(b, cell)) return
    // §7.3 chord safety: flash instead of exploding when enabled.
    if (this.cfg.chordSafety && chordWouldExplode(b, cell)) {
      this.dirty.add(cell)
      this.emit()
      return
    }
    this.markDirty(chord(b, cell))
    this.record('chord', cell)
    this.settle()
  }

  /** Only legal outside timed play (§7.3). Caller enforces mode. */
  private markDirty(cells: number[]) { for (const c of cells) this.dirty.add(c) }

  private record(type: EventType, cell: number) {
    const t = this.elapsedMs()
    this.clicks++
    this.replay!.events.push({ t: Math.round(t), type, cell })
    this.ticks.push({ type, atMs: t, durMs: t - this.lastMoveMs })
    this.lastMoveMs = t
  }

  private settle() {
    const b = this.board!
    if (b.exploded) this.finish('lost')
    else if (isWon(b)) this.finish('won')
    this.emit()
  }

  private finish(phase: 'won' | 'lost') {
    this.phase = phase
    this.endPerf = performance.now()
    if (this.replay) {
      this.replay.result = phase === 'won' ? 'win' : 'loss'
      this.replay.duration = Math.round(this.endPerf - this.startPerf)
    }
    for (let i = 0; i < this.size; i++) this.dirty.add(i)
  }

  abandon() {
    if (this.phase !== 'playing') return
    this.phase = 'lost'
    this.endPerf = performance.now()
    if (this.replay) {
      this.replay.result = 'abandoned'
      this.replay.duration = Math.round(this.endPerf - this.startPerf)
    }
    this.emit()
  }

  snapshot(): Snapshot {
    const b = this.board
    const ms = this.elapsedMs()
    const secs = ms / 1000
    return {
      phase: this.phase,
      elapsedMs: ms,
      minesLeft: b ? this.cfg.mines - b.flagCount : this.cfg.mines,
      clicks: this.clicks,
      threeBV: this.bv,
      bvs: secs > 0 ? this.bv / secs : 0,
      efficiency: this.clicks > 0 ? this.bv / this.clicks : 0,
      ticks: this.ticks,
    }
  }
}
