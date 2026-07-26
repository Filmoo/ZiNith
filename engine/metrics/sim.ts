import { neighborIndex } from '../neighbors.ts'
import type { Board } from '../board.ts'

/** Lightweight omniscient board simulation used by the ZiNi family. */
export interface Sim {
  opened: Uint8Array
  flagged: Uint8Array
  openedCount: number
}

export function newSim(b: Board): Sim {
  const n = b.width * b.height
  return { opened: new Uint8Array(n), flagged: new Uint8Array(n), openedCount: 0 }
}

export function openSim(b: Board, s: Sim, cell: number): number {
  if (s.opened[cell] || b.mines[cell]) return 0
  const ni = neighborIndex(b.width, b.height)
  const stack = [cell]
  let count = 0
  while (stack.length > 0) {
    const i = stack.pop()!
    if (s.opened[i] || b.mines[i]) continue
    s.opened[i] = 1
    s.openedCount++
    count++
    if (b.adj[i] === 0) {
      for (let k = 0; k < ni.count[i]; k++) {
        const nb = ni.table[i * 8 + k]
        if (!s.opened[nb]) stack.push(nb)
      }
    }
  }
  return count
}

/**
 * The exact cells a chord at `cell` would newly open. Does not mutate `s`.
 *
 * Walks the cascade directly rather than opening into a scratch copy of the
 * board and diffing it afterwards. The greedy calls this tens of thousands of
 * times per solve — once per candidate per iteration — and the old shape paid
 * two full-board array copies plus an O(cells) diff scan on every one of them,
 * which dominated the whole metric.
 */
export function chordCells(b: Board, s: Sim, cell: number): number[] {
  if (b.mines[cell] || b.adj[cell] === 0) return []
  const ni = neighborIndex(b.width, b.height)
  const out: number[] = []
  const seen = new Set<number>()
  const stack: number[] = []

  const push = (i: number) => {
    if (b.mines[i] || s.opened[i] || seen.has(i)) return
    seen.add(i)
    stack.push(i)
  }

  for (let k = 0; k < ni.count[cell]; k++) push(ni.table[cell * 8 + k])
  while (stack.length > 0) {
    const i = stack.pop()!
    out.push(i)
    // Only a zero cell cascades further; a number stops the flood.
    if (b.adj[i] !== 0) continue
    for (let k = 0; k < ni.count[i]; k++) push(ni.table[i * 8 + k])
  }
  return out
}

// The "what would these cells cost with plain left clicks" helper lives in
// greedy.ts as `plainClickCost`. An earlier copy here counted any cell with an
// opening id as costing an opening click, which over-credits chords: a numbered
// cell on an opening's edge is free once that opening cascades, so only zero
// cells may be counted. Deleted rather than left exported, so the wrong version
// cannot be picked up by mistake.
