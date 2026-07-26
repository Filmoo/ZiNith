import type { Board } from './board'
import { countSafeCells } from './board'
import { topology } from './topology'

export type GameStatus = 'ready' | 'playing' | 'won' | 'lost'

export type MoveType = 'open' | 'flag' | 'unflag' | 'chord'

/**
 * The replay log (§14.3). Timestamps are supplied by the caller rather than
 * read from a clock inside the engine: the engine has to run in a worker and
 * under test, and a replay has to reproduce exactly from the log.
 */
export interface GameEvent {
  /** Milliseconds since the first move. */
  readonly t: number
  readonly type: MoveType
  readonly cell: number
}

export interface GameOptions {
  /**
   * §7.3 — on in learning mode and drills, off in timed play. When on, a chord
   * that would detonate is rejected instead of ending the game.
   */
  readonly chordSafety: boolean
}

export type Rejection = 'out-of-turn' | 'already-revealed' | 'not-chordable' | 'unsafe-chord'

export interface MoveResult {
  readonly ok: boolean
  readonly rejected?: Rejection
  /** Cells revealed by this move, in reveal order. */
  readonly revealed: readonly number[]
  /** Mines opened by this move. Non-empty only on a loss. */
  readonly detonated: readonly number[]
  readonly status: GameStatus
}

const REJECTED = (rejected: Rejection, status: GameStatus): MoveResult => ({
  ok: false,
  rejected,
  revealed: [],
  detonated: [],
  status,
})

/**
 * Player-visible game state over an immutable Board.
 *
 * Deliberately mutable and allocation-light: the coach replays a full expert
 * game move by move for every grade pass (§8.2), so this is on a hot path.
 */
export class Game {
  readonly board: Board
  readonly options: GameOptions
  readonly revealed: Uint8Array
  readonly flagged: Uint8Array

  private _status: GameStatus = 'ready'
  private _revealedCount = 0
  private _flagCount = 0
  private readonly _events: GameEvent[] = []
  private readonly safeCells: number

  constructor(board: Board, options: GameOptions = { chordSafety: false }) {
    this.board = board
    this.options = options
    const size = board.width * board.height
    this.revealed = new Uint8Array(size)
    this.flagged = new Uint8Array(size)
    this.safeCells = countSafeCells(board)
  }

  get status(): GameStatus {
    return this._status
  }

  get revealedCount(): number {
    return this._revealedCount
  }

  get flagCount(): number {
    return this._flagCount
  }

  /** Mines remaining by the counter's reckoning — may go negative on overflag. */
  get minesRemaining(): number {
    return this.board.mines - this._flagCount
  }

  get events(): readonly GameEvent[] {
    return this._events
  }

  private get over(): boolean {
    return this._status === 'won' || this._status === 'lost'
  }

  open(cell: number, t = 0): MoveResult {
    if (this.over) return REJECTED('out-of-turn', this._status)
    if (this.revealed[cell] === 1 || this.flagged[cell] === 1) {
      return REJECTED('already-revealed', this._status)
    }

    this._status = 'playing'
    this.record(t, 'open', cell)

    if (this.board.mine[cell] === 1) {
      this.revealed[cell] = 1
      this._status = 'lost'
      return { ok: true, revealed: [], detonated: [cell], status: 'lost' }
    }

    const revealed: number[] = []
    this.flood(cell, revealed)
    this.checkWin()
    return { ok: true, revealed, detonated: [], status: this._status }
  }

  /** Toggles. Flagging a revealed cell is a no-op, not an error. */
  flag(cell: number, t = 0): MoveResult {
    if (this.over) return REJECTED('out-of-turn', this._status)
    if (this.revealed[cell] === 1) return REJECTED('already-revealed', this._status)

    this._status = 'playing'
    if (this.flagged[cell] === 1) {
      this.flagged[cell] = 0
      this._flagCount--
      this.record(t, 'unflag', cell)
    } else {
      this.flagged[cell] = 1
      this._flagCount++
      this.record(t, 'flag', cell)
    }
    return { ok: true, revealed: [], detonated: [], status: this._status }
  }

  /**
   * Open every unflagged neighbour of a satisfied number. If the flags are
   * wrong this detonates — unless chord safety is on, in which case the move is
   * rejected so the UI can flash instead (§7.3).
   */
  chord(cell: number, t = 0): MoveResult {
    if (this.over) return REJECTED('out-of-turn', this._status)
    if (this.revealed[cell] !== 1) return REJECTED('not-chordable', this._status)

    const number = this.board.adjacent[cell]
    if (number === 0) return REJECTED('not-chordable', this._status)

    const neighbours = topology(this.board.width, this.board.height).neighbours[cell]
    let flags = 0
    const targets: number[] = []
    for (const n of neighbours) {
      if (this.flagged[n] === 1) flags++
      else if (this.revealed[n] === 0) targets.push(n)
    }
    if (flags !== number) return REJECTED('not-chordable', this._status)
    if (targets.length === 0) return REJECTED('not-chordable', this._status)

    if (this.options.chordSafety) {
      for (const target of targets) {
        if (this.board.mine[target] === 1) return REJECTED('unsafe-chord', this._status)
      }
    }

    this.record(t, 'chord', cell)

    const detonated: number[] = []
    for (const target of targets) {
      if (this.board.mine[target] === 1) {
        this.revealed[target] = 1
        detonated.push(target)
      }
    }
    if (detonated.length > 0) {
      this._status = 'lost'
      return { ok: true, revealed: [], detonated, status: 'lost' }
    }

    const revealed: number[] = []
    for (const target of targets) this.flood(target, revealed)
    this.checkWin()
    return { ok: true, revealed, detonated: [], status: this._status }
  }

  /** Flood-fill from a known-safe cell, stopping at numbers. */
  private flood(start: number, out: number[]): void {
    if (this.revealed[start] === 1) return
    const topo = topology(this.board.width, this.board.height)
    const stack = [start]
    while (stack.length > 0) {
      const cell = stack.pop() as number
      if (this.revealed[cell] === 1) continue
      this.revealed[cell] = 1
      this._revealedCount++
      out.push(cell)
      // A flag on a cell we just proved safe is stale; drop it so the mine
      // counter stays honest.
      if (this.flagged[cell] === 1) {
        this.flagged[cell] = 0
        this._flagCount--
      }
      if (this.board.adjacent[cell] !== 0) continue
      for (const n of topo.neighbours[cell]) {
        if (this.revealed[n] === 0 && this.board.mine[n] === 0) stack.push(n)
      }
    }
  }

  private checkWin(): void {
    if (this._revealedCount === this.safeCells) this._status = 'won'
  }

  private record(t: number, type: MoveType, cell: number): void {
    this._events.push({ t, type, cell })
  }
}

/**
 * Rebuild a game from its event log. The board itself comes from the seed
 * (§14.3), so a replay is `(seed, spec, firstClick)` plus this log — which is
 * why scrubbing to an arbitrary move is instant.
 */
export function replay(
  board: Board,
  events: readonly GameEvent[],
  options: GameOptions = { chordSafety: false },
  upToMove = events.length,
): Game {
  const game = new Game(board, options)
  const limit = Math.min(upToMove, events.length)
  for (let i = 0; i < limit; i++) {
    const event = events[i]
    switch (event.type) {
      case 'open':
        game.open(event.cell, event.t)
        break
      case 'flag':
      case 'unflag':
        game.flag(event.cell, event.t)
        break
      case 'chord':
        game.chord(event.cell, event.t)
        break
    }
  }
  return game
}
