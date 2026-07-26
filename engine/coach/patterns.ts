import { neighborIndex } from '../neighbors.ts'
import { minimizeWitnesses } from '../solver/minimize.ts'
import { FLAGGED, type CellId, type Deduction, type SolverView } from '../types.ts'

/**
 * The pedagogy layer (§5.4, §10). The solver deliberately does not name shapes:
 * tier 2's subset rule subsumes 1-1, 1-2, 1-2-1 and 1-2-2-1 without knowing any
 * of those names. Naming happens here.
 *
 * A pattern is identified by the *effective counts* of the minimal witness set
 * that proves the deduction — effective meaning the number minus the flags
 * already placed around it, which is what a player actually reads off the
 * board. So a proof needing two adjacent 1s is `1-1`, and one needing 1, 2, 1 in
 * a line is `1-2-1`. Nothing is hand-matched, which means a shape nobody has
 * named still gets a stable id and still shows up in the frequency counts.
 */
export type PatternId = string

export type Tier = 1 | 2 | 3 | 4

export interface Pattern {
  id: PatternId
  label: string
  tier: Tier
  /** Prerequisites — the DAG of §10.1.1. Topological order is a hard constraint. */
  requires: PatternId[]
  blurb: string
}

/**
 * The named catalogue. Anything not in here is still a valid pattern with a
 * derived id; `patternOf` synthesises an entry so unknown shapes are counted
 * rather than dropped.
 */
export const PATTERNS: readonly Pattern[] = [
  {
    id: 'satisfied',
    label: 'Satisfied number',
    tier: 1,
    requires: [],
    blurb: 'A number with all its mines already flagged. Every remaining neighbour is safe.',
  },
  {
    id: 'forced',
    label: 'Forced mines',
    tier: 1,
    requires: [],
    blurb: 'A number with exactly as many hidden neighbours as mines left. All of them are mines.',
  },
  {
    id: '1-1',
    label: '1-1',
    tier: 2,
    requires: ['satisfied', 'forced'],
    blurb: 'Two adjacent 1s where one sees a subset of the other. The cell only the second one sees is safe.',
  },
  {
    id: '1-2',
    label: '1-2',
    tier: 2,
    requires: ['1-1'],
    blurb: 'A 1 beside a 2. The cell the 2 sees but the 1 does not must be a mine.',
  },
  // 1-3 and 1-4 are the same reading as 1-2 with a bigger number, and the
  // frequency instrumentation puts both *above* 1-2-1 and 2-2 on real expert
  // boards. Catalogued on that evidence rather than on how famous they are.
  {
    id: '1-3',
    label: '1-3',
    tier: 2,
    requires: ['1-2'],
    blurb: 'A 1 beside a 3. Every cell the 3 sees and the 1 does not is a mine.',
  },
  {
    id: '1-4',
    label: '1-4',
    tier: 2,
    requires: ['1-3'],
    blurb: 'The same reading again, with a 4. The bigger number resolves more cells at once.',
  },
  {
    id: '2-2',
    label: '2-2',
    tier: 2,
    requires: ['1-2'],
    blurb: 'Two adjacent 2s. The overlap is forced, which resolves the cells outside it.',
  },
  {
    id: '1-1-1',
    label: '1-1-1',
    tier: 3,
    requires: ['1-1'],
    blurb: 'Three 1s in a line, usually against a wall. The middle 1 fixes what the outer two share.',
  },
  {
    id: '1-2-1',
    label: '1-2-1',
    tier: 3,
    requires: ['1-2'],
    blurb: 'Three numbers in a line. The mines sit under the 1s, and the middle cell is safe.',
  },
  {
    id: '1-2-2-1',
    label: '1-2-2-1',
    tier: 3,
    requires: ['1-2-1'],
    blurb: 'Four in a line. The two middle cells are mines and the outer pair is safe.',
  },
  {
    id: 'tank',
    label: 'Tank enumeration',
    tier: 4,
    requires: ['1-2-1'],
    blurb: 'No local rule applies. Enumerate every consistent arrangement of the frontier and take what they all agree on.',
  },
  {
    id: 'global-count',
    label: 'Mine counting',
    tier: 4,
    requires: ['forced'],
    blurb: 'Uses the total mines left rather than any single number. Often the whole endgame.',
  },
] as const

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]))

export function getPattern(id: PatternId): Pattern | undefined {
  return BY_ID.get(id)
}

/** The number a player reads off a revealed cell: its value minus flags placed. */
export function effectiveCount(view: SolverView, cell: CellId): number {
  const ni = neighborIndex(view.width, view.height)
  let flags = 0
  for (let k = 0; k < ni.count[cell]; k++) {
    if (view.state[ni.table[cell * 8 + k]] === FLAGGED) flags++
  }
  return view.adj[cell] - flags
}

export interface PatternMatch {
  id: PatternId
  pattern: Pattern
  /**
   * Proof depth (§10.1.3): the minimum number of witnesses the deduction needs.
   * Falls straight out of the solver, so difficulty is measured rather than
   * asserted — 1-1 is 2, 1-2-1 is 3, tank endgames are deeper.
   */
  depth: number
  /** The minimised deduction, which is what an overlay should draw. */
  deduction: Deduction
}

/**
 * Name a deduction. `view` must be the state the deduction was derived from.
 *
 * Witnesses are minimised first: an eleven-witness proof teaches nothing, and
 * the minimal set is also what makes the count signature meaningful.
 */
export function patternOf(view: SolverView, d: Deduction): PatternMatch {
  const min = minimizeWitnesses(view, d)
  const ws = min.witnesses

  let id: PatternId
  if (d.rule === 'global-count' || ws.length === 0) {
    id = 'global-count'
  } else if (ws.length === 1) {
    // A single witness is either spent (every mine flagged, so the rest is safe)
    // or saturated (as many hidden neighbours as mines left). Nothing else is
    // provable from one number alone.
    id = effectiveCount(view, ws[0]) === 0 ? 'satisfied' : 'forced'
  } else if (ws.length > 4) {
    // Past four numbers the shape stops being a nameable pattern and is just
    // enumeration; calling it `2-1-2-1-3` would invent pedagogy that is not there.
    id = 'tank'
  } else {
    id = signature(view, ws)
  }

  const pattern = BY_ID.get(id) ?? synthesise(id, ws.length)
  return { id, pattern, depth: Math.max(1, ws.length), deduction: min }
}

/**
 * Effective counts of the witnesses in board order, canonicalised against their
 * own reverse so a mirrored 2-1 is still reported as 1-2.
 */
function signature(view: SolverView, witnesses: CellId[]): PatternId {
  const counts = [...witnesses]
    .sort((a, b) => a - b)
    .map((w) => effectiveCount(view, w))
  const fwd = counts.join('-')
  const rev = [...counts].reverse().join('-')
  return fwd <= rev ? fwd : rev
}

/** An unnamed shape still needs a tier and a place in the DAG. */
function synthesise(id: PatternId, witnessCount: number): Pattern {
  const tier: Tier = witnessCount <= 1 ? 1 : witnessCount === 2 ? 2 : witnessCount <= 4 ? 3 : 4
  const requires: PatternId[] =
    tier === 1 ? [] : tier === 2 ? ['satisfied', 'forced'] : tier === 3 ? ['1-2'] : ['1-2-1']
  return {
    id,
    label: id,
    tier,
    requires,
    blurb: `A ${witnessCount}-number proof. Read the numbers together rather than one at a time.`,
  }
}

/**
 * Teaching order (§10.1). Derived, never hand-authored:
 * tier, then frequency descending, then proof depth ascending — all subject to
 * the prerequisite DAG, which wins outright.
 *
 * `frequency` is the observed count per pattern id from instrumentation over
 * generated boards; anything absent sorts as never-seen.
 */
export function teachingOrder(
  patterns: readonly Pattern[],
  frequency: ReadonlyMap<PatternId, number> = new Map(),
  depth: ReadonlyMap<PatternId, number> = new Map(),
): Pattern[] {
  const byId = new Map(patterns.map((p) => [p.id, p]))
  const score = (p: Pattern) => [
    p.tier,
    -(frequency.get(p.id) ?? 0),
    depth.get(p.id) ?? p.tier + 1,
    p.id,
  ] as const

  const ready = [...patterns].sort((a, b) => {
    const x = score(a), y = score(b)
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number)
    return String(x[3]).localeCompare(String(y[3]))
  })

  // Kahn over the DAG, taking the best-scoring available node each step, so the
  // soft ordering only ever breaks ties the prerequisites leave open.
  const done = new Set<PatternId>()
  const out: Pattern[] = []
  let progress = true
  while (out.length < ready.length && progress) {
    progress = false
    for (const p of ready) {
      if (done.has(p.id)) continue
      // A prerequisite outside this set cannot block: it is not being taught.
      if (p.requires.some((r) => byId.has(r) && !done.has(r))) continue
      out.push(p)
      done.add(p.id)
      progress = true
      break
    }
  }
  // A cycle would strand nodes. Append them rather than silently dropping.
  for (const p of ready) if (!done.has(p.id)) out.push(p)
  return out
}
