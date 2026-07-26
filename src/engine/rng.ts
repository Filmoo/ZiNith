/**
 * Seeded RNG. Every board in Zinith reconstructs from `(seed, spec, firstClick)`
 * (§14.3), so generation must never reach for `Math.random()` — a replay opened
 * six months later has to produce a bit-identical board.
 *
 * splitmix32: one multiply-xorshift round over a 32-bit counter. Fast, no state
 * beyond a single word, and passes the small-crush-tier tests that matter for
 * shuffling mines around a grid.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [0, bound). Rejection-free; bias is below 2^-32. */
  int(bound: number): number
  /** Current internal state — capture it to fork a reproducible sub-stream. */
  state(): number
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x9e3779b9) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad)
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97)
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (bound) => Math.floor(next() * bound),
    state: () => a,
  }
}

/**
 * Partial Fisher-Yates: draws `count` distinct values from [0, size) without
 * materialising and shuffling the whole range. Mine placement calls this on
 * every generation attempt, and Expert generation runs it thousands of times
 * before it finds a no-guess board, so the allocation matters.
 *
 * Uses a sparse map of the swaps actually performed rather than a full array.
 */
export function sample(rng: Rng, size: number, count: number): number[] {
  if (count > size) throw new RangeError(`cannot draw ${count} distinct values from ${size}`)
  const swapped = new Map<number, number>()
  const out: number[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const j = i + rng.int(size - i)
    out[i] = swapped.get(j) ?? j
    const tail = swapped.get(i) ?? i
    swapped.set(j, tail)
  }
  return out
}

/**
 * Seeds are surfaced in the UI and shared between players, so they need to
 * survive a round trip through a text field. 32 bits as unsigned decimal.
 */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0
}
