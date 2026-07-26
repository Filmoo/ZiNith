import type { Tick } from '../game/controller.ts'
import type { Theme } from './atlas.ts'

/**
 * The solve ribbon (§8.3): one tick per move, width proportional to time taken.
 * During play it shows only timing; after the game the coach recolours it.
 */
export function drawRibbon(canvas: HTMLCanvasElement, ticks: Tick[], theme: Theme, colorOf?: (i: number) => string) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1)
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = theme.surface
  g.fillRect(0, 0, w, h)
  if (ticks.length === 0) return

  const total = ticks.reduce((a, t) => a + Math.max(t.durMs, 1), 0)
  let x = 0
  for (let i = 0; i < ticks.length; i++) {
    const tw = (Math.max(ticks[i].durMs, 1) / total) * w
    g.fillStyle = colorOf ? colorOf(i) : (ticks[i].durMs > 900 ? theme.rule : theme.inkDim)
    g.fillRect(x, 0, Math.max(0.8, tw - 0.5), h)
    x += tw
  }
}
