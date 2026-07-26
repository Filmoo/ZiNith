/** Fixed-width bitset over frontier indices. Subset tests are the hot path in tier 2. */
export class Bitset {
  readonly words: Uint32Array
  readonly size: number
  constructor(size: number) {
    this.size = size
    this.words = new Uint32Array((size + 31) >>> 5)
  }
  set(i: number): void {
    this.words[i >>> 5] |= 1 << (i & 31)
  }
  has(i: number): boolean {
    return (this.words[i >>> 5] & (1 << (i & 31))) !== 0
  }
  /** this ⊆ other */
  subsetOf(other: Bitset): boolean {
    const w = this.words
    const o = other.words
    for (let i = 0; i < w.length; i++) if ((w[i] & ~o[i]) !== 0) return false
    return true
  }
  /** indices in other but not this */
  difference(other: Bitset): number[] {
    const out: number[] = []
    for (let i = 0; i < other.words.length; i++) {
      let bits = other.words[i] & ~this.words[i]
      while (bits !== 0) {
        const b = bits & -bits
        out.push((i << 5) + (31 - Math.clz32(b >>> 0)))
        bits ^= b
      }
    }
    return out
  }
  intersects(other: Bitset): boolean {
    for (let i = 0; i < this.words.length; i++) if ((this.words[i] & other.words[i]) !== 0) return true
    return false
  }
}
