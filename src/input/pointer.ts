import type { Game, Scheme } from '../game/controller.ts'
import type { BoardRenderer } from '../render/renderer.ts'
import { REVEALED, HIDDEN } from '../../engine/types.ts'
import { tapChord, tapFlag } from '../platform/haptics.ts'

export interface InputOpts {
  scheme: Scheme
  /** §13.1 — still to be tuned on device against The Clean One. */
  longPressMs: number
  onChange: () => void
}

const SLOP = 9 // px of movement before a tap becomes a drag

interface P { id: number; x0: number; y0: number; x: number; y: number; cell: number; t: number }

/**
 * Pointer handling (§7.1, §7.2). Opens fire on pointerdown, never on click.
 * Returns a detach function.
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  game: () => Game,
  renderer: BoardRenderer,
  opts: () => InputOpts,
): () => void {
  const pointers = new Map<number, P>()
  let longTimer: ReturnType<typeof setTimeout> | null = null
  let longFired = false
  let panning = false
  let pinching = false
  let dragFlagging = false
  const flaggedThisDrag = new Set<number>()
  let pinchStart = 0
  let scaleStart = 1

  const clearLong = () => { if (longTimer !== null) { clearTimeout(longTimer); longTimer = null } }

  const cellOf = (e: PointerEvent) => {
    const g = game()
    // Before the first click there is no board yet — the config carries the
    // same dimensions, and cellAt only needs those.
    const dims = g.board ?? g.cfg
    const r = canvas.getBoundingClientRect()
    return renderer.cellAt(dims, e.clientX - r.left, e.clientY - r.top)
  }

  const isNumber = (cell: number) => {
    const b = game().board
    return !!b && b.state[cell] === REVEALED && b.adj[cell] > 0
  }

  const doOpen = (cell: number) => { game().open(cell); opts().onChange() }
  const doFlag = (cell: number) => { game().flag(cell); tapFlag(); opts().onChange() }
  const doChord = (cell: number) => { game().chord(cell); tapChord(); opts().onChange() }

  /** A completed tap, routed by control scheme (§7.1). */
  const tap = (cell: number) => {
    if (cell < 0) return
    const { scheme } = opts()
    if (scheme === 'no-flag') { if (!isNumber(cell)) doOpen(cell); return }
    if (isNumber(cell)) { doChord(cell); return }
    if (scheme === 'flag-first') doFlag(cell)
    else doOpen(cell)
  }

  /** A completed long press, routed by control scheme. */
  const longPress = (cell: number) => {
    if (cell < 0) return
    const { scheme } = opts()
    if (scheme === 'no-flag') return
    if (scheme === 'flag-first') { if (!isNumber(cell)) doOpen(cell); return }
    if (scheme === 'drag-flag') {
      dragFlagging = true
      flaggedThisDrag.clear()
      flaggedThisDrag.add(cell)
    }
    doFlag(cell)
  }

  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture?.(e.pointerId)
    const cell = cellOf(e)
    pointers.set(e.pointerId, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, cell, t: performance.now() })

    if (pointers.size === 2) {
      // Two-finger tap chords (§7.1 alt); pinch takes over if they move.
      clearLong()
      pinching = true
      const [a, b] = [...pointers.values()]
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
      scaleStart = renderer.vp.scale
      return
    }
    if (pointers.size > 2) { clearLong(); return }

    longFired = false
    panning = false
    clearLong()
    longTimer = setTimeout(() => {
      longFired = true
      longTimer = null
      longPress(cell)
    }, opts().longPressMs)
  }

  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY

    if (pinching && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchStart > 0) {
        renderer.vp.scale = Math.max(0.35, Math.min(4, (scaleStart * d) / pinchStart))
        opts().onChange()
      }
      return
    }

    const moved = Math.hypot(p.x - p.x0, p.y - p.y0)

    if (dragFlagging) {
      const cell = cellOf(e)
      const b = game().board
      if (cell >= 0 && b && b.state[cell] === HIDDEN && !flaggedThisDrag.has(cell)) {
        flaggedThisDrag.add(cell)
        doFlag(cell)
      }
      return
    }

    if (moved > SLOP) {
      clearLong()
      if (!longFired) {
        panning = true
        renderer.vp.ox += e.movementX || 0
        renderer.vp.oy += e.movementY || 0
        opts().onChange()
      }
    }
  }

  const onUp = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    clearLong()

    if (pinching) {
      if (pointers.size === 0) {
        // Both fingers lifted without moving: treat as a two-finger chord.
        const quick = p && performance.now() - p.t < 250 && Math.hypot(p.x - p.x0, p.y - p.y0) < SLOP
        if (quick && p && p.cell >= 0 && isNumber(p.cell)) doChord(p.cell)
        pinching = false
      }
      return
    }

    if (dragFlagging) { dragFlagging = false; flaggedThisDrag.clear(); return }
    if (longFired) { longFired = false; return }
    if (panning) { panning = false; return }
    if (!p) return
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > SLOP) return
    tap(p.cell)
  }

  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    clearLong()
    longFired = false
    panning = false
    pinching = false
    dragFlagging = false
  }

  const noMenu = (e: Event) => e.preventDefault()

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  canvas.addEventListener('contextmenu', noMenu)

  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onCancel)
    canvas.removeEventListener('contextmenu', noMenu)
    clearLong()
  }
}
