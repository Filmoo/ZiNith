import { useEffect, useRef } from 'react'
import type { Scheme } from '../game/controller.ts'
import type { Settings, ThemeChoice } from '../settings.ts'

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  )
}

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="rowtext">
        <span className="rowtitle">{title}</span>
        {sub && <><br /><span className="rowsub">{sub}</span></>}
      </span>
      {children}
    </div>
  )
}

const SCHEME_LABELS: Record<Scheme, string> = {
  standard: 'Tap opens · hold flags',
  'flag-first': 'Tap flags · hold opens',
  'no-flag': 'No flags (NF style)',
  'drag-flag': 'Hold then drag to flag',
}

export function MenuSheet({
  settings,
  set,
  onClose,
  coarse,
}: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  onClose: () => void
  coarse: boolean
}) {
  const doneRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    doneRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="icon" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="group">
          <span className="label">Board</span>
          <div className="card">
            <Row title="No-guess boards" sub="Solvable without guessing. Off writes to a separate PB pool.">
              <Switch on={settings.noGuess} onChange={(v) => set('noGuess', v)} label="No-guess boards" />
            </Row>
            <Row title="Chord safety" sub="A wrong chord flashes instead of detonating.">
              <Switch on={settings.chordSafety} onChange={(v) => set('chordSafety', v)} label="Chord safety" />
            </Row>
          </div>
        </div>

        <div className="group">
          <span className="label">Learning mode</span>
          <div className="card">
            <Row title="Show hints" sub="Off still blocks wrong and wasteful moves — recognition practice.">
              <Switch on={settings.showHints} onChange={(v) => set('showHints', v)} label="Show hints" />
            </Row>
          </div>
        </div>

        <div className="group">
          <span className="label">{coarse ? 'Touch controls' : 'Mouse controls'}</span>
          <div className="card keys">
            {coarse ? (
              <>
                <Row title="Scheme">
                  <select
                    value={settings.scheme}
                    onChange={(e) => set('scheme', e.target.value as Scheme)}
                    aria-label="Touch control scheme"
                  >
                    {(Object.keys(SCHEME_LABELS) as Scheme[]).map((s) => (
                      <option key={s} value={s}>{SCHEME_LABELS[s]}</option>
                    ))}
                  </select>
                </Row>
                <Row title="Hold to flag" sub={`${settings.longPressMs}ms`}>
                  <input
                    type="range" min={120} max={400} step={10}
                    value={settings.longPressMs}
                    aria-label="Long press duration"
                    onChange={(e) => set('longPressMs', Number(e.target.value))}
                  />
                </Row>
                <Row title="Two-finger tap"><kbd>chord</kbd></Row>
                <Row title="Pinch"><kbd>zoom</kbd></Row>
              </>
            ) : (
              <>
                <Row title="Open a cell"><kbd>Left click</kbd></Row>
                <Row title="Place a flag"><kbd>Right click</kbd></Row>
                <Row title="Chord"><kbd>Middle click</kbd></Row>
                <Row title="Chord (alternate)"><kbd>Left + Right</kbd></Row>
                <Row title="Left click chords" sub="Clicking a satisfied number opens its neighbours.">
                  <Switch on={settings.mouseLeftChord} onChange={(v) => set('mouseLeftChord', v)} label="Left click chords" />
                </Row>
                <Row title="New game"><kbd>N</kbd></Row>
              </>
            )}
          </div>
        </div>

        {/* The other input language is still reachable — hybrid devices have both. */}
        {!coarse && (
          <div className="group">
            <span className="label">Touch</span>
            <div className="card">
              <Row title="Scheme" sub="Used when you play by touch.">
                <select
                  value={settings.scheme}
                  onChange={(e) => set('scheme', e.target.value as Scheme)}
                  aria-label="Touch control scheme"
                >
                  {(Object.keys(SCHEME_LABELS) as Scheme[]).map((s) => (
                    <option key={s} value={s}>{SCHEME_LABELS[s]}</option>
                  ))}
                </select>
              </Row>
            </div>
          </div>
        )}

        <div className="group">
          <span className="label">Appearance</span>
          <div className="card">
            <Row title="Theme">
              <select
                value={settings.theme}
                onChange={(e) => set('theme', e.target.value as ThemeChoice)}
                aria-label="Theme"
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Row>
            <Row title="Haptics" sub="Flag and chord only. Needs a device that vibrates.">
              <Switch on={settings.haptics} onChange={(v) => set('haptics', v)} label="Haptics" />
            </Row>
          </div>
        </div>

        <button className="primary wide" ref={doneRef} onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
