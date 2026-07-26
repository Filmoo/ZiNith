/**
 * How expensive is learning mode's per-move analysis?
 *
 * §7.3 says blocking needs a solver call before every move and that learning
 * mode should pre-solve in a worker. This measures what that actually costs, so
 * the decision is made on numbers rather than on the assumption.
 *
 *   npm run bench:optimal
 */
import { createBoard, open, solverView, type Board } from '../engine/board.ts'
import { generateNoGuess } from '../engine/generate.ts'
import { PRESETS } from '../engine/presets.ts'
import { solve } from '../engine/solver/index.ts'
import { HIDDEN } from '../engine/types.ts'
import { planFrom, costOf } from '../engine/coach/optimal.ts'

const p = PRESETS.expert
const samples: Array<{ b: Board; label: string }> = []

// Take boards at three depths: fresh, mid-game, and late.
for (let i = 0; i < 6; i++) {
  const g = generateNoGuess(
    { width: p.width, height: p.height, mineCount: p.mines, firstClick: 100 + i * 17 },
    { maxAttempts: 5000 },
  )
  if (!g) continue
  const b = createBoard(g.spec)
  open(b, g.spec.firstClick)
  samples.push({ b: structuredClone(b), label: 'early' })

  // Advance with certainties only, snapshotting partway and near the end.
  const total = b.width * b.height - b.mineCount
  let snappedMid = false
  for (let step = 0; step < 4000; step++) {
    const r = solve(solverView(b))
    if (r.deductions.length === 0) break
    let progressed = false
    for (const d of r.deductions) {
      for (const c of d.subject) {
        if (b.state[c] !== HIDDEN) continue
        if (d.verdict === 'safe') open(b, c)
        else { b.state[c] = 2; b.flagCount++ }
        progressed = true
      }
    }
    if (!progressed || b.exploded) break
    if (!snappedMid && b.revealedCount > total * 0.5) {
      samples.push({ b: structuredClone(b), label: 'mid' })
      snappedMid = true
    }
  }
  if (b.revealedCount < total) samples.push({ b: structuredClone(b), label: 'late' })
}

const byLabel = new Map<string, number[]>()
const costTimes: number[] = []

for (const { b, label } of samples) {
  const t0 = performance.now()
  const plan = planFrom(b)
  const dt = performance.now() - t0
  const arr = byLabel.get(label) ?? []
  arr.push(dt)
  byLabel.set(label, arr)

  // Costing one off-plan move is the other half of a blocked click.
  let target = -1
  for (let i = 0; i < b.state.length; i++) {
    if (b.state[i] === HIDDEN && !b.mines[i] && !plan.onPlan.has(`open:${i}`)) { target = i; break }
  }
  if (target >= 0) {
    const t1 = performance.now()
    costOf(b, { type: 'open', cell: target })
    costTimes.push(performance.now() - t1)
  }
}

const stat = (xs: number[]) => {
  if (xs.length === 0) return 'n/a'
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return `n=${s.length} p50 ${at(0.5).toFixed(1)}ms p90 ${at(0.9).toFixed(1)}ms max ${s[s.length - 1].toFixed(1)}ms`
}

console.log('\nexpert 30x16, one planFrom() per position')
for (const [label, xs] of byLabel) console.log(`  ${label.padEnd(6)} ${stat(xs)}`)
console.log(`\ncostOf() for one off-plan move`)
console.log(`  ${stat(costTimes)}`)
console.log('\nA blocked click costs planFrom + costOf; an accepted one costs planFrom alone.\n')
