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

/**
 * Ticks for a stored game. The live ribbon is fed by `Game.ticks`, but a replay
 * opened from history has only the event log, so rebuild them from the
 * timestamps — the ribbon is the same object in-game and in review (§8.3).
 */
export function ticksOf(r: Replay): Tick[] {
  let prev = 0
  return r.events.map((e) => {
    const durMs = Math.max(0, e.t - prev)
    prev = e.t
    return { type: e.type, atMs: e.t, durMs }
  })
}

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
  /** Whole-board 3BV, fixed once the board exists. */
  threeBV: number
  /** 3BV cleared so far. Equals `threeBV` on a win. */
  threeBVDone: number
  /** Live 3BV/s: cleared 3BV over elapsed time, not whole-board over elapsed. */
  bvs: number
  /** Live IOE: cleared 3BV over clicks spent. */
  efficiency: number
  ticks: Tick[]
}

/**
 * Framework-free game controller. Owns the board and the replay log; React
 * only subscribes. Generation currently happens synchronously on the first
 * click (§4.3), measured at p99 53ms for expert.
 *
 * Spec delta v1.1 makes no-guess the default for every preset, which promotes
 * the §4.4 seed pool from an optimization to required infrastructure — that is
 * P3, and it lands by replacing the `generate` callback below. Note that a pool
 * can only supply a *seed*: a board is `(seed, firstClick)`, so the pooled seed
 * still has to be checked against the cell the player actually opens.
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
  /**
   * Live 3BV progress. A 3BV unit is either an opening (done as soon as any of
   * its zero cells is revealed, since the cascade takes the rest) or a numbered
   * cell no opening touches. `openingOf` from `threeBV` distinguishes them.
   */
  private openingOf: Int32Array | null = null
  private openingsDone = new Set<number>()
  private isolatedDone = 0
  private bvCredited: Uint8Array | null = null
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
      const bv = threeBV(this.board)
      this.bv = bv.value
      this.openingOf = bv.openingOf
      this.bvCredited = new Uint8Array(this.size)
      this.replay = newReplay(spec, this.cfg.preset, this.cfg.noGuess, this.cfg.scheme)
      this.startPerf = performance.now()
      this.lastMoveMs = 0
      this.phase = 'playing'
    }
    const b = this.board!
    if (b.state[cell] !== HIDDEN) return
    const revealed = open(b, cell)
    this.markDirty(revealed)
    this.creditBV(revealed)
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
    const revealed = chord(b, cell)
    this.markDirty(revealed)
    this.creditBV(revealed)
    this.record('chord', cell)
    this.settle()
  }

  /** Only legal outside timed play (§7.3). Caller enforces mode. */
  private markDirty(cells: number[]) { for (const c of cells) this.dirty.add(c) }

  /**
   * Credit newly revealed cells against 3BV. Idempotent per cell, so it is safe
   * even if a cell were ever reported twice. Mines carry no 3BV unit.
   */
  private creditBV(cells: number[]) {
    const b = this.board!
    const oo = this.openingOf, seen = this.bvCredited
    if (!oo || !seen) return
    for (const c of cells) {
      if (seen[c] || b.mines[c]) continue
      seen[c] = 1
      if (b.adj[c] === 0) this.openingsDone.add(oo[c])
      else if (oo[c] === -1) this.isolatedDone++
    }
  }

  /** 3BV cleared so far. */
  get bvDone(): number { return this.openingsDone.size + this.isolatedDone }

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
      threeBVDone: this.bvDone,
      bvs: secs > 0 ? this.bvDone / secs : 0,
      efficiency: this.clicks > 0 ? this.bvDone / this.clicks : 0,
      ticks: this.ticks,
    }
  }
}
