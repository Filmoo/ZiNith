import type { CellId, Deduction, SolverView } from '../types.ts'
import type { Frontier } from './constraints.ts'

const DEFAULT_MAX_COMPONENT = 24
const MAX_SOLUTIONS = 1_000_000

export interface Component {
  cells: number[]
  witnesses: number[]
  /** constraints in local cell indices */
  constraints: Array<{ cells: number[]; count: number }>
}

/** Partition the frontier into components connected by shared cells. */
export function components(f: Frontier): Component[] {
  const parent = f.constraints.map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const firstFor = new Map<number, number>()
  f.constraints.forEach((c, ci) => {
    for (const cell of c.cells) {
      const prev = firstFor.get(cell)
      if (prev === undefined) firstFor.set(cell, ci)
      else union(prev, ci)
    }
  })

  const groups = new Map<number, number[]>()
  f.constraints.forEach((_, ci) => {
    const r = find(ci)
    const g = groups.get(r)
    if (g) g.push(ci)
    else groups.set(r, [ci])
  })

  const out: Component[] = []
  for (const cis of groups.values()) {
    // Order cells by first appearance so the search tree stays local and prunes early.
    const local = new Map<number, number>()
    const cells: number[] = []
    for (const ci of cis) {
      for (const cell of f.constraints[ci].cells) {
        if (!local.has(cell)) {
          local.set(cell, cells.length)
          cells.push(cell)
        }
      }
    }
    out.push({
      cells,
      witnesses: cis.map((ci) => f.constraints[ci].witness),
      constraints: cis.map((ci) => ({
        cells: f.constraints[ci].cells.map((c) => local.get(c)!),
        count: f.constraints[ci].count,
      })),
    })
  }
  return out
}

export interface Enumeration {
  comp: Component
  /** solByK[k] = number of valid assignments using exactly k mines */
  solByK: Float64Array
  /** perCellByK[k][localCell] = assignments with k mines where that cell is a mine */
  perCellByK: Float64Array[]
  support: number[]
  total: number
}

/**
 * Exhaustive backtracking over one component. Returns null if the component
 * exceeds the cap — callers must then treat global reasoning as unavailable.
 */
export function enumerateComponent(comp: Component, maxMines: number, maxCells: number): Enumeration | null {
  const m = comp.cells.length
  if (m > maxCells) return null

  const nc = comp.constraints.length
  const cellCons: number[][] = Array.from({ length: m }, () => [])
  comp.constraints.forEach((c, ci) => {
    for (const cell of c.cells) cellCons[cell].push(ci)
  })

  const consMines = new Int32Array(nc)
  const consLeft = new Int32Array(nc)
  comp.constraints.forEach((c, ci) => (consLeft[ci] = c.cells.length))

  const cap = Math.min(m, maxMines)
  const solByK = new Float64Array(cap + 1)
  const perCellByK: Float64Array[] = Array.from({ length: cap + 1 }, () => new Float64Array(m))
  const assign = new Uint8Array(m)
  let total = 0
  let overflow = false

  const dfs = (i: number, k: number): void => {
    if (overflow) return
    if (i === m) {
      solByK[k]++
      const row = perCellByK[k]
      for (let c = 0; c < m; c++) if (assign[c]) row[c]++
      total++
      if (total > MAX_SOLUTIONS) overflow = true
      return
    }

    for (let v = 0; v <= 1; v++) {
      if (v === 1 && k + 1 > cap) continue
      let ok = true
      const cons = cellCons[i]
      for (let x = 0; x < cons.length; x++) {
        const j = cons[x]
        consLeft[j]--
        if (v === 1) consMines[j]++
        const need = comp.constraints[j].count
        if (consMines[j] > need || consMines[j] + consLeft[j] < need) {
          // undo the partial application before bailing
          for (let y = x; y >= 0; y--) {
            const jj = cons[y]
            consLeft[jj]++
            if (v === 1) consMines[jj]--
          }
          ok = false
          break
        }
      }
      if (ok) {
        assign[i] = v as 0 | 1
        dfs(i + 1, k + v)
        assign[i] = 0
        for (const j of cons) {
          consLeft[j]++
          if (v === 1) consMines[j]--
        }
      }
    }
  }

  dfs(0, 0)
  if (overflow) return null

  const support: number[] = []
  for (let k = 0; k <= cap; k++) if (solByK[k] > 0) support.push(k)
  if (support.length === 0) return null // inconsistent state, not enumerable

  return { comp, solByK, perCellByK, support, total }
}

// --- log-binomials, so a C(480, 99) weight can't overflow a double ---

const logFactCache: number[] = [0, 0]
function logFact(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i)
  return logFactCache[n]
}
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return logFact(n) - logFact(k) - logFact(n - k)
}

function convolve(dists: Float64Array[]): Float64Array {
  let acc = new Float64Array(1)
  acc[0] = 1
  for (const d of dists) {
    const next = new Float64Array(acc.length + d.length - 1)
    for (let i = 0; i < acc.length; i++) {
      if (acc[i] === 0) continue
      for (let j = 0; j < d.length; j++) {
        if (d[j] === 0) continue
        next[i + j] += acc[i] * d[j]
      }
    }
    acc = next
  }
  return acc
}

export interface TankResult {
  deductions: Deduction[]
  probabilities?: Map<CellId, number>
  incomplete: boolean
}

export function tankSolve(
  f: Frontier,
  view: SolverView,
  opts: { probabilities?: boolean; maxComponent?: number },
): TankResult {
  const maxCells = opts.maxComponent ?? DEFAULT_MAX_COMPONENT
  const remaining = view.totalMines - f.flagCount
  const interiorCount = f.interior.length
  const deductions: Deduction[] = []

  const comps = components(f)
  const enums: Array<Enumeration | null> = comps.map((c) => enumerateComponent(c, remaining, maxCells))
  const incomplete = enums.some((e) => e === null)

  // --- Tier 3: certainty within a single component, ignoring the global count ---
  for (const e of enums) {
    if (!e) continue
    const m = e.comp.cells.length
    const totals = new Float64Array(m)
    for (const k of e.support) {
      const row = e.perCellByK[k]
      for (let c = 0; c < m; c++) totals[c] += row[c]
    }
    const mines: number[] = []
    const safe: number[] = []
    for (let c = 0; c < m; c++) {
      if (totals[c] === e.total) mines.push(e.comp.cells[c])
      else if (totals[c] === 0) safe.push(e.comp.cells[c])
    }
    if (mines.length) deductions.push({ rule: 'tank', subject: mines, witnesses: e.comp.witnesses.slice(), verdict: 'mine' })
    if (safe.length) deductions.push({ rule: 'tank', subject: safe, witnesses: e.comp.witnesses.slice(), verdict: 'safe' })
  }

  // Global reasoning needs every component enumerated, or the mine budget is unknown.
  if (incomplete) return { deductions, incomplete: true }

  const es = enums as Enumeration[]

  // Board with no revealed numbers yet: everything hidden is interior.
  if (es.length === 0) {
    if (interiorCount > 0 && remaining === 0) {
      deductions.push({ rule: 'global-count', subject: f.interior.slice(), witnesses: [], verdict: 'safe' })
    } else if (interiorCount > 0 && remaining === interiorCount) {
      deductions.push({ rule: 'global-count', subject: f.interior.slice(), witnesses: [], verdict: 'mine' })
    }
    let probabilities: Map<CellId, number> | undefined
    if (opts.probabilities && interiorCount > 0) {
      probabilities = new Map()
      for (const c of f.interior) probabilities.set(c, remaining / interiorCount)
    }
    return { deductions, probabilities, incomplete: false }
  }

  const dists = es.map((e) => e.solByK)
  const full = convolve(dists)

  // Normalise the interior binomials so products stay inside double range.
  let maxLogC = -Infinity
  for (let s = 0; s < full.length; s++) {
    if (full[s] === 0) continue
    const lc = logChoose(interiorCount, remaining - s)
    if (lc > maxLogC) maxLogC = lc
  }
  const cn = (r: number): number => {
    const lc = logChoose(interiorCount, r)
    return lc === -Infinity ? 0 : Math.exp(lc - maxLogC)
  }

  // Which total frontier mine counts are globally possible
  const feasibleS: boolean[] = new Array(full.length).fill(false)
  let anyFeasible = false
  for (let s = 0; s < full.length; s++) {
    if (full[s] === 0) continue
    const r = remaining - s
    if (r >= 0 && r <= interiorCount) {
      feasibleS[s] = true
      anyFeasible = true
    }
  }
  if (!anyFeasible) return { deductions, incomplete: false } // inconsistent flags

  // --- Tier 4: certainty once the global count restricts each component ---
  const others: Float64Array[] = es.map((_, i) => convolve(dists.filter((_, j) => j !== i)))

  const alreadyKnown = new Set<number>()
  for (const d of deductions) for (const s of d.subject) alreadyKnown.add(s)

  es.forEach((e, i) => {
    const feasibleK: number[] = []
    for (const k of e.support) {
      let ok = false
      for (let u = 0; u < others[i].length; u++) {
        if (others[i][u] === 0) continue
        const r = remaining - k - u
        if (r >= 0 && r <= interiorCount) {
          ok = true
          break
        }
      }
      if (ok) feasibleK.push(k)
    }
    if (feasibleK.length === 0) return

    const m = e.comp.cells.length
    let totalSol = 0
    const totals = new Float64Array(m)
    for (const k of feasibleK) {
      totalSol += e.solByK[k]
      const row = e.perCellByK[k]
      for (let c = 0; c < m; c++) totals[c] += row[c]
    }
    const mines: number[] = []
    const safe: number[] = []
    for (let c = 0; c < m; c++) {
      const cell = e.comp.cells[c]
      if (alreadyKnown.has(cell)) continue
      if (totals[c] === totalSol) mines.push(cell)
      else if (totals[c] === 0) safe.push(cell)
    }
    if (mines.length) deductions.push({ rule: 'global-count', subject: mines, witnesses: e.comp.witnesses.slice(), verdict: 'mine' })
    if (safe.length) deductions.push({ rule: 'global-count', subject: safe, witnesses: e.comp.witnesses.slice(), verdict: 'safe' })
  })

  // Interior cells are interchangeable: they resolve only when the budget forces it.
  if (interiorCount > 0) {
    let allZero = true
    let allFull = true
    for (let s = 0; s < full.length; s++) {
      if (!feasibleS[s]) continue
      const r = remaining - s
      if (r !== 0) allZero = false
      if (r !== interiorCount) allFull = false
    }
    const allWitnesses = es.flatMap((e) => e.comp.witnesses)
    if (allZero) deductions.push({ rule: 'global-count', subject: f.interior.slice(), witnesses: allWitnesses, verdict: 'safe' })
    else if (allFull) deductions.push({ rule: 'global-count', subject: f.interior.slice(), witnesses: allWitnesses, verdict: 'mine' })
  }

  // --- Probabilities (only on request: coach and guess analysis) ---
  let probabilities: Map<CellId, number> | undefined
  if (opts.probabilities) {
    probabilities = new Map()
    let W = 0
    for (let s = 0; s < full.length; s++) {
      if (!feasibleS[s]) continue
      W += full[s] * cn(remaining - s)
    }
    if (W > 0) {
      es.forEach((e, i) => {
        const m = e.comp.cells.length
        const wk = new Float64Array(e.solByK.length)
        for (let k = 0; k < e.solByK.length; k++) {
          if (e.solByK[k] === 0) continue
          let acc = 0
          for (let u = 0; u < others[i].length; u++) {
            if (others[i][u] === 0) continue
            const r = remaining - k - u
            if (r < 0 || r > interiorCount) continue
            acc += others[i][u] * cn(r)
          }
          wk[k] = acc
        }
        for (let c = 0; c < m; c++) {
          let p = 0
          for (let k = 0; k < wk.length; k++) {
            if (wk[k] === 0) continue
            p += e.perCellByK[k][c] * wk[k]
          }
          probabilities!.set(e.comp.cells[c], p / W)
        }
      })

      if (interiorCount > 0) {
        let expected = 0
        for (let s = 0; s < full.length; s++) {
          if (!feasibleS[s]) continue
          expected += full[s] * cn(remaining - s) * (remaining - s)
        }
        const p = expected / W / interiorCount
        for (const c of f.interior) probabilities.set(c, p)
      }
    }
  }

  return { deductions, probabilities, incomplete: false }
}
