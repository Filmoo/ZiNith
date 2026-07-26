/**
 * §11: the board is the only colourful thing on screen. Every other coloured
 * element earns its colour by referring back to a number.
 *
 * `accent` is the one addition to that rule, and it earns its place the same
 * way: it is the canonical "1" blue, reused for focus rings and the active
 * selection so interactive affordance never needs a new hue.
 */
export const TOKENS = {
  /** page background */
  surface: '#EFF2F6',
  /** raised chrome: bars, sheets, cards */
  panel: '#FFFFFF',
  cellHidden: '#D6DDE7',
  /** top-edge highlight that gives a hidden cell its bevel */
  cellHiddenEdge: '#E8EDF3',
  cellOpen: '#F9FAFC',
  rule: '#C7D0DC',
  ink: '#131922',
  inkDim: '#65717F',
  alert: '#C4262E',
  accent: '#1D4ED8',
} as const

/** Canonical Minesweeper palette — also the app's entire data-vis system. */
export const NUMBER_COLORS = [
  '', '#0000FF', '#007B00', '#FF0000', '#00007B',
  '#7B0000', '#007B7B', '#000000', '#7B7B7B',
] as const

export const DARK = {
  surface: '#0D1116',
  panel: '#161B22',
  cellHidden: '#242C37',
  cellHiddenEdge: '#2F3843',
  cellOpen: '#11161C',
  rule: '#313A45',
  ink: '#E6EBF2',
  inkDim: '#8A95A4',
  alert: '#FF5A61',
  accent: '#5C8BFF',
} as const

/** Dark theme lifts lightness but must not re-hue the numbers. */
export const NUMBER_COLORS_DARK = [
  '', '#5C8BFF', '#3FBF63', '#FF5F5F', '#7C93FF',
  '#D97A7A', '#3FC3C3', '#D8DEE6', '#A8B2BF',
] as const
