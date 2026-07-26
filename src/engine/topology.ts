/**
 * Neighbour tables, cached per board size.
 *
 * The solver walks neighbours in its innermost loop, so this is precomputed
 * once per (width, height) rather than recomputed from x/y arithmetic on every
 * access. Boards are flat: `index = y * width + x`.
 */

export interface Topology {
  readonly width: number
  readonly height: number
  readonly size: number
  /** 8-way neighbours of every cell, in row-major order, edges clipped. */
  readonly neighbours: readonly Int32Array[]
}

const cache = new Map<string, Topology>()

export function topology(width: number, height: number): Topology {
  const key = `${width}x${height}`
  const hit = cache.get(key)
  if (hit) return hit

  const size = width * height
  const neighbours: Int32Array[] = new Array(size)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const buf: number[] = []
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          buf.push(ny * width + nx)
        }
      }
      neighbours[y * width + x] = Int32Array.from(buf)
    }
  }

  const topo: Topology = { width, height, size, neighbours }
  cache.set(key, topo)
  return topo
}

export function toXY(index: number, width: number): { x: number; y: number } {
  return { x: index % width, y: Math.floor(index / width) }
}

export function toIndex(x: number, y: number, width: number): number {
  return y * width + x
}
