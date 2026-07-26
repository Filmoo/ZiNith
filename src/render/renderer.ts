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

  private cellXY(b: { width: number }, i: number): readonly [number, number] {
    const cs = this.atlasCs
    return [
      Math.round(this.vp.ox * this.dpr) + (i % b.width) * cs,
      Math.round(this.vp.oy * this.dpr) + Math.floor(i / b.width) * cs,
    ] as const
  }

  /** A rounded rect path, for rings that read as deliberate rather than as a grid. */
  private ringPath(x: number, y: number, size: number, inset: number, radius: number) {
    const g = this.g!
    const x0 = x + inset, y0 = y + inset, s = size - inset * 2
    const r = Math.min(radius, s / 2)
    g.beginPath()
    g.moveTo(x0 + r, y0)
    g.arcTo(x0 + s, y0, x0 + s, y0 + s, r)
    g.arcTo(x0 + s, y0 + s, x0, y0 + s, r)
    g.arcTo(x0, y0 + s, x0, y0, r)
    g.arcTo(x0, y0, x0 + s, y0, r)
    g.closePath()
  }

  /**
   * Coach overlay (§8.3), also learning mode's live hint (§P8).
   *
   * Deliberately draws *rings*, not filled tints. A translucent fill over a
   * witness washes out the very number the player is being asked to read, which
   * defeats the purpose — the overlay has to point at the evidence without
   * hiding it. Everything here therefore sits inside the cell's edges, and the
   * only fills are on cells that are still face-down and have nothing to hide.
   *
   * Colours come from the theme's own palette, so dark mode needs no special
   * case: witnesses take canonical "1" blue, safe subjects canonical "2" green,
   * mine subjects the alert red already used for detonations and wrong flags.
   */
  overlay(
    b: Board,
    layers: {
      /** Revealed numbers forming the proof. Ringed, never covered. */
      witnesses?: number[]
      /** Cells proven safe. */
      safe?: number[]
      /** Cells proven to be mines. */
      mines?: number[]
      /** The single cell the player should act on next. */
      focus?: number
      /** What acting on `focus` means, which changes its marker. */
      focusKind?: 'open' | 'flag' | 'chord'
    },
  ) {
    const g = this.g
    if (!g) return
    const cs = this.atlasCs
    const hair = Math.max(1.5, cs * 0.055)
    g.save()
    g.lineJoin = 'round'

    // Witnesses: a hairline ring just inside the cell edge. Reads as "look at
    // these numbers" while leaving the glyphs fully legible.
    if (layers.witnesses?.length) {
      g.strokeStyle = this.theme.numbers[1]
      g.lineWidth = hair
      g.globalAlpha = 0.85
      for (const w of layers.witnesses) {
        const [x, y] = this.cellXY(b, w)
        this.ringPath(x, y, cs, cs * 0.1, cs * 0.18)
        g.stroke()
      }
    }

    /*
     * Subjects. These are face-down cells, so a wash costs no information — but
     * it stays faint: at ~26px a cell is small enough that a strong fill plus a
     * ring reads as one solid block of colour rather than as a marked cell.
     */
    const subject = (cells: number[], colour: string) => {
      g.strokeStyle = colour
      g.fillStyle = colour
      g.lineWidth = hair
      for (const c of cells) {
        const [x, y] = this.cellXY(b, c)
        this.ringPath(x, y, cs, cs * 0.13, cs * 0.2)
        g.globalAlpha = 0.1
        g.fill()
        g.globalAlpha = 0.9
        g.stroke()
      }
    }
    if (layers.safe?.length) subject(layers.safe, this.theme.numbers[2])
    if (layers.mines?.length) subject(layers.mines, this.theme.alert)

    /*
     * Focus marker: a filled dot at the centre.
     *
     * Not corner brackets — they were tried and at this cell size their arms
     * almost meet, so together with the subject ring the cell read as a solid
     * colour swatch. A dot is unmistakably "this one" and cannot merge with the
     * ring around it.
     */
    if (layers.focus !== undefined) {
      const [x, y] = this.cellXY(b, layers.focus)
      const kind = layers.focusKind ?? 'open'
      g.globalAlpha = 1
      g.fillStyle = kind === 'flag' ? this.theme.alert : this.theme.numbers[2]
      g.beginPath()
      g.arc(x + cs / 2, y + cs / 2, Math.max(2, cs * 0.13), 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
  }
}
