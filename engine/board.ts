import { neighborIndex } from './neighbors.ts'
import { mulberry32, hashSeed } from './rng.ts'
import { HIDDEN, REVEALED, FLAGGED, QUESTION, type SolverView } from './types.ts'

export interface Board {
  width: number
  height: number
  mineCount: number
  mines: Uint8Array
  adj: Uint8Array
  state: Uint8Array
  revealedCount: number
  flagCount: number
  exploded: boolean
  /** false when density forced us to drop the zero-cell guarantee (§4.3 edge case) */
  cascadeGuaranteed: boolean
}

export interface BoardSpec {
  width: number
  height: number
  mineCount: number
  seed: string
  firstClick: number
}

/**
 * Mines are placed after the first click. The clicked cell and all eight
 * neighbours are excluded so the first click always opens a cascade.
 */
export function createBoard(spec: BoardSpec): Board {
  const { width, height, mineCount, seed, firstClick } = spec
  const n = width * height
  const ni = neighborIndex(width, height)
  const rand = mulberry32(hashSeed(seed))

  const excluded = new Uint8Array(n)
  excluded[firstClick] = 1
  for (let k = 0; k < ni.count[firstClick]; k++) excluded[ni.table[firstClick * 8 + k]] = 1

  let available = n - (1 + ni.count[firstClick])
  let cascadeGuaranteed = true
  if (available < mineCount) {
    // Very dense custom board: fall back to "first click is merely safe".
    excluded.fill(0)
    excluded[firstClick] = 1
    available = n - 1
    cascadeGuaranteed = false
  }

  const candidates = new Int32Array(available)
  let c = 0
  for (let i = 0; i < n; i++) if (!excluded[i]) candidates[c++] = i

  // Partial Fisher-Yates: only shuffle as many as we need.
  for (let i = 0; i < mineCount; i++) {
    const j = i + Math.floor(rand() * (available - i))
    const t = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = t
  }

  const mines = new Uint8Array(n)
  for (let i = 0; i < mineCount; i++) mines[candidates[i]] = 1

  const adj = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (mines[i]) continue
    let a = 0
    for (let k = 0; k < ni.count[i]; k++) if (mines[ni.table[i * 8 + k]]) a++
    adj[i] = a
  }

  return {
    width, height, mineCount, mines, adj,
    state: new Uint8Array(n),
    revealedCount: 0,
    flagCount: 0,
    exploded: false,
    cascadeGuaranteed,
  }
}

/** Reveals a cell, cascading through zeros. Returns every cell newly revealed. */
export function open(b: Board, cell: number): number[] {
  if (b.state[cell] !== HIDDEN && b.state[cell] !== QUESTION) return []
  if (b.mines[cell]) {
    b.state[cell] = REVEALED
    b.exploded = true
    return [cell]
  }
  const ni = neighborIndex(b.width, b.height)
  const revealed: number[] = []
  const stack = [cell]
  while (stack.length > 0) {
    const i = stack.pop()!
    if (b.state[i] === REVEALED || b.state[i] === FLAGGED) continue
    if (b.mines[i]) continue
    b.state[i] = REVEALED
    b.revealedCount++
    revealed.push(i)
    if (b.adj[i] === 0) {
      for (let k = 0; k < ni.count[i]; k++) {
        const nb = ni.table[i * 8 + k]
        if (b.state[nb] === HIDDEN || b.state[nb] === QUESTION) stack.push(nb)
      }
    }
  }
  return revealed
}

export function toggleFlag(b: Board, cell: number): boolean {
  if (b.state[cell] === REVEALED) return false
  if (b.state[cell] === FLAGGED) {
    b.state[cell] = HIDDEN
    b.flagCount--
  } else {
    b.state[cell] = FLAGGED
    b.flagCount++
  }
  return true
}

export function canChord(b: Board, cell: number): boolean {
  if (b.state[cell] !== REVEALED || b.adj[cell] === 0) return false
  const ni = neighborIndex(b.width, b.height)
  let flags = 0
  let hidden = 0
  for (let k = 0; k < ni.count[cell]; k++) {
    const nb = ni.table[cell * 8 + k]
    if (b.state[nb] === FLAGGED) flags++
    else if (b.state[nb] !== REVEALED) hidden++
  }
  return flags === b.adj[cell] && hidden > 0
}

/** Returns cells revealed. Detonates if the flags were wrong. */
export function chord(b: Board, cell: number): number[] {
  if (!canChord(b, cell)) return []
  const ni = neighborIndex(b.width, b.height)
  const out: number[] = []
  for (let k = 0; k < ni.count[cell]; k++) {
    const nb = ni.table[cell * 8 + k]
    if (b.state[nb] === HIDDEN || b.state[nb] === QUESTION) out.push(...open(b, nb))
    if (b.exploded) return out
  }
  return out
}

/** True when a chord here would detonate — used by the safety warning (§7.3). */
export function chordWouldExplode(b: Board, cell: number): boolean {
  if (!canChord(b, cell)) return false
  const ni = neighborIndex(b.width, b.height)
  for (let k = 0; k < ni.count[cell]; k++) {
    const nb = ni.table[cell * 8 + k]
    if ((b.state[nb] === HIDDEN || b.state[nb] === QUESTION) && b.mines[nb]) return true
  }
  return false
}

export function isWon(b: Board): boolean {
  return !b.exploded && b.revealedCount === b.width * b.height - b.mineCount
}

export function solverView(b: Board): SolverView {
  return {
    width: b.width,
    height: b.height,
    state: b.state,
    adj: b.adj,
    totalMines: b.mineCount,
  }
}
