import type { Board } from '../../engine/board.ts'
import { HIDDEN, REVEALED, FLAGGED, QUESTION } from '../../engine/types.ts'
import {
  buildAtlas, LIGHT_THEME, type Theme,
  S_HIDDEN, S_OPEN, S_NUM1, S_FLAG, S_MINE, S_MINE_HIT, S_QUESTION, S_WRONG_FLAG,
} from './atlas.ts'

export interface Viewport { scale: number; ox: number; oy: number }

/**
 * Canvas board renderer (§7.4). One draw call per frame, dirty-rect only.
 * Never allocates during a frame.
 */
export class BoardRenderer {
  private canvas: HTMLCanvasElement | null = null
  private g: CanvasRenderingContext2D | null = null
  private atlas: HTMLCanvasElement | null = null
  private atlasCs = 0
  private theme: Theme = LIGHT_THEME
  private dpr = 1
  /** Base cell size in CSS px before zoom. */
  baseCell = 24
  vp: Viewport = { scale: 1, ox: 0, oy: 0 }

  attach(canvas: HTMLCanvasElement, theme: Theme) {
    this.canvas = canvas
    this.g = canvas.getContext('2d', { alpha: false })
    this.theme = theme
    this.dpr = Math.min(3, globalThis.devicePixelRatio || 1)
  }

  setTheme(theme: Theme) {
    this.theme = theme
    this.atlas = null
  }

  /**
   * Drop the cached atlas. Needed when a webfont arrives after the atlas was
   * built, since the digits would otherwise stay baked in the fallback face.
   */
  invalidateAtlas() {
    this.atlas = null
  }

  /** Physical cell size in device px, always an integer to keep blits crisp. */
  private cellPx(): number {
    return Math.max(6, Math.round(this.baseCell * this.vp.scale * this.dpr))
  }

  resize(cssW: number, cssH: number) {
    const c = this.canvas
    if (!c) return
    this.dpr = Math.min(3, globalThis.devicePixelRatio || 1)
    c.width = Math.round(cssW * this.dpr)
    c.height = Math.round(cssH * this.dpr)
    c.style.width = cssW + 'px'
    c.style.height = cssH + 'px'
  }

  /** Scale and centre so the whole board fits the viewport. */
  fit(board: { width: number; height: number }, cssW: number, cssH: number, pad = 8) {
    const s = Math.min((cssW - pad * 2) / (board.width * this.baseCell), (cssH - pad * 2) / (board.height * this.baseCell))
    this.vp.scale = s
    const w = board.width * this.baseCell * s
    const h = board.height * this.baseCell * s
    this.vp.ox = (cssW - w) / 2
    this.vp.oy = (cssH - h) / 2
  }

  /** Cell under a CSS-pixel point, or -1. */
  cellAt(board: { width: number; height: number }, cssX: number, cssY: number): number {
    const cs = this.cellPx() / this.dpr
    const x = Math.floor((cssX - this.vp.ox) / cs)
    const y = Math.floor((cssY - this.vp.oy) / cs)
    if (x < 0 || y < 0 || x >= board.width || y >= board.height) return -1
    return y * board.width + x
  }

  private spriteFor(b: Board, i: number): number {
    const st = b.state[i]
    if (b.exploded) {
      if (st === FLAGGED) return b.mines[i] ? S_FLAG : S_WRONG_FLAG
      if (b.mines[i]) return st === REVEALED ? S_MINE_HIT : S_MINE
    }
    if (st === FLAGGED) return S_FLAG
    if (st === QUESTION) return S_QUESTION
    if (st === HIDDEN) return S_HIDDEN
    return b.adj[i] > 0 ? S_NUM1 + b.adj[i] - 1 : S_OPEN
  }

  private ensureAtlas() {
    const cs = this.cellPx()
    if (!this.atlas || this.atlasCs !== cs) {
      this.atlas = buildAtlas(cs, this.theme)
      this.atlasCs = cs
    }
  }

  /**
   * The all-hidden grid shown before the first click, when no Board exists
   * yet. Takes dimensions rather than a Board for exactly that reason.
   */
  drawIdle(dims: { width: number; height: number }) {
    const g = this.g, c = this.canvas
    if (!g || !c) return
    this.ensureAtlas()
    g.fillStyle = this.theme.surface
    g.fillRect(0, 0, c.width, c.height)
    const cs = this.atlasCs
    const ox = Math.round(this.vp.ox * this.dpr), oy = Math.round(this.vp.oy * this.dpr)
    for (let i = 0; i < dims.width * dims.height; i++) {
      const x = ox + (i % dims.width) * cs
      const y = oy + Math.floor(i / dims.width) * cs
      g.drawImage(this.atlas!, S_HIDDEN * cs, 0, cs, cs, x, y, cs, cs)
    }
  }

  drawAll(b: Board) {
    const g = this.g, c = this.canvas
    if (!g || !c) return
    this.ensureAtlas()
    g.fillStyle = this.theme.surface
    g.fillRect(0, 0, c.width, c.height)
    for (let i = 0; i < b.state.length; i++) this.blit(b, i)
  }

  drawDirty(b: Board, dirty: Iterable<number>) {
    if (!this.g) return
    this.ensureAtlas()
    for (const i of dirty) this.blit(b, i)
  }

  private blit(b: Board, i: number) {
    const g = this.g!
    const cs = this.atlasCs
    const x = Math.round(this.vp.ox * this.dpr) + (i % b.width) * cs
    const y = Math.round(this.vp.oy * this.dpr) + Math.floor(i / b.width) * cs
    g.drawImage(this.atlas!, this.spriteFor(b, i) * cs, 0, cs, cs, x, y, cs, cs)
  }

  /**
   * Live hint layer for learning mode (§7.3).
   *
   * Deliberately quieter than the review overlay: this sits under the player's
   * hands while they are still choosing, so it marks cells without burying the
   * numbers they are reading. Safe is the canonical "2" green, mines take the
   * alert red the board already uses for flags — no new hues (§11).
   */
  hints(b: Board, safe: number[], mine: number[]) {
    const g = this.g
    if (!g) return
    const cs = this.atlasCs
    const px = (i: number) => [
      Math.round(this.vp.ox * this.dpr) + (i % b.width) * cs,
      Math.round(this.vp.oy * this.dpr) + Math.floor(i / b.width) * cs,
    ] as const

    g.save()
    g.lineWidth = Math.max(2, cs * 0.09)

    const green = this.theme.numbers[2] ?? '#007B00'
    g.fillStyle = green
    g.strokeStyle = green
    for (const c of safe) {
      const [x, y] = px(c)
      g.globalAlpha = 0.16
      g.fillRect(x, y, cs, cs)
      g.globalAlpha = 0.85
      g.strokeRect(x + cs * 0.1, y + cs * 0.1, cs * 0.8, cs * 0.8)
    }

    // Mines get a cross rather than a fill: the message is "do not open this",
    // and a solid block reads too much like a flag that is already placed.
    g.strokeStyle = this.theme.alert
    g.globalAlpha = 0.9
    for (const c of mine) {
      const [x, y] = px(c)
      g.beginPath()
      g.moveTo(x + cs * 0.28, y + cs * 0.28)
      g.lineTo(x + cs * 0.72, y + cs * 0.72)
      g.moveTo(x + cs * 0.72, y + cs * 0.28)
      g.lineTo(x + cs * 0.28, y + cs * 0.72)
      g.stroke()
    }

    g.restore()
  }

  /** Coach overlay layer (§8.3): witness shading and subject arrows. */
  overlay(b: Board, witnesses: number[], subjects: number[]) {
    const g = this.g
    if (!g) return
    const cs = this.atlasCs
    const px = (i: number) => [
      Math.round(this.vp.ox * this.dpr) + (i % b.width) * cs,
      Math.round(this.vp.oy * this.dpr) + Math.floor(i / b.width) * cs,
    ] as const
    g.save()
    g.globalAlpha = 0.28
    g.fillStyle = '#0000FF'
    for (const w of witnesses) { const [x, y] = px(w); g.fillRect(x, y, cs, cs) }
    g.globalAlpha = 0.9
    g.strokeStyle = '#C4262E'
    g.lineWidth = Math.max(2, cs * 0.08)
    for (const s of subjects) { const [x, y] = px(s); g.strokeRect(x + cs * 0.12, y + cs * 0.12, cs * 0.76, cs * 0.76) }
    g.restore()
  }
}
