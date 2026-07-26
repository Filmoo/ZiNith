import { TOKENS, NUMBER_COLORS, DARK } from '../tokens.ts'

export type Theme = typeof TOKENS
export const LIGHT_THEME: Theme = TOKENS
export const DARK_THEME: Theme = DARK as unknown as Theme

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

/**
 * Pre-rendered sprite atlas (§7.4). Built once per (cell size, theme) so the
 * per-frame cost of a cascade is a drawImage blit, not a path fill.
 */
export function buildAtlas(cs: number, theme: Theme): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = cs * SPRITE_COUNT
  c.height = cs
  const g = c.getContext('2d')!
  g.textAlign = 'center'
  g.textBaseline = 'middle'

  const at = (i: number) => i * cs
  const face = (x: number, fill: string, edge?: string) => {
    g.fillStyle = fill
    g.fillRect(x, 0, cs, cs)
    if (edge) {
      g.fillStyle = edge
      g.fillRect(x, 0, cs, Math.max(1, Math.round(cs * 0.06)))
    }
    g.strokeStyle = theme.rule
    g.lineWidth = 1
    g.strokeRect(x + 0.5, 0.5, cs - 1, cs - 1)
  }

  face(at(S_HIDDEN), theme.cellHidden, theme.cellHiddenEdge)
  face(at(S_OPEN), theme.cellOpen)

  const fontPx = Math.round(cs * 0.62)
  g.font = `700 ${fontPx}px "IBM Plex Mono", ui-monospace, monospace`
  for (let n = 1; n <= 8; n++) {
    const x = at(S_NUM1 + n - 1)
    face(x, theme.cellOpen)
    g.fillStyle = NUMBER_COLORS[n]
    g.fillText(String(n), x + cs / 2, cs / 2 + cs * 0.02)
  }

  // Flag: pole plus pennant, drawn on a hidden face.
  {
    const x = at(S_FLAG)
    face(x, theme.cellHidden, theme.cellHiddenEdge)
    g.fillStyle = theme.ink
    g.fillRect(x + cs * 0.46, cs * 0.24, Math.max(1, cs * 0.07), cs * 0.5)
    g.fillRect(x + cs * 0.28, cs * 0.72, cs * 0.44, Math.max(1, cs * 0.09))
    g.fillStyle = theme.alert
    g.beginPath()
    g.moveTo(x + cs * 0.46, cs * 0.24)
    g.lineTo(x + cs * 0.2, cs * 0.4)
    g.lineTo(x + cs * 0.46, cs * 0.54)
    g.closePath()
    g.fill()
  }

  const mine = (x: number, bg: string) => {
    face(x, bg)
    g.fillStyle = theme.ink
    g.beginPath()
    g.arc(x + cs / 2, cs / 2, cs * 0.24, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = theme.ink
    g.lineWidth = Math.max(1, cs * 0.06)
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4
      g.beginPath()
      g.moveTo(x + cs / 2 - Math.cos(a) * cs * 0.36, cs / 2 - Math.sin(a) * cs * 0.36)
      g.lineTo(x + cs / 2 + Math.cos(a) * cs * 0.36, cs / 2 + Math.sin(a) * cs * 0.36)
      g.stroke()
    }
  }
  mine(at(S_MINE), theme.cellOpen)
  mine(at(S_MINE_HIT), theme.alert)

  {
    const x = at(S_QUESTION)
    face(x, theme.cellHidden, theme.cellHiddenEdge)
    g.fillStyle = theme.inkDim
    g.font = `700 ${fontPx}px "Inter Tight", system-ui, sans-serif`
    g.fillText('?', x + cs / 2, cs / 2)
  }
  {
    const x = at(S_WRONG_FLAG)
    mine(x, theme.cellOpen)
    g.strokeStyle = theme.alert
    g.lineWidth = Math.max(2, cs * 0.09)
    g.beginPath()
    g.moveTo(x + cs * 0.2, cs * 0.2)
    g.lineTo(x + cs * 0.8, cs * 0.8)
    g.moveTo(x + cs * 0.8, cs * 0.2)
    g.lineTo(x + cs * 0.2, cs * 0.8)
    g.stroke()
  }
  return c
}
