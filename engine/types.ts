export type CellId = number

export const HIDDEN = 0
export const REVEALED = 1
export const FLAGGED = 2
export const QUESTION = 3

/** Everything the solver is allowed to see. Never contains mine positions. */
export interface SolverView {
  width: number
  height: number
  /** HIDDEN | REVEALED | FLAGGED | QUESTION per cell */
  state: Uint8Array
  /** adjacent mine count; only meaningful where state === REVEALED */
  adj: Uint8Array
  totalMines: number
}

export type RuleId =
  | 'count-satisfied'
  | 'count-forced'
  | 'subset'
  | 'tank'
  | 'global-count'

export interface Deduction {
  rule: RuleId
  subject: CellId[]
  witnesses: CellId[]
  verdict: 'safe' | 'mine'
}

export interface SolveResult {
  deductions: Deduction[]
  probabilities?: Map<CellId, number>
  stuck: boolean
  /** true when a frontier component exceeded the enumeration cap */
  incomplete: boolean
}

export interface SolveOpts {
  probabilities?: boolean
  maxComponent?: number
}
