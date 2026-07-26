import { useEffect, useRef, useState } from 'react'
import type { GameConfig, Phase, Snapshot } from '../game/controller.ts'
import { LearningGame, type BlockReason, type Hint } from '../game/learningGame.ts'
import { BoardRenderer } from '../render/renderer.ts'
import { drawRibbon, gradeColor } from '../render/ribbon.ts'
import { gradeInWorker } from '../game/coachClient.ts'
import { CoachPanel } from './CoachPanel.tsx'
import { describePattern } from '../../engine/coach/patterns.ts'
import type { CachedGrades } from '../../engine/coach/grade.ts'
import { attachInput } from '../input/pointer.ts'
import { LIGHT_THEME, DARK_THEME, ATLAS_FONTS, type Theme } from '../render/atlas.ts'
import { PRESETS } from '../../engine/presets.ts'
import { setHaptics } from '../platform/haptics.ts'
import type { PresetChoice, Settings } from '../settings.ts'

const PRESET_ORDER: PresetChoice[] = ['beginner', 'intermediate', 'expert']
const PRESET_SHORT: Record<PresetChoice, string> = { beginner: 'BEG', intermediate: 'INT', expert: 'EXP' }
const secs = (ms: number) => (ms / 1000).toFixed(2)

const BLOCK_MESSAGE: Record<BlockReason, string> = {
  'guess-available': 'A certain move exists — find it first.',
  'known-mine': 'That cell is a proven mine. Flag it instead.',
}

/**
 * §7.3 / §P8. The same board, renderer and input as Play, but three rules
 * differ, all enforced by `LearningGame` rather than duplicated here: chord
 * safety is always on, non-optimal moves are rejected instead of applied, and
 * undo exists. Everything provable is shown, not just tested — that is what
 * separates this from a drill (§10.3), which is not built yet.
 */
export function LearnScreen({
  settings,
  set,
  dark,
}: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  dark: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ribbonRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<LearningGame | null>(null)
  const rendererRef = useRef<BoardRenderer>(new BoardRenderer())
  const settingsRef = useRef(settings)
  const needsFullRef = useRef(true)
  const hintRef = useRef<Hint | null>(null)

  const timeRef = useRef<HTMLSpanElement>(null)
  const bvsRef = useRef<HTMLSpanElement>(null)
  const ioeRef = useRef<HTMLSpanElement>(null)
  const minesRef = useRef<HTMLSpanElement>(null)
  const bvRef = useRef<HTMLSpanElement>(null)

  const [nonce, setNonce] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<Snapshot | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const [blocked, setBlocked] = useState<{ msg: string; n: number } | null>(null)

  const [grades, setGrades] = useState<CachedGrades | null>(null)
  const [coachPending, setCoachPending] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState(false)
  const gradesRef = useRef<CachedGrades | null>(null)

  settingsRef.current = settings
  const theme: Theme = dark ? DARK_THEME : LIGHT_THEME

  useEffect(() => { setHaptics(settings.haptics) }, [settings.haptics])

  const newGame = () => {
    gameRef.current?.abandon()
    setCoachOpen(false)
    setGrades(null)
    gradesRef.current = null
    setCoachError(null)
    setNonce((n) => n + 1)
  }

  useEffect(() => {
    const p = PRESETS[settings.preset]
    // §4.5 / §7.3 — learning mode's rules are fixed, not the play settings':
    // always no-guess (there must always be a real deduction to show) and
    // always chord-safe.
    const cfg: GameConfig = {
      preset: settings.preset, width: p.width, height: p.height, mines: p.mines,
      noGuess: true, scheme: settings.scheme, chordSafety: true,
    }
    const g = new LearningGame(cfg)
    g.onHint = (h) => { hintRef.current = h; setHint(h) }
    g.onBlocked = (_cell, reason) => setBlocked({ msg: BLOCK_MESSAGE[reason], n: Date.now() })
    gameRef.current = g
    hintRef.current = null
    setPhase('idle')
    setResult(null)
    setHint(null)
    const r = rendererRef.current
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (wrap && canvas) {
      r.attach(canvas, theme)
      r.resize(wrap.clientWidth, wrap.clientHeight)
      r.fit(p, wrap.clientWidth, wrap.clientHeight)
      needsFullRef.current = true
    }
  }, [settings.preset, settings.scheme, nonce, theme])

  useEffect(() => {
    rendererRef.current.setTheme(theme)
    needsFullRef.current = true
  }, [theme])

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

  useEffect(() => {
    if (!blocked) return
    const t = setTimeout(() => setBlocked(null), 1400)
    return () => clearTimeout(t)
  }, [blocked])

  /**
   * Restarts the shake by toggling the class imperatively rather than through
   * React's className/key: keying the wrap or the canvas to force a remount
   * would detach the canvas from the renderer, which holds a reference to the
   * specific DOM node it attached to.
   */
  useEffect(() => {
    if (!blocked) return
    const el = wrapRef.current
    if (!el) return
    el.classList.remove('shake')
    void el.offsetWidth // force a reflow so re-adding the class retriggers the animation
    el.classList.add('shake')
    const t = setTimeout(() => el.classList.remove('shake'), 400)
    return () => clearTimeout(t)
  }, [blocked])

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
      onChange: () => {},
    }))

    let raf = 0
    let lastPhase: Phase = 'idle'
    const frame = () => {
      const g = gameRef.current
      if (g) {
        if (g.board) {
          if (needsFullRef.current) { r.drawAll(g.board); needsFullRef.current = false; g.dirty.clear() }
          else if (g.dirty.size) { r.drawDirty(g.board, g.dirty); g.dirty.clear() }
          // Drawn every frame, not just on dirty cells, so a hint that changes
          // without the board changing (there is no such case today, but the
          // overlay must also survive whatever cells the dirty pass just blitted
          // over) is never one frame stale.
          const h = hintRef.current
          if (h?.best && g.phase === 'playing') {
            r.overlay(g.board, h.best.deduction.witnesses, h.best.deduction.subject, h.best.deduction.verdict)
          }
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
              setCoachPending(true)
              setCoachError(null)
              setCoachOpen(true)
              gradeInWorker(replay).then(
                (cg) => { setGrades(cg); gradesRef.current = cg; setCoachPending(false) },
                (err: Error) => { setCoachError(err.message); setCoachPending(false) },
              )
            }
          }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => { cancelAnimationFrame(raf); ro.disconnect(); detach() }
  }, [theme])

  const p = PRESETS[settings.preset]
  const canUndo = phase === 'playing' && (gameRef.current?.replay?.events.length ?? 0) > 1

  return (
    <>
      <div className="topbar subbar">
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
        <span className="dim mono" style={{ marginLeft: 'auto', fontSize: 12 }}>always no-guess · chord-safe</span>
      </div>

      <section className="metrics" aria-label="Game metrics">
        <div className="metric metric--primary">
          <span className="label">Time</span>
          <span className="value display" ref={timeRef}>0.00</span>
        </div>
        <div className="metric"><span className="label">3BV/s</span><span className="value mono" ref={bvsRef}>—</span></div>
        <div className="metric"><span className="label">IOE</span><span className="value mono" ref={ioeRef}>—</span></div>
        <div className="metric"><span className="label">Mines</span><span className="value mono" ref={minesRef}>{p.mines}</span></div>
        <div className="metric"><span className="label">3BV</span><span className="value mono" ref={bvRef}>—</span></div>
      </section>

      <main className="board-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="board" />

        {phase === 'idle' && (
          <div className="hint-card idle" role="status">
            <span className="rowtitle">Open a cell to begin.</span>
          </div>
        )}

        {phase === 'playing' && hint && (
          <div className="hint-card" role="status">
            {hint.best ? (
              <>
                <span className="rowtitle">
                  <span className={`dot ${hint.best.deduction.verdict === 'mine' ? 'bad' : 'good'}`} />
                  {describePattern(hint.best.id).label}
                  <span className="dim mono"> tier {describePattern(hint.best.id).tier} · depth {hint.best.depth}</span>
                </span>
                <span className="rowsub">{describePattern(hint.best.id).blurb}</span>
              </>
            ) : (
              <span className="rowtitle dim">No certain move here — this one is a genuine guess.</span>
            )}
          </div>
        )}

        {blocked && (
          <div className="verdict blocked" role="alert">
            <span className="tag">Blocked</span>
            <span>{blocked.msg}</span>
          </div>
        )}

        {(phase === 'won' || phase === 'lost') && result && !coachOpen && (
          <button
            className={`verdict ${phase === 'won' ? 'win' : 'loss'}`}
            onClick={() => setCoachOpen(true)}
            title="Show analysis"
          >
            <span className="tag">{phase === 'won' ? 'Cleared' : 'Boom'}</span>
            <span className="mono">{secs(result.elapsedMs)}s</span>
            <span className="dim">Analysis →</span>
          </button>
        )}
      </main>

      <canvas ref={ribbonRef} className="ribbon" aria-label="Solve ribbon" />

      <footer className="foot">
        <button className="primary" onClick={newGame}>New game</button>
        <button disabled={!canUndo} onClick={() => gameRef.current?.undo()}>Undo</button>
        <span className="hint mono dim">{PRESETS[settings.preset].label}</span>
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
    </>
  )
}
