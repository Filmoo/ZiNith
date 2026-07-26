/**
 * §10.1.2 — pattern frequency instrumentation.
 *
 * Generates no-guess expert boards, solves them the way a perfect player would,
 * and counts which patterns actually carry the solve. The output is the derived
 * teaching order: tier, then frequency descending, then proof depth ascending,
 * subject to the prerequisite DAG.
 *
 *   npm run patterns            # default sample
 *   npm run patterns -- 1000    # bigger sample
 *
 * §10.1 asks for ~5,000 boards. That is minutes of work, so the default here is
 * smaller; run the full sample when the ordering is being committed to.
 */
import { PRESETS } from '../engine/presets.ts'
import { generateNoGuess } from '../engine/generate.ts'
import { measureFrequency, orderFrom } from '../engine/coach/curriculum.ts'
import { isPrimitive } from '../engine/coach/patterns.ts'
import type { BoardSpec } from '../engine/board.ts'

const n = Number(process.argv[2] ?? 200)
const p = PRESETS.expert

const t0 = performance.now()
const specs: BoardSpec[] = []
for (let i = 0; i < n; i++) {
  const g = generateNoGuess(
    { width: p.width, height: p.height, mineCount: p.mines, firstClick: (i * 37) % (p.width * p.height) },
    { maxAttempts: 5000 },
  )
  if (g) specs.push(g.spec)
}
const tGen = performance.now() - t0

const t1 = performance.now()
const report = measureFrequency(specs)
const tSolve = performance.now() - t1

const total = [...report.frequency.values()].reduce((a, b) => a + b, 0)
const occTotal = [...report.occurrences.values()].reduce((a, b) => a + b, 0)

console.log(`\nboards ${report.boards}  generated in ${tGen.toFixed(0)}ms  solved in ${tSolve.toFixed(0)}ms`)
console.log(`${total} irreducible firings over ${report.positions} positions`)
console.log(`${occTotal} shape occurrences\n`)

/*
 * Two columns, because they answer two different questions and only the second
 * one is about teaching. `firings` counts irreducible proofs, so a 1-2-1 is
 * credited to the two 1-2 reads it decomposes into and looks vanishingly rare.
 * `seen` counts the shape being on the board forcing something, which is what a
 * player recognises. Order follows `seen`.
 */
console.log('derived teaching order (§10.1)')
console.log('  #  pattern      tier  depth      firings   share         seen    seen%   per pos')
orderFrom(report).forEach((pat, i) => {
  const f = report.frequency.get(pat.id) ?? 0
  const o = report.occurrences.get(pat.id) ?? 0
  const d = report.depth.get(pat.id)
  const share = total > 0 ? ((f / total) * 100).toFixed(2) : '0.00'
  const oShare = occTotal > 0 ? ((o / occTotal) * 100).toFixed(2) : '0.00'
  const perPos = report.positions > 0 ? (o / report.positions).toFixed(2) : '0.00'
  console.log(
    `  ${String(i + 1).padStart(2)}  ${pat.id.padEnd(12)} ${String(pat.tier).padStart(4)}  ` +
      `${(d === undefined ? '—' : String(d)).padStart(5)}  ${String(f).padStart(11)}  ${share.padStart(6)}%  ` +
      `${String(o).padStart(11)}  ${oShare.padStart(6)}%  ${perPos.padStart(7)}`,
  )
})

const shapeOnly = [...report.occurrences.entries()]
  .filter(([id]) => !orderFrom(report).some((p2) => p2.id === id))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)

if (shapeOnly.length > 0) {
  console.log('\nuncatalogued shapes, by how often they are seen')
  console.log('  pattern             seen    seen%')
  for (const [id, o] of shapeOnly) {
    const oShare = ((o / occTotal) * 100).toFixed(2)
    console.log(`  ${id.padEnd(12)} ${String(o).padStart(11)}  ${oShare.padStart(6)}%`)
  }
}

// Shapes with no catalogue entry. If one of these outranks a named pattern it is
// a candidate for teaching, which is the whole point of measuring.
const named = new Set(orderFrom(report).map((p2) => p2.id))
const unnamed = [...report.frequency.entries()]
  // Primitives are not catalogue candidates — a single-number read has no depth
  // to teach. They dominate this column and would otherwise sit at the top of a
  // list headed "candidates for the catalogue".
  .filter(([id]) => !named.has(id) && !isPrimitive(id))
  .sort((a, b) => b[1] - a[1])

if (unnamed.length > 0) {
  console.log('\nunnamed shapes, by frequency (candidates for the catalogue)')
  console.log('  pattern      depth      firings   share')
  for (const [id, f] of unnamed) {
    const d = report.depth.get(id)
    const share = ((f / total) * 100).toFixed(3)
    console.log(
      `  ${id.padEnd(12)} ${(d === undefined ? '—' : String(d)).padStart(5)}  ` +
        `${String(f).padStart(11)}  ${share.padStart(6)}%`,
    )
  }
}
console.log()
