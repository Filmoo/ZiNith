import { neighborIndex } from '../neighbors.ts'
import type { Board } from '../board.ts'
import { newSim, openSim, chordCells, type Sim } from './sim.ts'
import { threeBV } from './threebv.ts'

export type ClickType = 'open' | 'flag' | 'chord'
export interface Click {
  type: ClickType
  cell: number
}

/**
 * Decides which mines the player is allowed to flag right now.
 * ZiNi passes an omniscient oracle; HZiNi passes one backed by the solver.
 */
export interface FlagOracle {
  /** called after every applied action */
  refresh(sim: Sim): void
  canFlag(cell: number): boolean
}

export const omniscientOracle: FlagOracle = {
  refresh() {},
  canFlag() {
    return true
  },
}

export interface GreedyResult {
  value: number
  path: Click[]
  /** opens made with nothing deducible available */
  blindOpens: number
}

/**
 * The click cost of a set of cells if you were only left-clicking.
 *
 * Subtlety that cost two bugs: a numbered cell sitting on the edge of an
 * opening is free the moment that opening is clicked, so revealing it early
 * saves nothing. Only count an opening when its zero cells actually cascade.
 */
function plainCost(cells: number[], b: Board, openingOf: Int32Array): number {
  const cascaded = new Set<number>()
  let isolated = 0
  for (const c of cells) {
    if (openingOf[c] === -1) isolated++
    else if (b.adj[c] === 0) cascaded.add(openingOf[c])
  }
  return cascaded.size + isolated
}

/**
 * Greedy minimum-click solve. Repeatedly takes the chord that saves the most
 * clicks against plain left-clicking, then clears what is left: openings
 * first (each cascades for one click), stragglers after.
 *
 * This is the standard greedy approximation, not exact ZiNi. Label it as such
 * in the UI and validate against published reference values before trusting
 * the absolute numbers.
 */
export function greedySolve(b: Board, firstClick: number, oracle: FlagOracle): GreedyResult {
  const ni = neighborIndex(b.width, b.height)
  const n = b.width * b.height
  const s: Sim = newSim(b)
  const openingOf = threeBV(b).openingOf
  const path: Click[] = []
  let clicks = 0
  let blindOpens = 0

  const minesAround = (cell: number): number[] => {
    const out: number[] = []
    for (let k = 0; k < ni.count[cell]; k++) {
      const nb = ni.table[cell * 8 + k]
      if (b.mines[nb] && !s.flagged[nb]) out.push(nb)
    }
    return out
  }

  openSim(b, s, firstClick)
  path.push({ type: 'open', cell: firstClick })
  clicks++
  oracle.refresh(s)

  for (;;) {
    let best = -1
    let bestBenefit = 0
    let bestCells = 0

    for (let c = 0; c < n; c++) {
      if (b.mines[c] || b.adj[c] === 0 || !s.opened[c]) continue
      const needed = minesAround(c)
      if (needed.some((m) => !oracle.canFlag(m))) continue
      const cells = chordCells(b, s, c)
      if (cells.length === 0) continue
      const cost = needed.length + 1
      const benefit = plainCost(cells, b, openingOf) - cost
      if (benefit <= 0) continue
      if (benefit > bestBenefit || (benefit === bestBenefit && cells.length > bestCells)) {
        best = c
        bestBenefit = benefit
        bestCells = cells.length
      }
    }

    if (best === -1) break

    for (const m of minesAround(best)) {
      s.flagged[m] = 1
      path.push({ type: 'flag', cell: m })
      clicks++
    }
    for (let k = 0; k < ni.count[best]; k++) {
      const nb = ni.table[best * 8 + k]
      if (!b.mines[nb] && !s.opened[nb]) openSim(b, s, nb)
    }
    path.push({ type: 'chord', cell: best })
    clicks++
    oracle.refresh(s)
  }

  // Cascades first: clicking an opening reveals its border for free, so doing
  // this in the wrong order costs a click per border cell.
  for (let c = 0; c < n; c++) {
    if (b.mines[c] || s.opened[c] || b.adj[c] !== 0) continue
    openSim(b, s, c)
    path.push({ type: 'open', cell: c })
    clicks++
    blindOpens++
  }
  for (let c = 0; c < n; c++) {
    if (b.mines[c] || s.opened[c]) continue
    openSim(b, s, c)
    path.push({ type: 'open', cell: c })
    clicks++
    blindOpens++
  }

  return { value: clicks, path, blindOpens }
}
