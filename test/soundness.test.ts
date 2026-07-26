import test from 'node:test'
import assert from 'node:assert/strict'
import { auditBoard, seededRandom } from './harness.ts'

/**
 * P1 acceptance criterion (§5.5). Every cell the solver calls safe must not be
 * a mine, and every cell it calls a mine must be one. Any failure is P0.
 */
test('soundness over 10,000 boards and their partial states', { timeout: 600_000 }, () => {
  const rand = seededRandom(0xC0FFEE)
  const presets: Array<[number, number, number]> = [
    [9, 9, 10],
    [16, 16, 40],
    [30, 16, 99],
  ]

  let violations = 0
  let stalls = 0
  const N = 10_000
  const t0 = Date.now()

  for (let i = 0; i < N; i++) {
    const p = presets[i % presets.length]
    const r = auditBoard(p[0], p[1], p[2], 'sound-' + i, rand)
    stalls += r.stalls
    if (r.violations.length > 0) {
      violations += r.violations.length
      console.error('UNSOUND', JSON.stringify(r.violations.slice(0, 5)))
    }
  }

  console.log(`  audited ${N} boards in ${Date.now() - t0}ms, ${stalls} stalls`)
  assert.equal(violations, 0)
})
