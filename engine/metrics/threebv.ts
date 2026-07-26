import { neighborIndex } from '../neighbors.ts'
import type { Board } from '../board.ts'

export interface ThreeBVResult {
  value: number
  openings: number
  isolated: number
  /** opening id per cell, -1 if none — the renderer and ZiNi both want this */
  openingOf: Int32Array
}

/**
 * 3BV: minimum left clicks to clear with no flags and no chording.
 * One click per opening (the cascade does the rest) plus one for every
 * numbered cell that no opening touches.
 */
export function threeBV(b: Board): ThreeBVResult {
  const n = b.width * b.height
  const ni = neighborIndex(b.width, b.height)
  const openingOf = new Int32Array(n).fill(-1)
  let openings = 0

  for (let i = 0; i < n; i++) {
    if (b.mines[i] || b.adj[i] !== 0 || openingOf[i] !== -1) continue
    const id = openings++
    const stack = [i]
    openingOf[i] = id
    while (stack.length > 0) {
      const c = stack.pop()!
      for (let k = 0; k < ni.count[c]; k++) {
        const nb = ni.table[c * 8 + k]
        if (b.mines[nb] || openingOf[nb] !== -1) continue
        openingOf[nb] = id
        if (b.adj[nb] === 0) stack.push(nb)
      }
    }
  }

  let isolated = 0
  for (let i = 0; i < n; i++) {
    if (b.mines[i] || b.adj[i] === 0) continue
    if (openingOf[i] === -1) isolated++
  }

  return { value: openings + isolated, openings, isolated, openingOf }
}
