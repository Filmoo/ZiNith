/**
 * Precomputed neighbour table for one board size, stride 8, -1 padded.
 * Built once per size and cached: at expert this is rebuilt on every new game
 * otherwise, and it shows up in profiles.
 */
export interface NeighborIndex {
  width: number
  height: number
  /** stride-8 flat table; entries beyond count[i] are -1 */
  table: Int32Array
  count: Uint8Array
}

const cache = new Map<string, NeighborIndex>()

export function neighborIndex(width: number, height: number): NeighborIndex {
  const key = width + 'x' + height
  const hit = cache.get(key)
  if (hit) return hit

  const n = width * height
  const table = new Int32Array(n * 8).fill(-1)
  const count = new Uint8Array(n)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let c = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          table[i * 8 + c] = ny * width + nx
          c++
        }
      }
      count[i] = c
    }
  }

  const idx = { width, height, table, count }
  cache.set(key, idx)
  return idx
}
