import type { Board, Openings } from './board'
import { countSafeCells, findOpenings, floodOpen, revealSet } from './board'
import type { Game, GameEvent } from './game'
import { solve, viewFromBoard } from './solver'
import { topology } from './topology'

/**
 * Board and game metrics: 3BV, ZiNi, HZiNi, and the rates the trend line plots
 * (§14.1).
 *
 * 3BV is unambiguous and every implementation agrees on it. ZiNi is not — it is
 * defined by a greedy algorithm rather than by an optimum, so two faithful
 * implementations can disagree on tie-breaking. §13.2 leaves community parity
 * open pending published reference values; `docs/zini.md` records exactly what
 * this implementation does so the comparison can be made rather than guessed at.
 */

/**
 * Bechtel's Board Benchmark Value: the minimum left-clicks to clear the board
 * without chording. Each opening is one click; every other safe cell that no
 * opening reaches must be clicked individually.
 */
export function calc3BV(board: Board, openings: Openings = findOpenings(board)): number {
  const topo = topology(board.width, board.height)
  let value = openings.count
  for (let i = 0; i < topo.size; i++) {
    if (board.mine[i] === 1 || board.adjacent[i] === 0) continue
    // A numbered cell is free if some opening's border includes it.
    let touchesOpening = false
    for (const n of topo.neighbours[i]) {
      if (board.mine[n] === 0 && board.adjacent[n] === 0) {
        touchesOpening = true
        break
      }
    }
    if (!touchesOpening) value++
  }
  return value
}

export interface ClickPlan {
  /** Total clicks: opens + flags + chords. */
  readonly clicks: number
  readonly opens: number
  readonly flags: number
  readonly chords: number
}

interface Workspace {
  board: Board
  openings: Openings
  opened: Uint8Array
  flagged: Uint8Array
  openedSafe: number
  safeTotal: number
}

function workspace(board: Board): Workspace {
  const size = board.width * board.height
  return {
    board,
    openings: findOpenings(board),
    opened: new Uint8Array(size),
    flagged: new Uint8Array(size),
    openedSafe: 0,
    safeTotal: countSafeCells(board),
  }
}

function open(ws: Workspace, cell: number): void {
  for (const c of revealSet(ws.openings, cell)) {
    if (ws.opened[c] === 0) {
      ws.opened[c] = 1
      ws.openedSafe++
    }
  }
}

/**
 * What a chord on `cell` would cost and gain right now.
 *
 * Cost is the click to open the cell (if it is still covered), one click per
 * mine neighbour that still needs a flag, and the chord itself. Gain is the
 * covered safe cells it would uncover, openings included.
 */
interface ChordOption {
  cell: number
  cost: number
  gain: number
}

function evaluateChord(
  ws: Workspace,
  cell: number,
  stamp: Int32Array,
  mark: number,
  /** Only flag mines this predicate accepts. HZiNi restricts to proven mines. */
  canFlag: (mine: number) => boolean,
): ChordOption | null {
  const { board } = ws
  if (board.mine[cell] === 1 || board.adjacent[cell] === 0) return null

  const neighbours = topology(board.width, board.height).neighbours[cell]
  let flagsNeeded = 0
  let gain = 0

  for (const n of neighbours) {
    if (board.mine[n] === 1) {
      if (ws.flagged[n] === 1) continue
      if (!canFlag(n)) return null
      flagsNeeded++
    } else if (ws.opened[n] === 0) {
      for (const c of revealSet(ws.openings, n)) {
        if (ws.opened[c] === 0 && stamp[c] !== mark) {
          stamp[c] = mark
          gain++
        }
      }
    }
  }

  if (gain === 0) return null

  let cost = 1 + flagsNeeded
  if (ws.opened[cell] === 0) {
    cost += 1
    if (stamp[cell] !== mark) {
      stamp[cell] = mark
      gain++
    }
  }

  return { cell, cost, gain }
}

function applyChord(ws: Workspace, cell: number): void {
  const neighbours = topology(ws.board.width, ws.board.height).neighbours[cell]
  if (ws.opened[cell] === 0) open(ws, cell)
  for (const n of neighbours) {
    if (ws.board.mine[n] === 1) ws.flagged[n] = 1
  }
  for (const n of neighbours) {
    if (ws.board.mine[n] === 0 && ws.opened[n] === 0) open(ws, n)
  }
}

/**
 * ZiNi: a greedy estimate of the fewest clicks a player with full knowledge of
 * the board needs to clear it, chording allowed.
 *
 * Greedy, not optimal — computing the true minimum is a set-cover problem. The
 * rule is: repeatedly take the chord with the best clicks saved (gain - cost),
 * then click whatever is left. Ties break on the larger gain, then the lower
 * cell index, purely so the result is deterministic.
 *
 * Break-even chords are taken, not skipped. Opening a cell and flagging its
 * mine to chord it often saves nothing on that move but leaves an opened number
 * and a placed flag behind, and the next chord costs one click because of it.
 * Requiring a strict saving stalls the greedy on its first move and inflates
 * the count badly — on a 3×3 with a single central mine it gives 8 instead of 5.
 */
export function zini(board: Board): ClickPlan {
  const plan = best(greedy(board, () => true, null, true), greedy(board, () => true, null, false))
  // Unreachable: with full knowledge there is always a covered safe cell to
  // click while any remain, so the greedy never runs out of moves.
  if (!plan) throw new Error('zini: greedy stalled on a fully known board')
  return plan
}

/**
 * The greedy is myopic, so a chord that looks free this move can leave the
 * board needing an extra click two moves later — occasionally landing above
 * 3BV, which is nonsense for a metric whose whole point is that chording helps.
 * Clicking the board out plain is always a legal line, so run that too and
 * report whichever came out shorter. That is closer to ZiNi's definition
 * (fewest clicks with chording *allowed*) than trusting one greedy pass.
 */
function best(a: ClickPlan | null, b: ClickPlan | null): ClickPlan | null {
  if (!a) return b
  if (!b) return a
  return b.clicks < a.clicks ? b : a
}

/**
 * HZiNi: ZiNi restricted to what a player could actually know.
 *
 * A cell may only be opened once the solver has proven it safe, and a mine may
 * only be flagged once the solver has proven it is a mine — so HZiNi measures
 * optimal *human* play rather than optimal play by someone holding the answer
 * key. This is the number learning mode compares against (§7.3).
 *
 * Returns null when the board cannot be cleared from `firstClick` without a
 * guess, because there is no human-optimal click count for a board that needs
 * one.
 */
export function hzini(board: Board, firstClick: number): ClickPlan | null {
  if (board.mine[firstClick] === 1) return null
  return best(greedy(board, null, firstClick, true), greedy(board, null, firstClick, false))
}

function greedy(
  board: Board,
  fullKnowledge: (() => boolean) | null,
  firstClick: number | null,
  allowChords: boolean,
): ClickPlan | null {
  const ws = workspace(board)
  const size = board.width * board.height
  const stamp = new Int32Array(size).fill(-1)
  let mark = 0

  let opens = 0
  let flags = 0
  let chords = 0

  // HZiNi knowledge: which mines the solver has proven, and which covered cells
  // it has proven safe. Recomputed whenever the board state changes.
  let provenMine = new Uint8Array(size)
  let provenSafe = new Uint8Array(size)

  const refreshKnowledge = (): void => {
    if (fullKnowledge) return
    provenMine = new Uint8Array(size)
    provenSafe = new Uint8Array(size)
    const result = solve(viewFromBoard(board, ws.opened))
    for (const cell of result.mines) provenMine[cell] = 1
    for (const cell of result.safe) provenSafe[cell] = 1
  }

  const canFlag = fullKnowledge ? () => true : (mine: number) => provenMine[mine] === 1

  if (firstClick !== null) {
    opens++
    open(ws, firstClick)
  }
  refreshKnowledge()

  for (;;) {
    if (ws.openedSafe === ws.safeTotal) break

    // Best chord available under the current knowledge.
    let bestChord: ChordOption | null = null
    for (let cell = 0; allowChords && cell < size; cell++) {
      if (board.mine[cell] === 1 || board.adjacent[cell] === 0) continue
      // A covered cell can only be opened if we know it is safe.
      if (!fullKnowledge && ws.opened[cell] === 0 && provenSafe[cell] !== 1) continue
      const option = evaluateChord(ws, cell, stamp, ++mark, canFlag)
      if (!option) continue
      if (option.gain - option.cost < 0) continue
      if (
        bestChord === null ||
        option.gain - option.cost > bestChord.gain - bestChord.cost ||
        (option.gain - option.cost === bestChord.gain - bestChord.cost &&
          option.gain > bestChord.gain)
      ) {
        bestChord = option
      }
    }

    // The best plain click competes with the best chord on the same terms. Left
    // out of the comparison, the greedy will happily spend three clicks setting
    // up a chord that reveals a region one click would have opened anyway.
    const plain = fullKnowledge
      ? bestPlainClick(ws, () => true)
      : bestPlainClick(ws, (cell) => provenSafe[cell] === 1)

    const chordScore = bestChord ? bestChord.gain - bestChord.cost : -Infinity
    const plainScore = plain ? plain.gain - 1 : -Infinity

    if (chordScore === -Infinity && plainScore === -Infinity) {
      // HZiNi only: nothing proven safe and no chord available — the board
      // needs a guess, so there is no human-optimal line.
      return null
    }

    // Ties go to the plain click. A break-even chord spends flags for no
    // immediate saving, and the flags only pay off if a later chord happens to
    // reuse them — which the greedy cannot see from here.
    const takeChord = bestChord !== null && (plain === null || chordScore > plainScore)

    if (takeChord) {
      const cell = bestChord as ChordOption
      if (ws.opened[cell.cell] === 0) opens++
      for (const n of topology(board.width, board.height).neighbours[cell.cell]) {
        if (board.mine[n] === 1 && ws.flagged[n] === 0) flags++
      }
      chords++
      applyChord(ws, cell.cell)
    } else {
      opens++
      open(ws, (plain as PlainClick).cell)
    }
    refreshKnowledge()
  }

  return { clicks: opens + flags + chords, opens, flags, chords }
}

interface PlainClick {
  cell: number
  gain: number
}

/**
 * The covered safe cell that a single click uncovers the most of. Clicking a
 * bare number when an opening was available wastes the opening's free border,
 * so plain clicks go to the biggest reveal first. Ties go to the lower index
 * for determinism.
 */
function bestPlainClick(ws: Workspace, accept: (cell: number) => boolean): PlainClick | null {
  let best: PlainClick | null = null
  for (let cell = 0; cell < ws.opened.length; cell++) {
    if (ws.opened[cell] === 1 || ws.board.mine[cell] === 1) continue
    if (!accept(cell)) continue
    let gain = 0
    for (const c of revealSet(ws.openings, cell)) if (ws.opened[c] === 0) gain++
    if (gain > 0 && (best === null || gain > best.gain)) best = { cell, gain }
  }
  return best
}

// ---- game-level metrics ----------------------------------------------------

export interface GameMetrics {
  readonly bbbv: number
  /** Clicks the player actually spent. */
  readonly clicks: number
  readonly timeMs: number
  readonly bbbvPerSecond: number
  /**
   * Classic efficiency: 3BV over clicks spent. 100% means every click did the
   * work of a perfect no-chord click; chording pushes it above 100%.
   */
  readonly efficiency: number
  /** Fraction of the board's 3BV the player actually cleared. */
  readonly progress: number
}

export function gameMetrics(game: Game, openings?: Openings): GameMetrics {
  const board = game.board
  const bbbv = calc3BV(board, openings)
  const clicks = game.events.length
  const timeMs = game.events.length === 0 ? 0 : (game.events[game.events.length - 1].t as number)
  const cleared = clearedBBBV(game)
  return {
    bbbv,
    clicks,
    timeMs,
    bbbvPerSecond: timeMs > 0 ? (cleared / timeMs) * 1000 : 0,
    efficiency: clicks > 0 ? cleared / clicks : 0,
    progress: bbbv > 0 ? cleared / bbbv : 0,
  }
}

/**
 * How much of the board's 3BV the player got through. On a win this equals the
 * board's 3BV; on a loss it is the part they cleared, which is what makes a
 * lost game's 3BV/s comparable to a won one.
 */
export function clearedBBBV(game: Game): number {
  const { board, revealed } = game
  const openings = findOpenings(board)
  const topo = topology(board.width, board.height)
  let cleared = 0

  const seenRegion = new Set<number>()
  for (let i = 0; i < topo.size; i++) {
    if (revealed[i] === 0 || board.mine[i] === 1) continue
    const region = openings.regionOf[i]
    if (region !== -1) {
      if (!seenRegion.has(region)) {
        seenRegion.add(region)
        cleared++
      }
      continue
    }
    let touchesOpening = false
    for (const n of topo.neighbours[i]) {
      if (board.mine[n] === 0 && board.adjacent[n] === 0) {
        touchesOpening = true
        break
      }
    }
    if (!touchesOpening) cleared++
  }
  return cleared
}

/**
 * Wall-clock span of a game from its event log. The log carries caller-supplied
 * timestamps, so this is the one place that decides what "time" means for a
 * game: first move to last, which matches how minesweeper.online times a board.
 */
export function elapsedMs(events: readonly GameEvent[]): number {
  if (events.length === 0) return 0
  return events[events.length - 1].t - events[0].t
}

/** Convenience for tests and tooling: 3BV of a board reachable from its seed. */
export function boardStats(board: Board): { bbbv: number; zini: number; openings: number } {
  const openings = findOpenings(board)
  return { bbbv: calc3BV(board, openings), zini: zini(board).clicks, openings: openings.count }
}

/** Re-exported so callers computing several metrics only walk the board once. */
export { findOpenings, floodOpen }
