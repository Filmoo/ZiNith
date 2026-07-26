import { useEffect, useRef, useState } from 'react'
import { Game, type GameConfig, type Scheme } from '../game/controller.ts'
import { BoardRenderer } from '../render/renderer.ts'
import { drawRibbon } from '../render/ribbon.ts'
import { attachInput } from '../input/pointer.ts'
import { LIGHT_THEME, DARK_THEME, type Theme } from '../render/atlas.ts'
import { PRESETS } from '../../engine/presets.ts'
import { tapLoss } from '../platform/haptics.ts'
import type { PresetId } from '../../engine/replay.ts'

export interface Settings {
  preset: Exclude<PresetId, 'custom'>
  scheme: Scheme
  longPressMs: number
  noGuess: boolean
  chordSafety: boolean
  dark: boolean
}

const fmt = (ms: number) => (ms / 1000).toFixed(2)

export function PlayScreen({ settings, onOpenSettings }: { settings: Settings; onOpenSettings: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ribbonRef = useRef<HTMLCanvasElement>(null)
  const timerRef = useRef<HTMLSpanElement>(null)
  const minesRef = useRef<HTMLSpanElement>(null)
  const gameRef = useRef<Game | null>(null)
  const rendererRef = useRef<BoardRenderer>(new BoardRenderer())
  const settingsRef = useRef(settings)
  /** Set by anything that invalidates the whole canvas; cleared by the frame loop. */
  const needsFullRef = useRef(true)
  const [nonce, setNonce] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'playing' | 'won' | 'lost'>('idle')

  settingsRef.current = settings
  const theme: Theme = settings.dark ? DARK_THEME : LIGHT_THEME

  // A new game whenever the preset, ruleset or nonce changes.
  useEffect(() => {
    const p = PRESETS[settings.preset]
    const cfg: GameConfig = {
      preset: settings.preset, width: p.width, height: p.height, mines: p.mines,
      noGuess: settings.noGuess, scheme: settings.scheme, chordSafety: settings.chordSafety,
    }
    gameRef.current = new Game(cfg)
    setPhase('idle')
    const r = rendererRef.current
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (wrap && canvas) {
      r.attach(canvas, theme)
      r.resize(wrap.clientWidth, wrap.clientHeight)
      r.fit(p, wrap.clientWidth, wrap.clientHeight)
      needsFullRef.current = true
    }
  }, [settings.preset, settings.noGuess, settings.scheme, settings.chordSafety, nonce, theme])

  useEffect(() => { rendererRef.current.setTheme(theme) }, [theme])

  // Renderer, input and the frame loop.
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    const r = rendererRef.current
    r.attach(canvas, theme)

    const onResize = () => {
      const g = gameRef.current
      r.resize(wrap.clientWidth, wrap.clientHeight)
      const dims = g?.board ?? PRESETS[settingsRef.current.preset]
      r.fit(dims, wrap.clientWidth, wrap.clientHeight)
      needsFullRef.current = true
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)
    onResize()

    const detach = attachInput(canvas, () => gameRef.current!, r, () => ({
      scheme: settingsRef.current.scheme,
      longPressMs: settingsRef.current.longPressMs,
      onChange: () => { /* the frame loop picks it up */ },
    }))

    let raf = 0
    let lastPhase: string = 'idle'
    const frame = () => {
      const g = gameRef.current
      if (g) {
        if (g.board) {
          if (needsFullRef.current) { r.drawAll(g.board); needsFullRef.current = false; g.dirty.clear() }
          else if (g.dirty.size) { r.drawDirty(g.board, g.dirty); g.dirty.clear() }
        } else if (needsFullRef.current) {
          r.drawIdle(g.cfg); needsFullRef.current = false
        }
        if (timerRef.current) timerRef.current.textContent = fmt(g.elapsedMs())
        if (minesRef.current) minesRef.current.textContent = String(g.snapshot().minesLeft)
        if (ribbonRef.current) drawRibbon(ribbonRef.current, g.ticks, theme)
        if (g.phase !== lastPhase) {
          lastPhase = g.phase
          setPhase(g.phase)
          if (g.phase === 'lost') tapLoss()
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => { cancelAnimationFrame(raf); ro.disconnect(); detach() }
  }, [theme])

  const g = gameRef.current
  const snap = g?.snapshot()

  return (
    <div className="play" data-theme={settings.dark ? 'dark' : 'light'}>
      <header className="hud">
        <div className="hud-metric">
          <span className="hud-label">TIME</span>
          <span className="hud-value display" ref={timerRef}>0.00</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">MINES</span>
          <span className="hud-value mono" ref={minesRef}>{PRESETS[settings.preset].mines}</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">3BV</span>
          <span className="hud-value mono">{snap?.threeBV ?? '—'}</span>
        </div>
        <button className="ghost" onClick={onOpenSettings} aria-label="Settings">···</button>
      </header>

      <div className="board-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="board" />
        {phase === 'won' && <div className="verdict win">Cleared · {fmt(snap?.elapsedMs ?? 0)}s · {(snap?.bvs ?? 0).toFixed(2)} 3BV/s</div>}
        {phase === 'lost' && <div className="verdict loss">Boom</div>}
      </div>

      <canvas ref={ribbonRef} className="ribbon" aria-label="Solve ribbon" />

      <footer className="foot">
        <button className="primary" onClick={() => setNonce((n) => n + 1)}>New game</button>
        <span className="mono dim">
          {snap && snap.clicks > 0 ? `${(snap.efficiency * 100).toFixed(0)}% IOE · ${snap.clicks} clicks` : 'tap to start'}
        </span>
      </footer>
    </div>
  )
}
