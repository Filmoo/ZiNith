import type { Board } from './board'
import type { Game } from './game'
import { topology } from './topology'

/**
 * The deduction engine. Everything downstream — no-guess generation (§4.4), the
 * coach (§8.2), learning-mode move blocking (§7.3), pattern frequency (§10.1) —
 * is a client of this file.
 *
 * Two tiers:
 *
 *   Cheap rules  counting and constraint-subset. Fast, and they hand back small
 *                witness sets, which is what makes proof depth meaningful.
 *   Enumeration  the tank solver. Logically complete over the frontier given the
 *                mine counter, so it catches 1-2-1, endgame counting, and every
 *                shape nobody has named. Slower, and its witness set is the
 *                whole component until `minimalWitnesses` shrinks it.
 *
 * Cheap rules run to fixpoint first so that enumeration only sees what is left.
 */

/** A cell nobody has revealed. */
export const UNKNOWN = -1

export interface SolverView {
  readonly width: number
  readonly height: number
  readonly totalMines: number
  /** `UNKNOWN` for unrevealed cells, otherwise the revealed cell's number. */
  readonly cells: Int8Array
}

export type RuleId =
  /** The number is already satisfied by known mines: the rest are safe. */
  | 'count-satisfied'
  /** Exactly as many candidates as the number needs: all of them are mines. */
  | 'count-exhausted'
  /** One number's candidates are a subset of another's. */
  | 'subset'
  /** The mine counter alone settles it. */
  | 'global-count'
  /** Exhaustive enumeration of the frontier. */
  | 'enumeration'

export interface Inference {
  readonly cell: number
  readonly kind: 'safe' | 'mine'
  readonly rule: RuleId
  /**
   * Revealed cells whose numbers the conclusion rests on. §10.1 defines proof
   * depth as this count — 1-1 is 2, 1-2-1 is 3 — so it must stay minimal, not
   * merely sufficient.
   */
  readonly witnesses: readonly number[]
  readonly patternId?: string
}

export interface SolveResult {
  /** Cells proven safe. Does not include already-revealed cells. */
  readonly safe: number[]
  /** Cells proven to be mines. */
  readonly mines: number[]
  readonly inferences: Inference[]
  /** False when a component blew the enumeration budget: conclusions are sound but incomplete. */
  readonly exhaustive: boolean
  /**
   * Nothing can be opened and unresolved cells remain: the position needs a
   * guess. A position whose every remaining cell is a proven mine is finished,
   * not stuck.
   */
  readonly stuck: boolean
}

export interface SolveOptions {
  /** Run the tank solver after the cheap rules. Default true. */
  readonly deep?: boolean
  /**
   * Shrink enumeration witness sets to a minimal subset. Costs another
   * enumeration per conclusion, so it is off during generation and on for the
   * P7 pattern-frequency run.
   */
  readonly minimalWitnesses?: boolean
  /** DFS node ceiling per component before giving up on it. */
  readonly enumerationBudget?: number
}

const DEFAULT_BUDGET = 300_000

// Working knowledge about an undetermined cell.
const UNDETERMINED = 0
const IS_MINE = 1
const IS_SAFE = 2

export function viewFromGame(game: Game): SolverView {
  const { board, revealed } = game
  const size = board.width * board.height
  const cells = new Int8Array(size)
  for (let i = 0; i < size; i++) {
    cells[i] = revealed[i] === 1 ? board.adjacent[i] : UNKNOWN
  }
  return { width: board.width, height: board.height, totalMines: board.mines, cells }
}

export function viewFromBoard(board: Board, revealed: Uint8Array): SolverView {
  const size = board.width * board.height
  const cells = new Int8Array(size)
  for (let i = 0; i < size; i++) {
    cells[i] = revealed[i] === 1 ? board.adjacent[i] : UNKNOWN
  }
  return { width: board.width, height: board.height, totalMines: board.mines, cells }
}

interface Constraint {
  /** The revealed cell this constraint comes from. */
  readonly witness: number
  /** Undetermined neighbours. */
  vars: number[]
  /** How many of `vars` are mines. */
  need: number
}

/**
 * Everything deducible at this position, without opening anything.
 *
 * Marking a mine tightens neighbouring constraints, so mine and safe
 * conclusions feed back into the rule loop. Marking a cell *safe* does not
 * reveal its number — the solver never invents information the player would not
 * have.
 */
export function solve(view: SolverView, options: SolveOptions = {}): SolveResult {
  const { deep = true, minimalWitnesses = false, enumerationBudget = DEFAULT_BUDGET } = options
  const topo = topology(view.width, view.height)
  const known = new Uint8Array(topo.size)
  const inferences: Inference[] = []
  const safe: number[] = []
  const mines: number[] = []
  let exhaustive = true

  const conclude = (cell: number, kind: 'safe' | 'mine', rule: RuleId, witnesses: number[], patternId?: string): boolean => {
    const flag = kind === 'mine' ? IS_MINE : IS_SAFE
    if (known[cell] !== UNDETERMINED) return false
    known[cell] = flag
    ;(kind === 'mine' ? mines : safe).push(cell)
    inferences.push(patternId ? { cell, kind, rule, witnesses, patternId } : { cell, kind, rule, witnesses })
    return true
  }

  // ---- cheap rules, to fixpoint -------------------------------------------

  for (;;) {
    const constraints = buildConstraints(view, topo, known)
    let progress = false

    // R1/R2: a single number settles its own neighbourhood.
    for (const c of constraints) {
      if (c.need === 0) {
        for (const v of c.vars) progress = conclude(v, 'safe', 'count-satisfied', [c.witness]) || progress
      } else if (c.need === c.vars.length) {
        for (const v of c.vars) progress = conclude(v, 'mine', 'count-exhausted', [c.witness]) || progress
      }
    }
    if (progress) continue

    // R3: subset. Only compare constraints that actually share a cell.
    if (applySubsetRule(constraints, topo.size, conclude)) continue

    // R4: the mine counter.
    if (applyGlobalCount(view, known, conclude)) continue

    break
  }

  // ---- enumeration ---------------------------------------------------------

  if (deep) {
    const constraints = buildConstraints(view, topo, known)
    if (constraints.length > 0) {
      const result = enumerate(view, topo, known, constraints, enumerationBudget, minimalWitnesses)
      exhaustive = result.exhaustive
      for (const found of result.conclusions) {
        conclude(found.cell, found.kind, 'enumeration', found.witnesses)
      }
    }
  }

  let undetermined = 0
  for (let i = 0; i < topo.size; i++) {
    if (view.cells[i] === UNKNOWN && known[i] === UNDETERMINED) undetermined++
  }

  return { safe, mines, inferences, exhaustive, stuck: safe.length === 0 && undetermined > 0 }
}

function buildConstraints(view: SolverView, topo: ReturnType<typeof topology>, known: Uint8Array): Constraint[] {
  const constraints: Constraint[] = []
  for (let i = 0; i < topo.size; i++) {
    const number = view.cells[i]
    if (number === UNKNOWN || number === 0) continue
    let need = number
    const vars: number[] = []
    for (const n of topo.neighbours[i]) {
      if (view.cells[n] !== UNKNOWN) continue
      if (known[n] === IS_MINE) need--
      else if (known[n] === UNDETERMINED) vars.push(n)
    }
    if (vars.length > 0) constraints.push({ witness: i, vars, need })
  }
  return constraints
}

type Conclude = (
  cell: number,
  kind: 'safe' | 'mine',
  rule: RuleId,
  witnesses: number[],
  patternId?: string,
) => boolean

/**
 * If A's candidates are a subset of B's, then B's surplus need is spread over
 * exactly the cells B has that A does not. Zero surplus makes them all safe;
 * surplus equal to the count makes them all mines.
 *
 * This is the 1-1 and 1-2 family. The pattern tag here is provisional — P7
 * replaces it with the real library once frequency instrumentation exists.
 */
function applySubsetRule(constraints: Constraint[], size: number, conclude: Conclude): boolean {
  // cell -> constraints touching it, so we only compare overlapping pairs.
  const touching: number[][] = new Array(size)
  constraints.forEach((c, index) => {
    for (const v of c.vars) (touching[v] ??= []).push(index)
  })

  let progress = false
  const seen = new Set<number>()

  for (let ai = 0; ai < constraints.length; ai++) {
    const a = constraints[ai]
    seen.clear()
    for (const v of a.vars) {
      for (const bi of touching[v]) {
        if (bi === ai || seen.has(bi)) continue
        seen.add(bi)
        const b = constraints[bi]
        if (b.vars.length <= a.vars.length) continue
        if (!isSubset(a.vars, b.vars)) continue

        const surplusNeed = b.need - a.need
        const surplus = b.vars.filter((cell) => !a.vars.includes(cell))
        if (surplusNeed === 0) {
          const tag = patternTag(a.need, b.need)
          for (const cell of surplus) {
            progress = conclude(cell, 'safe', 'subset', [a.witness, b.witness], tag) || progress
          }
        } else if (surplusNeed === surplus.length) {
          const tag = patternTag(a.need, b.need)
          for (const cell of surplus) {
            progress = conclude(cell, 'mine', 'subset', [a.witness, b.witness], tag) || progress
          }
        }
      }
    }
  }
  return progress
}

function patternTag(aNeed: number, bNeed: number): string | undefined {
  if (aNeed === 1 && bNeed === 1) return '1-1'
  if (aNeed === 1 && bNeed === 2) return '1-2'
  return undefined
}

function isSubset(small: number[], large: number[]): boolean {
  for (const cell of small) if (!large.includes(cell)) return false
  return true
}

function applyGlobalCount(view: SolverView, known: Uint8Array, conclude: Conclude): boolean {
  let knownMines = 0
  const undetermined: number[] = []
  for (let i = 0; i < view.cells.length; i++) {
    if (view.cells[i] !== UNKNOWN) continue
    if (known[i] === IS_MINE) knownMines++
    else if (known[i] === UNDETERMINED) undetermined.push(i)
  }
  const remaining = view.totalMines - knownMines
  let progress = false
  if (remaining === 0) {
    for (const cell of undetermined) progress = conclude(cell, 'safe', 'global-count', []) || progress
  } else if (remaining === undetermined.length) {
    for (const cell of undetermined) progress = conclude(cell, 'mine', 'global-count', []) || progress
  }
  return progress
}

// ---- tank solver -----------------------------------------------------------

interface EnumConclusion {
  cell: number
  kind: 'safe' | 'mine'
  witnesses: number[]
}

interface EnumResult {
  conclusions: EnumConclusion[]
  exhaustive: boolean
}

class BudgetExceeded extends Error {}

interface Component {
  cells: number[]
  constraints: Constraint[]
}

/**
 * Enumerate every mine arrangement consistent with the frontier constraints,
 * then fold in the mine counter and the cells the frontier does not touch.
 *
 * A cell is safe iff it is empty in every globally consistent arrangement. The
 * counter matters: a component split that looks ambiguous on its own is often
 * settled once you ask how many mines are left for the cells nobody can see.
 */
function enumerate(
  view: SolverView,
  topo: ReturnType<typeof topology>,
  known: Uint8Array,
  constraints: Constraint[],
  budget: number,
  minimalWitnesses: boolean,
): EnumResult {
  const components = splitComponents(constraints)

  // Cells no constraint touches. They only resolve through the counter.
  const frontier = new Set<number>()
  for (const c of constraints) for (const v of c.vars) frontier.add(v)
  const far: number[] = []
  let knownMines = 0
  for (let i = 0; i < topo.size; i++) {
    if (view.cells[i] !== UNKNOWN) continue
    if (known[i] === IS_MINE) knownMines++
    else if (known[i] === UNDETERMINED && !frontier.has(i)) far.push(i)
  }
  const remaining = view.totalMines - knownMines

  const tallies: ComponentTally[] = []
  let exhaustive = true
  for (const component of components) {
    try {
      tallies.push(tally(component, budget))
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) throw error
      exhaustive = false
    }
  }
  // A component we could not enumerate leaves an unknown number of mines
  // unaccounted for, so the counter arithmetic below would be wrong. Bail out
  // rather than report unsound conclusions.
  if (!exhaustive) return { conclusions: [], exhaustive: false }

  const feasible = feasibleCounts(tallies, remaining, far.length)
  const conclusions: EnumConclusion[] = []

  for (let ci = 0; ci < tallies.length; ci++) {
    const t = tallies[ci]
    const ks = feasible.perComponent[ci]
    if (ks.length === 0) continue // contradictory position; leave it alone
    for (let idx = 0; idx < t.cells.length; idx++) {
      let alwaysMine = true
      let neverMine = true
      for (const k of ks) {
        const total = t.countsByK.get(k) as number
        const mined = (t.mineByK.get(k) as Int32Array)[idx]
        if (mined !== total) alwaysMine = false
        if (mined !== 0) neverMine = false
        if (!alwaysMine && !neverMine) break
      }
      if (alwaysMine === neverMine) continue // both false: undecided
      const cell = t.cells[idx]
      const kind = alwaysMine ? 'mine' : 'safe'
      const witnesses = minimalWitnesses
        ? shrinkWitnesses(components[ci], cell, kind, budget)
        : components[ci].constraints.map((c) => c.witness)
      conclusions.push({ cell, kind, witnesses })
    }
  }

  // Far cells: settled only when every feasible frontier total leaves them all
  // empty, or all mined.
  if (far.length > 0 && feasible.totals.length > 0) {
    let allEmpty = true
    let allFull = true
    for (const s of feasible.totals) {
      if (remaining - s !== 0) allEmpty = false
      if (remaining - s !== far.length) allFull = false
    }
    if (allEmpty !== allFull) {
      const kind = allFull ? 'mine' : 'safe'
      const witnesses = constraints.map((c) => c.witness)
      for (const cell of far) conclusions.push({ cell, kind, witnesses })
    }
  }

  return { conclusions, exhaustive: true }
}

function splitComponents(constraints: Constraint[]): Component[] {
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as number
    while (parent.get(x) !== root) {
      const next = parent.get(x) as number
      parent.set(x, root)
      x = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const c of constraints) {
    for (const v of c.vars) if (!parent.has(v)) parent.set(v, v)
  }
  for (const c of constraints) {
    for (let i = 1; i < c.vars.length; i++) union(c.vars[0], c.vars[i])
  }

  const byRoot = new Map<number, Component>()
  for (const c of constraints) {
    const root = find(c.vars[0])
    let component = byRoot.get(root)
    if (!component) {
      component = { cells: [], constraints: [] }
      byRoot.set(root, component)
    }
    component.constraints.push(c)
  }
  for (const [root, component] of byRoot) {
    const cells = new Set<number>()
    for (const c of component.constraints) for (const v of c.vars) cells.add(v)
    component.cells = [...cells].sort((a, b) => a - b)
    void root
  }
  return [...byRoot.values()]
}

interface ComponentTally {
  cells: number[]
  /** mine count -> number of consistent arrangements. */
  countsByK: Map<number, number>
  /** mine count -> per-cell count of arrangements where that cell is mined. */
  mineByK: Map<number, Int32Array>
}

function tally(component: Component, budget: number): ComponentTally {
  const cells = orderCells(component)
  const index = new Map<number, number>()
  cells.forEach((cell, i) => index.set(cell, i))

  const constraintVars = component.constraints.map((c) => c.vars.map((v) => index.get(v) as number))
  const need = component.constraints.map((c) => c.need)
  const cur = new Int32Array(component.constraints.length)
  const rem = Int32Array.from(constraintVars.map((vars) => vars.length))

  // cell -> constraints containing it
  const memberOf: number[][] = cells.map(() => [])
  constraintVars.forEach((vars, ci) => {
    for (const v of vars) memberOf[v].push(ci)
  })

  const countsByK = new Map<number, number>()
  const mineByK = new Map<number, Int32Array>()
  const assignment = new Uint8Array(cells.length)
  let nodes = 0

  const record = (k: number): void => {
    countsByK.set(k, (countsByK.get(k) ?? 0) + 1)
    let mined = mineByK.get(k)
    if (!mined) {
      mined = new Int32Array(cells.length)
      mineByK.set(k, mined)
    }
    for (let i = 0; i < cells.length; i++) if (assignment[i] === 1) mined[i]++
  }

  const dfs = (i: number, k: number): void => {
    if (++nodes > budget) throw new BudgetExceeded()
    if (i === cells.length) {
      record(k)
      return
    }
    for (let value = 0; value <= 1; value++) {
      let ok = true
      for (const ci of memberOf[i]) {
        cur[ci] += value
        rem[ci]--
        if (cur[ci] > need[ci] || cur[ci] + rem[ci] < need[ci]) ok = false
      }
      if (ok) {
        assignment[i] = value as 0 | 1
        dfs(i + 1, k + value)
      }
      for (const ci of memberOf[i]) {
        cur[ci] -= value
        rem[ci]++
      }
    }
  }

  dfs(0, 0)
  return { cells, countsByK, mineByK }
}

/**
 * Assign cells constraint by constraint so that constraints close early and the
 * DFS can prune. Enumerating in board order instead makes expert frontiers
 * explode.
 */
function orderCells(component: Component): number[] {
  const ordered: number[] = []
  const seen = new Set<number>()
  const constraints = [...component.constraints].sort((a, b) => a.vars.length - b.vars.length)
  for (const c of constraints) {
    for (const v of c.vars) {
      if (!seen.has(v)) {
        seen.add(v)
        ordered.push(v)
      }
    }
  }
  return ordered
}

/**
 * Which per-component mine counts survive the global counter, and which frontier
 * totals are reachable overall.
 */
function feasibleCounts(
  tallies: ComponentTally[],
  remaining: number,
  farCount: number,
): { perComponent: number[][]; totals: number[] } {
  const options = tallies.map((t) => [...t.countsByK.keys()].sort((a, b) => a - b))

  // Reachable sums using components [i..end], as boolean sets.
  const suffix: Set<number>[] = new Array(options.length + 1)
  suffix[options.length] = new Set([0])
  for (let i = options.length - 1; i >= 0; i--) {
    const next = new Set<number>()
    for (const s of suffix[i + 1]) {
      for (const k of options[i]) {
        const sum = s + k
        if (sum <= remaining) next.add(sum)
      }
    }
    suffix[i] = next
  }

  const admissible = (sum: number): boolean => remaining - sum >= 0 && remaining - sum <= farCount

  const totals = [...suffix[0]].filter(admissible).sort((a, b) => a - b)

  // For each component, the counts that participate in at least one admissible
  // total. Built by walking prefixes so the "everything except me" sum is exact.
  const perComponent: number[][] = []
  let prefix = new Set<number>([0])
  for (let i = 0; i < options.length; i++) {
    const rest = suffix[i + 1]
    const viable: number[] = []
    for (const k of options[i]) {
      let found = false
      for (const p of prefix) {
        for (const r of rest) {
          if (admissible(p + k + r)) {
            found = true
            break
          }
        }
        if (found) break
      }
      if (found) viable.push(k)
    }
    perComponent.push(viable)

    const next = new Set<number>()
    for (const p of prefix) {
      for (const k of options[i]) if (p + k <= remaining) next.add(p + k)
    }
    prefix = next
  }

  return { perComponent, totals }
}

/**
 * Drop constraints one at a time while the conclusion still holds. Greedy, so
 * the result is minimal rather than guaranteed minimum — good enough for the
 * proof-depth ordering in §10.1 and far cheaper than an exact search.
 */
function shrinkWitnesses(
  component: Component,
  cell: number,
  kind: 'safe' | 'mine',
  budget: number,
): number[] {
  let current = component.constraints
  for (let i = 0; i < current.length; ) {
    const candidate = current.filter((_, index) => index !== i)
    if (candidate.length > 0 && forces({ cells: [], constraints: candidate }, cell, kind, budget)) {
      current = candidate
    } else {
      i++
    }
  }
  return current.map((c) => c.witness)
}

/** Does this constraint set alone force `cell` to be `kind`? */
function forces(
  component: Component,
  cell: number,
  kind: 'safe' | 'mine',
  budget: number,
): boolean {
  const cells = new Set<number>()
  for (const c of component.constraints) for (const v of c.vars) cells.add(v)
  if (!cells.has(cell)) return false
  component.cells = [...cells].sort((a, b) => a - b)

  let result: ComponentTally
  try {
    result = tally(component, budget)
  } catch {
    return false
  }

  const idx = result.cells.indexOf(cell)
  if (idx === -1) return false
  let total = 0
  let mined = 0
  for (const [k, count] of result.countsByK) {
    total += count
    mined += (result.mineByK.get(k) as Int32Array)[idx]
  }
  if (total === 0) return false
  return kind === 'mine' ? mined === total : mined === 0
}
