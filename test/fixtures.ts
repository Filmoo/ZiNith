import { neighborIndex } from '../engine/neighbors.ts'
import type { Board } from '../engine/board.ts'

/** Build a board from a literal layout. '*' is a mine, '.' is clear. */
export function boardFromStrings(rows: string[]): Board {
  const height = rows.length
  const width = rows[0].length
  const n = width * height
  const mines = new Uint8Array(n)
  let mineCount = 0
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      if (row[x] === '*') {
        mines[y * width + x] = 1
        mineCount++
      }
    }
  })
  const ni = neighborIndex(width, height)
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
    revealedCount: 0, flagCount: 0, exploded: false, cascadeGuaranteed: true,
  }
}

export const idx = (b: Board, x: number, y: number): number => y * b.width + x
