import { neighborIndex } from '../neighbors.ts'
import { Bitset } from '../bitset.ts'
import { HIDDEN, QUESTION, REVEALED, FLAGGED, type SolverView } from '../types.ts'

export interface Constraint {
  /** hidden cell ids this constraint ranges over */
  cells: number[]
  /** how many of them are mines */
  count: number
  /** the revealed number that proves it */
  witness: number
  mask: Bitset
}

export interface Frontier {
  constraints: Constraint[]
  /** every hidden cell adjacent to a revealed number */
  cells: number[]
  indexOf: Map<number, number>
  /** hidden, unflagged cells touching no revealed number */
  interior: number[]
  flagCount: number
  /** true if some revealed number has more flags than its value — player error */
  inconsistent: boolean
}

function isHidden(s: number): boolean {
  return s === HIDDEN || s === QUESTION
}

export function buildFrontier(view: SolverView): Frontier {
  const { width, height, state, adj } = view
  const n = width * height
  const ni = neighborIndex(width, height)

  const raw: Array<{ cells: number[]; count: number; witness: number }> = []
  const frontierSet = new Set<number>()
  let flagCount = 0
  let inconsistent = false

  for (let i = 0; i < n; i++) if (state[i] === FLAGGED) flagCount++

  for (let i = 0; i < n; i++) {
    if (state[i] !== REVEALED) continue
    let flags = 0
    const hidden: number[] = []
    for (let k = 0; k < ni.count[i]; k++) {
      const nb = ni.table[i * 8 + k]
      if (state[nb] === FLAGGED) flags++
      else if (isHidden(state[nb])) hidden.push(nb)
    }
    if (hidden.length === 0) continue
    const count = adj[i] - flags
    if (count < 0 || count > hidden.length) inconsistent = true
    raw.push({ cells: hidden, count, witness: i })
    for (const c of hidden) frontierSet.add(c)
  }

  const cells = Array.from(frontierSet).sort((a, b) => a - b)
  const indexOf = new Map<number, number>()
  cells.forEach((c, i) => indexOf.set(c, i))

  const constraints: Constraint[] = raw.map((r) => {
    const mask = new Bitset(cells.length)
    for (const c of r.cells) mask.set(indexOf.get(c)!)
    return { ...r, mask }
  })

  const interior: number[] = []
  for (let i = 0; i < n; i++) {
    if (isHidden(state[i]) && !frontierSet.has(i)) interior.push(i)
  }

  return { constraints, cells, indexOf, interior, flagCount, inconsistent }
}
