import type { Deduction } from '../types.ts'
import type { Frontier } from './constraints.ts'

/**
 * Tier 1 — single constraint. Flags satisfy the number, or the remaining
 * hidden cells are forced to all be mines.
 */
export function tier1(f: Frontier): Deduction[] {
  const out: Deduction[] = []
  for (const c of f.constraints) {
    if (c.count === 0) {
      out.push({ rule: 'count-satisfied', subject: c.cells.slice(), witnesses: [c.witness], verdict: 'safe' })
    } else if (c.count === c.cells.length) {
      out.push({ rule: 'count-forced', subject: c.cells.slice(), witnesses: [c.witness], verdict: 'mine' })
    }
  }
  return out
}

/**
 * Tier 2 — subset reduction. A ⊂ B means B\A holds exactly B.count - A.count
 * mines. This single rule subsumes 1-1, 1-2, 1-2-1 and 1-2-2-1; naming those
 * shapes is the pedagogy layer's job, not the solver's (§5.4).
 */
export function tier2(f: Frontier): Deduction[] {
  const out: Deduction[] = []
  const cs = f.constraints
  if (cs.length < 2) return out

  // cell index -> constraints touching it, so we only compare overlapping pairs
  const byCell: number[][] = Array.from({ length: f.cells.length }, () => [])
  cs.forEach((c, ci) => {
    for (const cell of c.cells) byCell[f.indexOf.get(cell)!].push(ci)
  })

  for (let ai = 0; ai < cs.length; ai++) {
    const A = cs[ai]
    const seen = new Set<number>()
    for (const cell of A.cells) {
      for (const bi of byCell[f.indexOf.get(cell)!]) {
        if (bi === ai || seen.has(bi)) continue
        seen.add(bi)
        const B = cs[bi]
        if (B.cells.length <= A.cells.length) continue
        if (!A.mask.subsetOf(B.mask)) continue

        const diffIdx = A.mask.difference(B.mask)
        const diff = diffIdx.map((i) => f.cells[i])
        const dcount = B.count - A.count
        if (dcount === 0) {
          out.push({ rule: 'subset', subject: diff, witnesses: [A.witness, B.witness], verdict: 'safe' })
        } else if (dcount === diff.length) {
          out.push({ rule: 'subset', subject: diff, witnesses: [A.witness, B.witness], verdict: 'mine' })
        }
      }
    }
  }
  return out
}
