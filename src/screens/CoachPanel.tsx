import { useMemo } from 'react'
import type { CachedGrades, CoachClass } from '../../engine/coach/grade.ts'
import { describePattern } from '../../engine/coach/patterns.ts'
import type { Phase, Snapshot } from '../game/controller.ts'
import { PatternChips } from './PatternsScreen.tsx'

/** Class → how it reads to a player. Order matters: worst first in the list. */
const CLASS_LABEL: Record<CoachClass, string> = {
  error: 'Error',
  'unnecessary-guess': 'Unnecessary guess',
  suboptimal: 'Wasted click',
  'necessary-guess': 'Forced guess',
  optimal: 'Correct',
}

const MISTAKES: CoachClass[] = ['error', 'unnecessary-guess', 'suboptimal']

const secs = (ms: number) => (ms / 1000).toFixed(2)

export function CoachPanel({
  grades,
  snapshot,
  phase,
  pending,
  error,
  onClose,
  onNewGame,
}: {
  grades: CachedGrades | null
  snapshot: Snapshot | null
  phase: Phase
  pending: boolean
  error: string | null
  onClose: () => void
  onNewGame: () => void
}) {
  const mistakes = useMemo(
    () =>
      grades
        ? grades.grades
            .filter((g) => MISTAKES.includes(g.class))
            .sort((a, b) => MISTAKES.indexOf(a.class) - MISTAKES.indexOf(b.class) || a.moveIndex - b.moveIndex)
        : [],
    [grades],
  )

  const patternRows = useMemo(() => {
    if (!grades) return []
    return Object.entries(grades.patternStats)
      .map(([id, s]) => ({ id, ...s, missRate: s.opportunities > 0 ? s.misses / s.opportunities : 0 }))
      .sort((a, b) => b.missRate - a.missRate || b.opportunities - a.opportunities)
      .slice(0, 6)
  }, [grades])

  const worst = patternRows.find((p) => p.misses > 0) ?? null

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet coach" role="dialog" aria-modal="true" aria-label="Game analysis">
        <div className="sheet-head">
          <h2>
            <span className={phase === 'won' ? 'tag win' : 'tag loss'}>{phase === 'won' ? 'Cleared' : 'Lost'}</span>
            {snapshot && <span className="mono dim"> {secs(snapshot.elapsedMs)}s</span>}
          </h2>
          <button className="icon" onClick={onClose} aria-label="Close analysis">✕</button>
        </div>

        {pending && <p className="dim">Grading every move…</p>}
        {error && <p style={{ color: 'var(--bad)' }}>Coach failed: {error}</p>}

        {grades && (
          <>
            <div className="statrow">
              <Stat label="Accuracy" value={`${Math.round(grades.summary.accuracy * 100)}%`} tone={toneFor(grades.summary.accuracy)} />
              <Stat label="Clicks lost" value={String(grades.summary.clicksLost)} tone={grades.summary.clicksLost > 0 ? 'bad' : 'good'} />
              <Stat label="Hesitation" value={`${secs(grades.summary.hesitationMs)}s`} />
              {snapshot && <Stat label="3BV/s" value={snapshot.bvs.toFixed(2)} />}
            </div>

            {worst && (
              <div className="group">
                <span className="label">Work on this</span>
                <div className="card">
                  <div className="row">
                    <span className="rowtext">
                      <span className="rowtitle">
                        <PatternChips id={worst.id} />
                        <span style={{ marginLeft: 8 }}>{describePattern(worst.id).label}</span>
                      </span>
                      <br />
                      <span className="rowsub">{describePattern(worst.id).blurb}</span>
                    </span>
                    <span className="mono" style={{ color: 'var(--bad)' }}>
                      {worst.misses}/{worst.opportunities}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="group">
              <span className="label">
                {mistakes.length === 0 ? 'No mistakes' : `${mistakes.length} mistake${mistakes.length === 1 ? '' : 's'}`}
              </span>
              <div className="card">
                {mistakes.length === 0 ? (
                  <div className="row">
                    <span className="rowtext">
                      <span className="rowtitle">Every move was provable or forced.</span>
                      <br />
                      <span className="rowsub">Nothing here was luck.</span>
                    </span>
                  </div>
                ) : (
                  mistakes.slice(0, 12).map((g) => (
                    <div className="row" key={g.moveIndex}>
                      <span className="rowtext">
                        <span className="rowtitle">
                          <span className={`dot ${g.class === 'error' ? 'bad' : g.class === 'unnecessary-guess' ? 'bad' : 'info'}`} />
                          {CLASS_LABEL[g.class]}
                          <span className="dim mono"> move {g.moveIndex + 1}</span>
                        </span>
                        {g.patternId && (
                          <>
                            <br />
                            <span className="rowsub">
                              <PatternChips id={g.patternId} />
                              <span style={{ marginLeft: 6 }}>{describePattern(g.patternId).label} was available</span>
                            </span>
                          </>
                        )}
                      </span>
                      <span className="mono dim">{secs(g.costMs)}s</span>
                    </div>
                  ))
                )}
              </div>
              {mistakes.length > 12 && (
                <span className="rowsub">…and {mistakes.length - 12} more.</span>
              )}
            </div>

            {patternRows.length > 0 && (
              <div className="group">
                <span className="label">Patterns this game</span>
                <div className="card">
                  {patternRows.map((p) => (
                    <div className="row" key={p.id}>
                      <span className="rowtext">
                        <span className="rowtitle">
                          <PatternChips id={p.id} />
                          <span style={{ marginLeft: 8 }}>{describePattern(p.id).label}</span>
                        </span>
                        <br />
                        <span className="rowsub">
                          tier {describePattern(p.id).tier} · {p.opportunities} chance{p.opportunities === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="mono" style={{ color: p.misses > 0 ? 'var(--bad)' : 'var(--good)' }}>
                        {p.misses === 0 ? '100%' : `${Math.round((1 - p.missRate) * 100)}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <button className="primary wide" onClick={onNewGame}>New game</button>
      </div>
    </div>
  )
}

function toneFor(accuracy: number): 'good' | 'bad' | undefined {
  if (accuracy >= 0.98) return 'good'
  if (accuracy < 0.9) return 'bad'
  return undefined
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className={`value display${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  )
}
