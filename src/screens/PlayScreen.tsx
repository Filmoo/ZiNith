import { useEffect, useRef, useState } from 'react'
import { Game, type GameConfig, type Phase, type Snapshot } from '../game/controller.ts'
import { BoardRenderer } from '../render/renderer.ts'
import { drawRibbon, gradeColor } from '../render/ribbon.ts'
import { gradeInWorker } from '../game/coachClient.ts'
import { saveGrades, saveReplay } from '../store/db.ts'
import { CoachPanel } from './CoachPanel.tsx'
import type { CachedGrades } from '../../engine/coach/grade.ts'
import { attachInput } from '../input/pointer.ts'
import { LIGHT_THEME, DARK_THEME, ATLAS_FONTS, type Theme } from '../render/atlas.ts'
import { PRESETS } from '../../engine/presets.ts'
import { tapLoss, setHaptics } from '../platform/haptics.ts'
import type { PresetChoice, Settings } from '../settings.ts'

const PRESET_ORDER: PresetChoice[] = ['beginner', 'intermediate', 'expert']
const PRESET_SHORT: Record<PresetChoice, string> = { beginner: 'BEG', intermediate: 'INT', expert: 'EXP' }

const secs = (ms: number) => (ms / 1000).toFixed(2)

export function PlayScreen({
  settings,
  set,
  dark,
  onOpenSettings,
  onOpenHistory,
  menuOpen,
}: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  dark: boolean
  onOpenSettings: () => void
  onOpenHistory: () => void
  menuOpen: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ribbonRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const rendererRef = useRef<BoardRenderer>(new BoardRenderer())
  const settingsRef = useRef(settings)
  /** Set by anything that invalidates the whole canvas; cleared by the frame loop. */
  const needsFullRef = useRef(true)

  // Live figures are written straight to the DOM by the frame loop; putting them
  // in React state would re-render the tree 60 times a second.
  const timeRef = useRef<HTMLSpanElement>(null)
  const bvsRef = useRef<HTMLSpanElement>(null)
  const ioeRef = useRef<HTMLSpanElement>(null)
  const minesRef = useRef<HTMLSpanElement>(null)
  const bvRef = useRef<HTMLSpanElement>(null)

  const [nonce, setNonce] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<Snapshot | null>(null)

  // §8.2 — the coach runs automatically on every completed game, in a worker.
  const [grades, setGrades] = useState<CachedGrades | null>(null)
  const [coachPending, setCoachPending] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState(false)
  /** The frame loop needs the grades to recolour the ribbon (§8.3). */
  const gradesRef = useRef<CachedGrades | null>(null)

  settingsRef.current = settings
  const theme: Theme = dark ? DARK_THEME : LIGHT_THEME

  useEffect(() => { setHaptics(settings.haptics) }, [settings.haptics])

  const newGame = () => {
    // §4.5 — a result is recorded whether won or lost, so abandoning is logged
    // rather than silently discarded. The write has to happen here rather than
    // in the phase watcher: `abandon()` is immediately followed by a new `Game`,
    // and the frame loop is not guaranteed to observe the transition first.
    const prev = gameRef.current
    prev?.abandon()
    if (prev?.replay && prev.replay.events.length > 0) void saveReplay(prev.replay)
    setCoachOpen(false)
    setGrades(null)
    gradesRef.current = null
    setCoachError(null)
    setNonce((n) => n + 1)
  }

  // A new game whenever the preset, ruleset or nonce changes.
  useEffect(() => {
    const p = PRESETS[settings.preset]
    const cfg: GameConfig = {
      preset: settings.preset, width: p.width, height: p.height, mines: p.mines,
      noGuess: settings.noGuess, scheme: settings.scheme, chordSafety: settings.chordSafety,
    }
    gameRef.current = new Game(cfg)
    setPhase('idle')
    setResult(null)
    const r = rendererRef.current
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (wrap && canvas) {
      r.attach(canvas, theme)
      r.resize(wrap.clientWidth, wrap.clientHeight)
      r.fit(p, wrap.clientWidth, wrap.clientHeight)
      needsFullRef.current = true
    }
  }, [settings.preset, settings.noGuess, settings.scheme, settings.chordSafety, nonce, theme])

  useEffect(() => {
    rendererRef.current.setTheme(theme)
    needsFullRef.current = true
  }, [theme])

  /**
   * The atlas bakes glyphs into a bitmap and caches it, so if it is built before
   * the webfont arrives the digits stay in the fallback face forever. Load the
   * exact faces the atlas draws with, then invalidate.
   */
  useEffect(() => {
    let alive = true
    const fonts = document.fonts
    if (!fonts) return
    Promise.all(ATLAS_FONTS.map((f) => fonts.load(f).catch(() => undefined))).then(() => {
      if (!alive) return
      rendererRef.current.invalidateAtlas()
      needsFullRef.current = true
    })
    return () => { alive = false }
  }, [])

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
      mouseLeftChord: settingsRef.current.mouseLeftChord,
      onChange: () => { /* the frame loop picks it up */ },
    }))

    let raf = 0
    let lastPhase: Phase = 'idle'
    const frame = () => {
      const g = gameRef.current
      if (g) {
        if (g.board) {
          if (needsFullRef.current) { r.drawAll(g.board); needsFullRef.current = false; g.dirty.clear() }
          else if (g.dirty.size) { r.drawDirty(g.board, g.dirty); g.dirty.clear() }
        } else if (needsFullRef.current) {
          r.drawIdle(g.cfg); needsFullRef.current = false
        }

        const s = g.snapshot()
        if (timeRef.current) timeRef.current.textContent = secs(s.elapsedMs)
        if (minesRef.current) minesRef.current.textContent = String(s.minesLeft)
        if (bvRef.current) bvRef.current.textContent = s.threeBV > 0 ? `${s.threeBVDone}/${s.threeBV}` : '—'
        if (bvsRef.current) bvsRef.current.textContent = s.elapsedMs > 0 ? s.bvs.toFixed(2) : '—'
        if (ioeRef.current) ioeRef.current.textContent = s.clicks > 0 ? `${Math.round(s.efficiency * 100)}%` : '—'
        if (ribbonRef.current) {
          const cg = gradesRef.current
          drawRibbon(ribbonRef.current, g.ticks, theme, cg ? (i) => gradeColor(cg, i, theme) : undefined)
        }

        if (g.phase !== lastPhase) {
          lastPhase = g.phase
          setPhase(g.phase)
          if (g.phase === 'won' || g.phase === 'lost') {
            setResult(g.snapshot())
            const replay = g.replay
            if (replay) {
              // Written before grading so the game appears in history at once,
              // rather than only when the worker comes back (§14.3).
              void saveReplay(replay)
              setCoachPending(true)
              setCoachError(null)
              setCoachOpen(true)
              gradeInWorker(replay).then(
                (cg) => {
                  setGrades(cg); gradesRef.current = cg; setCoachPending(false)
                  void saveGrades(cg)
                },
                (err: Error) => { setCoachError(err.message); setCoachPending(false) },
              )
            }
          }
          if (g.phase === 'lost') tapLoss()
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => { cancelAnimationFrame(raf); ro.disconnect(); detach() }
  }, [theme])

  // N restarts. Skipped while a sheet is open so it cannot fire behind it.
  useEffect(() => {
    if (menuOpen || coachOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      if (e.key === 'n' || e.key === 'N' || e.key === 'F2') { e.preventDefault(); newGame() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, coachOpen])

  const p = PRESETS[settings.preset]

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ZINITH</span>
        <div className="segmented" role="group" aria-label="Preset">
          {PRESET_ORDER.map((id) => (
            <button
              key={id}
              aria-pressed={settings.preset === id}
              onClick={() => set('preset', id)}
              title={`${PRESETS[id].label} — ${PRESETS[id].width}×${PRESETS[id].height}, ${PRESETS[id].mines} mines`}
            >
              {PRESET_SHORT[id]}
            </button>
          ))}
        </div>
        <button className="icon" onClick={onOpenHistory} aria-label="History" title="History">◷</button>
        <button className="icon" onClick={onOpenSettings} aria-label="Settings">☰</button>
      </header>

      <section className="metrics" aria-label="Game metrics">
        <div className="metric metric--primary">
          <span className="label">Time</span>
          <span className="value display" ref={timeRef}>0.00</span>
        </div>
        <div className="metric">
          <span className="label">3BV/s</span>
          <span className="value mono" ref={bvsRef}>—</span>
        </div>
        <div className="metric">
          <span className="label">IOE</span>
          <span className="value mono" ref={ioeRef}>—</span>
        </div>
        <div className="metric">
          <span className="label">Mines</span>
          <span className="value mono" ref={minesRef}>{p.mines}</span>
        </div>
        <div className="metric">
          <span className="label">3BV</span>
          <span className="value mono" ref={bvRef}>—</span>
        </div>
      </section>

      <main className="board-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="board" />
        {(phase === 'won' || phase === 'lost') && result && !coachOpen && (
          <button
            className={`verdict ${phase === 'won' ? 'win' : 'loss'}`}
            onClick={() => setCoachOpen(true)}
            title="Show analysis"
          >
            <span className="tag">{phase === 'won' ? 'Cleared' : 'Boom'}</span>
            <span className="mono">{secs(result.elapsedMs)}s</span>
            {phase === 'won'
              ? <span className="mono dim">{result.bvs.toFixed(2)} 3BV/s</span>
              : <span className="mono dim">{result.threeBVDone}/{result.threeBV} 3BV</span>}
            <span className="dim">Analysis →</span>
          </button>
        )}
      </main>

      <canvas ref={ribbonRef} className="ribbon" aria-label="Solve ribbon" />

      <footer className="foot">
        <button className="primary" onClick={newGame}>New game</button>
        <span className="hint mono dim">
          {phase === 'idle'
            ? `${p.width}×${p.height} · ${p.mines} mines${settings.noGuess ? ' · no-guess' : ''}`
            : `${PRESETS[settings.preset].label}${settings.noGuess ? ' · no-guess' : ' · guess'}`}
        </span>
      </footer>

      {coachOpen && (
        <CoachPanel
          grades={grades}
          snapshot={result}
          phase={phase}
          pending={coachPending}
          error={coachError}
          onClose={() => setCoachOpen(false)}
          onNewGame={newGame}
        />
      )}
    </div>
  )
}
