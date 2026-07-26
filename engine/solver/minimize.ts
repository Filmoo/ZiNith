import { neighborIndex } from '../neighbors.ts'
import { FLAGGED, HIDDEN, QUESTION, REVEALED, type CellId, type Deduction, type SolverView } from '../types.ts'

/**
 * Does this set of revealed numbers, on its own, prove the verdict?
 * Used to shrink witness sets to something a human can be shown (§5.1) —
 * a proof with eleven witnesses teaches nothing.
 */
export function provesLocally(
  view: SolverView,
  witnesses: CellId[],
  subject: CellId[],
  verdict: 'safe' | 'mine',
  maxCells = 26,
): boolean {
  const ni = neighborIndex(view.width, view.height)
  const local = new Map<number, number>()
  const cells: number[] = []
  const cons: Array<{ cells: number[]; count: number }> = []

  for (const w of witnesses) {
    if (view.state[w] !== REVEALED) return false
    let flags = 0
    const hidden: number[] = []
    for (let k = 0; k < ni.count[w]; k++) {
      const nb = ni.table[w * 8 + k]
      if (view.state[nb] === FLAGGED) flags++
      else if (view.state[nb] === HIDDEN || view.state[nb] === QUESTION) hidden.push(nb)
    }
    if (hidden.length === 0) continue
    for (const c of hidden) {
      if (!local.has(c)) {
        local.set(c, cells.length)
        cells.push(c)
      }
    }
    cons.push({ cells: hidden.map((c) => local.get(c)!), count: view.adj[w] - flags })
  }

  for (const s of subject) if (!local.has(s)) return false
  if (cells.length > maxCells) return false

  const m = cells.length
  const assign = new Uint8Array(m)
  const target = verdict === 'mine' ? 1 : 0
  let solutions = 0
  let contradicted = false

  const ok = (upto: number): boolean => {
    for (const c of cons) {
      let mines = 0
      let unknown = 0
      for (const ci of c.cells) {
        if (ci < upto) mines += assign[ci]
        else unknown++
      }
      if (mines > c.count || mines + unknown < c.count) return false
    }
    return true
  }

  const dfs = (i: number): void => {
    if (contradicted) return
    if (i === m) {
      if (!ok(m)) return
      solutions++
      for (const s of subject) {
        if (assign[local.get(s)!] !== target) {
          contradicted = true
          return
        }
      }
      return
    }
    for (let v = 0; v <= 1; v++) {
      assign[i] = v as 0 | 1
      if (ok(i + 1)) dfs(i + 1)
      assign[i] = 0
      if (contradicted) return
    }
  }

  dfs(0)
  return solutions > 0 && !contradicted
}

/** Greedily drop witnesses that the proof does not need. */
export function minimizeWitnesses(view: SolverView, d: Deduction): Deduction {
  if (d.rule === 'global-count') return d // the mine budget is an implicit witness
  let ws = d.witnesses.slice()
  if (!provesLocally(view, ws, d.subject, d.verdict)) return d
  for (const w of d.witnesses) {
    const trial = ws.filter((x) => x !== w)
    if (trial.length > 0 && provesLocally(view, trial, d.subject, d.verdict)) ws = trial
  }
  return { ...d, witnesses: ws }
}
