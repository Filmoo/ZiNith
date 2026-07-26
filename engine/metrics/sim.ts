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

/** The exact cells a chord at `cell` would newly open. */
export function chordCells(b: Board, s: Sim, cell: number): number[] {
  if (b.mines[cell] || b.adj[cell] === 0) return []
  const ni = neighborIndex(b.width, b.height)
  const probe: Sim = { opened: s.opened.slice(), flagged: s.flagged, openedCount: s.openedCount }
  const before = probe.opened.slice()
  for (let k = 0; k < ni.count[cell]; k++) {
    const nb = ni.table[cell * 8 + k]
    if (!b.mines[nb] && !probe.opened[nb]) openSim(b, probe, nb)
  }
  const out: number[] = []
  for (let i = 0; i < before.length; i++) if (!before[i] && probe.opened[i]) out.push(i)
  return out
}

// The "what would these cells cost with plain left clicks" helper lives in
// greedy.ts as `plainClickCost`. An earlier copy here counted any cell with an
// opening id as costing an opening click, which over-credits chords: a numbered
// cell on an opening's edge is free once that opening cascades, so only zero
// cells may be counted. Deleted rather than left exported, so the wrong version
// cannot be picked up by mistake.
