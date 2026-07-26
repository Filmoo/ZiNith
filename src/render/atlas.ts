import { TOKENS, NUMBER_COLORS, DARK, NUMBER_COLORS_DARK } from '../tokens.ts'

/**
 * A theme carries its own number palette. Dark mode must not reuse the light
 * one — canonical "7" is `#000000`, which is invisible on a dark cell.
 */
export interface Theme {
  surface: string
  panel: string
  cellHidden: string
  cellHiddenEdge: string
  cellOpen: string
  rule: string
  ink: string
  inkDim: string
  alert: string
  accent: string
  dark: boolean
  /** 1-indexed; slot 0 is unused so `numbers[adj]` reads directly */
  numbers: readonly string[]
}

export const LIGHT_THEME: Theme = { ...TOKENS, dark: false, numbers: NUMBER_COLORS }
export const DARK_THEME: Theme = { ...DARK, dark: true, numbers: NUMBER_COLORS_DARK }

/** Sprite slots in the atlas, in draw order. */
export const S_HIDDEN = 0
export const S_OPEN = 1
export const S_NUM1 = 2 // .. S_NUM1 + 7 == 8
export const S_FLAG = 10
export const S_MINE = 11
export const S_MINE_HIT = 12
export const S_QUESTION = 13
export const S_WRONG_FLAG = 14
export const SPRITE_COUNT = 15

/** The face fonts the atlas draws with, so callers can preload exactly these. */
export const ATLAS_FONTS = ['700 24px "IBM Plex Mono"', '600 24px "Inter Tight Variable"'] as const

/**
 * Pre-rendered sprite atlas (§7.4). Built once per (cell size, theme) so the
 * per-frame cost of a cascade is a drawImage blit, not a path fill.
 *
 * `cs` is in device pixels and already includes DPR, so hairlines are derived
 * from it rather than assumed to be 1px.
 */
export function buildAtlas(cs: number, theme: Theme): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = cs * SPRITE_COUNT
  c.height = cs
  const g = c.getContext('2d')!
  g.textAlign = 'center'
  g.textBaseline = 'middle'

  const hair = Math.max(1, Math.round(cs / 24))
  const at = (i: number) => i * cs

  /**
   * Grid lines on the right and bottom edges only. Stroking every cell would
   * double up where two cells meet and read as a 2px grid.
   */
  const grid = (x: number) => {
    g.fillStyle = theme.rule
    g.fillRect(x + cs - hair, 0, hair, cs)
    g.fillRect(x, cs - hair, cs, hair)
  }

  /** A hidden cell: flat fill, lit top edge, shaded bottom edge. */
  const hiddenFace = (x: number) => {
    g.fillStyle = theme.cellHidden
    g.fillRect(x, 0, cs, cs)
    g.fillStyle = theme.cellHiddenEdge
    g.fillRect(x, 0, cs, Math.max(hair, Math.round(cs * 0.07)))
    g.fillRect(x, 0, Math.max(hair, Math.round(cs * 0.07)), cs)
    grid(x)
  }

  const openFace = (x: number) => {
    g.fillStyle = theme.cellOpen
    g.fillRect(x, 0, cs, cs)
    grid(x)
  }

  hiddenFace(at(S_HIDDEN))
  openFace(at(S_OPEN))

  const fontPx = Math.round(cs * 0.6)
  g.font = `700 ${fontPx}px "IBM Plex Mono", ui-monospace, monospace`
  for (let n = 1; n <= 8; n++) {
    const x = at(S_NUM1 + n - 1)
    openFace(x)
    g.fillStyle = theme.numbers[n]
    g.fillText(String(n), x + cs / 2, cs / 2 + cs * 0.03)
  }

  /*
   * Flag: pennant, then a muted pole. The pole is deliberately `inkDim` and
   * thin rather than full-contrast ink — at ~26px per cell a bright vertical
   * bar reads as a numeral, so a flagged cell was being mistaken for a "1".
   * Red carries the meaning; the pole is only scaffolding.
   */
  {
    const x = at(S_FLAG)
    hiddenFace(x)
    const poleW = Math.max(hair, Math.round(cs * 0.055))
    g.fillStyle = theme.inkDim
    g.fillRect(x + Math.round(cs * 0.54 - poleW / 2), Math.round(cs * 0.2), poleW, Math.round(cs * 0.58))
    g.fillRect(x + Math.round(cs * 0.34), Math.round(cs * 0.76), Math.round(cs * 0.34), Math.max(hair, Math.round(cs * 0.06)))
    g.fillStyle = theme.alert
    g.beginPath()
    g.moveTo(x + cs * 0.54, cs * 0.17)
    g.lineTo(x + cs * 0.17, cs * 0.36)
    g.lineTo(x + cs * 0.54, cs * 0.55)
    g.closePath()
    g.fill()
  }

  const mine = (x: number, bg: string, body: string) => {
    g.fillStyle = bg
    g.fillRect(x, 0, cs, cs)
    grid(x)
    const cx = x + cs / 2, cy = cs / 2, r = cs * 0.23
    g.strokeStyle = body
    g.lineWidth = Math.max(hair, cs * 0.055)
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4
      g.beginPath()
      g.moveTo(cx - Math.cos(a) * cs * 0.35, cy - Math.sin(a) * cs * 0.35)
      g.lineTo(cx + Math.cos(a) * cs * 0.35, cy + Math.sin(a) * cs * 0.35)
      g.stroke()
    }
    g.fillStyle = body
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fill()
    // Specular dot: reads as a sphere rather than a blob at small cell sizes.
    g.fillStyle = bg
    g.globalAlpha = 0.5
    g.beginPath()
    g.arc(cx - r * 0.32, cy - r * 0.34, Math.max(hair, r * 0.24), 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }
  mine(at(S_MINE), theme.cellOpen, theme.ink)
  // The detonated cell is the one saturated field on the board.
  mine(at(S_MINE_HIT), theme.alert, theme.dark ? '#0D1116' : '#FFFFFF')

  {
    const x = at(S_QUESTION)
    hiddenFace(x)
    g.fillStyle = theme.inkDim
    g.font = `600 ${fontPx}px "Inter Tight Variable", system-ui, sans-serif`
    g.fillText('?', x + cs / 2, cs / 2 + cs * 0.03)
  }
  {
    const x = at(S_WRONG_FLAG)
    mine(x, theme.cellOpen, theme.inkDim)
    g.strokeStyle = theme.alert
    g.lineWidth = Math.max(hair, cs * 0.085)
    g.beginPath()
    g.moveTo(x + cs * 0.22, cs * 0.22)
    g.lineTo(x + cs * 0.78, cs * 0.78)
    g.moveTo(x + cs * 0.78, cs * 0.22)
    g.lineTo(x + cs * 0.22, cs * 0.78)
    g.stroke()
  }
  return c
}
