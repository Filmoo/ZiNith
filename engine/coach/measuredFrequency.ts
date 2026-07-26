/**
 * §10.1.2 frequency instrumentation, captured.
 *
 * Output of `npm run patterns -- 300`: 300 generated no-guess expert boards,
 * solved the way a perfect player would, 86,864 pattern firings counted. This
 * is what makes the pattern library's order *derived* rather than asserted —
 * see the table in the README for the reasoning.
 *
 * Re-run `npm run patterns` and update this file when the solver or the
 * pattern signature changes; the numbers are a measurement of the code, not a
 * fact about Minesweeper, so they go stale exactly when the code does.
 */
export const MEASURED_FREQUENCY: ReadonlyMap<string, number> = new Map([
  ['satisfied', 47211],
  ['forced', 35379],
  ['1-1', 2520],
  ['1-2', 985],
  ['tank', 322],
  ['global-count', 140],
  ['2-2', 49],
  ['1-2-2-1', 30],
  ['1-3', 30],
  ['1-2-1', 26],
  ['1-4', 14],
  ['1-1-1', 18],
])

export const MEASURED_DEPTH: ReadonlyMap<string, number> = new Map([
  ['satisfied', 1],
  ['forced', 1],
  ['1-1', 2],
  ['1-2', 2],
  ['2-2', 2],
  ['1-3', 2],
  ['1-4', 2],
  ['1-2-1', 3],
  ['1-1-1', 3],
  ['1-2-2-1', 4],
  ['tank', 5],
  ['global-count', 1],
])

export const MEASURED_SAMPLE = { boards: 300, firings: 86864 } as const
