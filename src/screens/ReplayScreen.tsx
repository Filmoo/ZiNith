import { useEffect, useMemo, useRef, useState } from 'react'
import { COACH_VERSION, type CachedGrades } from '../../engine/coach/grade.ts'
import { describePattern } from '../../engine/coach/patterns.ts'
import { MISTAKE_CLASSES, type GameRecord } from '../../engine/record.ts'
import { rankMistakes, tally } from '../../engine/coach/severity.ts'
import { stateAfter } from '../../engine/seek.ts'
import { ticksOf } from '../game/controller.ts'
import { gradeInWorker } from '../game/coachClient.ts'
import { getGrades, replayOf, saveGrades } from '../store/db.ts'
import { DARK_THEME, LIGHT_THEME, type Theme } from '../render/atlas.ts'
import { BoardRenderer } from '../render/renderer.ts'
import { drawRibbon, gradeColor } from '../render/ribbon.ts'

const secs = (ms: number) => (ms / 1000).toFixed(2)
const pct = (x: number | undefined) => (x === undefined ? '—' : `${Math.round(x * 100)}%`)

const CLASS_LABEL: Record<string, string> = {
  optimal: 'Optimal',
  suboptimal: 'Wasted click',
  'unnecessary-guess': 'Unnecessary guess',
  'necessary-guess': 'Forced guess',
  error: 'Error',
}

/**
 * §14.3 — the replay viewer. Scrubber, solve ribbon, coach overlays, and a jump
 * straight to the next mistake, which is the only control that matters when you
 * are reviewing forty games.
 *
 * `moveIndex` is the index of the move *about to be played*, so the board shows
 * the state that move was decided from — the same state the coach graded it
 * against. That alignment is what lets tick `i`, grade `i` and the overlay all
 * refer to one thing.
 */
export function ReplayScreen({
  record,
  dark,
  onClose,
}: {
  record: GameRecord
  dark: boolean
  onClose: () => void
}) {
  const replay = useMemo(() => replayOf(record), [record])
  const ticks = useMemo(() => ticksOf(replay), [replay])
  const total = replay.events.length

  const [moveIndex, setMoveIndex] = useState(0)
  const [listOpen, setListOpen] = useState(false)
  const [grades, setGrades] = useState<CachedGrades | null>(null)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ribbonRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<BoardRenderer>(new BoardRenderer())

  const theme: Theme = dark ? DARK_THEME : LIGHT_THEME
  const board = useMemo(() => stateAfter(replay, moveIndex), [replay, moveIndex])

  // §8.4 — grades are cached, and recomputed lazily when the solver has moved on.
  useEffect(() => {
    let alive = true
    setPending(true)
    setError(null)
    getGrades(record.id)
      .then((cached) => {
        if (!alive) return
        if (cached && cached.v === COACH_VERSION) {
          setGrades(cached)
          setPending(false)
          return
        }
        return gradeInWorker(replay).then((fresh) => {
          if (!alive) return
          setGrades(fresh)
          setPending(false)
          void saveGrades(fresh)
        })
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setPending(false)
      })
    return () => { alive = false }
  }, [record.id, replay])

  const grade = grades?.grades[moveIndex]

  /**
   * Fit and repaint the current position. Held in a ref because the resize
   * observer is installed once per theme but has to draw whatever is on screen
   * *now* — closing over the board of the render that installed it would repaint
   * a stale position on every resize.
   */
  const paint = () => {
    const wrap = wrapRef.current
    if (!wrap) return
    const r = rendererRef.current
    r.fit(board, wrap.clientWidth, wrap.clientHeight)
    r.drawAll(board)
    const d = grade?.deduction
    if (d) r.overlay(board, d.witnesses, d.subject)
  }
  const paintRef = useRef(paint)
  paintRef.current = paint

  // Renderer lifecycle. Redraws on every seek, which is cheap: the board is a
  // handful of typed arrays and a seek re-simulates in microseconds.
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    const r = rendererRef.current
    r.attach(canvas, theme)
    const onResize = () => {
      r.resize(wrap.clientWidth, wrap.clientHeight)
      paintRef.current()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)
    onResize()
    return () => ro.disconnect()
  }, [theme])

  useEffect(() => {
    paintRef.current()
    if (ribbonRef.current) {
      drawRibbon(ribbonRef.current, ticks, theme, grades ? (i) => gradeColor(grades, i, theme) : undefined)
    }
  }, [board, grades, theme, moveIndex, ticks])

  const nextMistake = () => {
    if (!grades) return
    for (let i = moveIndex + 1; i < grades.grades.length; i++) {
      if (MISTAKE_CLASSES.includes(grades.grades[i].class)) { setMoveIndex(i); return }
    }
    // Wrap, so hammering the button cycles rather than dead-ending.
    for (let i = 0; i <= moveIndex && i < grades.grades.length; i++) {
      if (MISTAKE_CLASSES.includes(grades.grades[i].class)) { setMoveIndex(i); return }
    }
  }

  // Worst first — reviewing is triage, so the list is ordered by what each
  // mistake cost rather than by when it happened.
  const ranked = useMemo(
    () => (grades ? rankMistakes(grades.grades, replay) : []),
    [grades, replay],
  )
  const counts = useMemo(() => tally(ranked), [ranked])
  const mistakeCount = counts.total

  /** Seek by clicking the ribbon: tick widths are time-proportional (§8.3). */
  const seekFromRibbon = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget
    const x = e.clientX - el.getBoundingClientRect().left
    const totalMs = ticks.reduce((a, t) => a + Math.max(t.durMs, 1), 0)
    if (totalMs <= 0) return
    let acc = 0
    for (let i = 0; i < ticks.length; i++) {
      acc += (Math.max(ticks[i].durMs, 1) / totalMs) * el.clientWidth
      if (x <= acc) { setMoveIndex(i); return }
    }
    setMoveIndex(Math.max(0, ticks.length - 1))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); setMoveIndex((i) => Math.min(total, i + 1)) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setMoveIndex((i) => Math.max(0, i - 1)) }
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total, onClose])

  const pattern = grade?.patternId ? describePattern(grade.patternId) : null

  return (
    <div className="screen replay">
      <header className="topbar">
        <button className="icon" onClick={onClose} aria-label="Back">←</button>
        <span className="brand">REPLAY</span>
        <span className="mono dim">{secs(record.durationMs)}s</span>
      </header>

      <section className="metrics" aria-label="Game summary">
        <div className="metric metric--primary">
          <span className="label">Move</span>
          <span className="value display mono">{moveIndex}<span className="dim">/{total}</span></span>
        </div>
        <div className="metric">
          <span className="label">3BV/s</span>
          <span className="value mono">{record.bvs.toFixed(2)}</span>
        </div>
        <div className="metric">
          <span className="label">Accuracy</span>
          <span className="value mono">{pct(record.accuracy ?? grades?.summary.accuracy)}</span>
        </div>
        <div className="metric">
          <span className="label">Lost</span>
          <span className="value mono">{grades ? grades.summary.clicksLost : '—'}</span>
        </div>
        <div className="metric">
          <span className="label">Mistakes</span>
          <span className="value mono">{grades ? mistakeCount : '—'}</span>
        </div>
      </section>

      <main className="board-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="board" />
      </main>

      <canvas
        ref={ribbonRef}
        className="ribbon seekable"
        aria-label="Solve ribbon — click to seek"
        onClick={seekFromRibbon}
      />

      <div className="scrub">
        <input
          type="range"
          min={0}
          max={total}
          value={moveIndex}
          onChange={(e) => setMoveIndex(Number(e.target.value))}
          aria-label="Move"
        />
      </div>

      {listOpen && (
        <section className="mistakes" aria-label="Mistakes, worst first">
          {ranked.length === 0 && <p className="empty dim">No mistakes in this game.</p>}
          {ranked.map((m) => (
            <button
              key={m.grade.moveIndex}
              className={`mrow ${m.grade.moveIndex === moveIndex ? 'current' : ''}`}
              onClick={() => { setMoveIndex(m.grade.moveIndex); setListOpen(false) }}
            >
              <span className={`chip sev-${m.severity}`}>{m.severity}</span>
              <span className="mono dim">#{m.grade.moveIndex}</span>
              <span className="why">{m.reason}</span>
              {m.grade.patternId && <span className="chip ghost">{m.grade.patternId}</span>}
            </button>
          ))}
        </section>
      )}

      <section className="explain" aria-live="polite">
        {pending && <p className="dim">Grading…</p>}
        {error && <p className="dim">Coach unavailable: {error}</p>}
        {!pending && !error && grade && (
          <>
            <p className="verdict-line">
              <span className={`chip ${grade.class}`}>{CLASS_LABEL[grade.class] ?? grade.class}</span>
              {pattern && <span className="chip ghost">{pattern.label}</span>}
              {grade.costMs > 0 && <span className="mono dim">{secs(grade.costMs)}s</span>}
            </p>
            {pattern && <p className="blurb">{pattern.blurb}</p>}
            {grade.betterMove !== undefined && (
              <p className="dim">
                A certainty was available — the highlighted cells prove it.
              </p>
            )}
          </>
        )}
        {!pending && !error && !grade && moveIndex >= total && (
          <p className="dim">End of game — {record.result}.</p>
        )}
      </section>

      <footer className="foot">
        <button className="ghost" onClick={() => setMoveIndex((i) => Math.max(0, i - 1))} disabled={moveIndex === 0}>
          ←
        </button>
        <button className="ghost" onClick={() => setMoveIndex((i) => Math.min(total, i + 1))} disabled={moveIndex >= total}>
          →
        </button>
        <button className="primary" onClick={nextMistake} disabled={!grades || mistakeCount === 0}>
          Next mistake
        </button>
        <button
          className="ghost"
          aria-expanded={listOpen}
          onClick={() => setListOpen((v) => !v)}
          disabled={!grades || mistakeCount === 0}
        >
          {counts.critical > 0 && <span className="sev-dot critical" />}
          {counts.major > 0 && <span className="sev-dot major" />}
          Worst first · {mistakeCount}
        </button>
      </footer>
    </div>
  )
}
