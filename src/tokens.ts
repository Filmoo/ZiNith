/**
 * §11: the board is the only colourful thing on screen. Every other coloured
 * element earns its colour by referring back to a number.
 */
export const TOKENS = {
  surface: '#EDF0F4',
  cellHidden: '#DCE2EA',
  cellHiddenEdge: '#E9EEF4',
  cellOpen: '#F6F8FA',
  rule: '#C3CCD8',
  ink: '#1C2430',
  inkDim: '#6B7684',
  alert: '#C4262E',
} as const

/** Canonical Minesweeper palette — also the app's entire data-vis system. */
export const NUMBER_COLORS = [
  '', '#0000FF', '#007B00', '#FF0000', '#00007B',
  '#7B0000', '#007B7B', '#000000', '#7B7B7B',
] as const

export const DARK = {
  surface: '#12161C',
  cellHidden: '#232A33',
  cellHiddenEdge: '#2C343E',
  cellOpen: '#171C23',
  rule: '#39424E',
  ink: '#E7ECF2',
  inkDim: '#8C97A5',
  alert: '#FF5A61',
} as const

/** Dark theme lifts lightness but must not re-hue the numbers. */
export const NUMBER_COLORS_DARK = [
  '', '#5C8BFF', '#3FBF63', '#FF5F5F', '#7C93FF',
  '#D97A7A', '#3FC3C3', '#D8DEE6', '#A8B2BF',
] as const
