import { useState } from 'react'
import { PlayScreen, type Settings } from './screens/PlayScreen.tsx'
import type { Scheme } from './game/controller.ts'

const DEFAULTS: Settings = {
  preset: 'expert',
  scheme: 'standard',
  longPressMs: 180, // §13.1 — provisional, needs device tuning
  noGuess: true,
  chordSafety: false,
  dark: false,
}

const SCHEMES: Scheme[] = ['standard', 'flag-first', 'no-flag', 'drag-flag']

export function App() {
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [open, setOpen] = useState(false)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }))

  return (
    <>
      <PlayScreen settings={s} onOpenSettings={() => setOpen(true)} />
      {open && (
        <div className="sheet" role="dialog" aria-label="Settings">
          <div className="sheet-inner">
            <h2>Settings</h2>

            <label className="row">
              <span>Preset</span>
              <select value={s.preset} onChange={(e) => set('preset', e.target.value as Settings['preset'])}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="expert">Expert</option>
              </select>
            </label>

            <label className="row">
              <span>Control scheme</span>
              <select value={s.scheme} onChange={(e) => set('scheme', e.target.value as Scheme)}>
                {SCHEMES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>

            <label className="row">
              <span>Long press <b className="mono">{s.longPressMs}ms</b></span>
              <input type="range" min={120} max={400} step={10} value={s.longPressMs}
                onChange={(e) => set('longPressMs', Number(e.target.value))} />
            </label>

            <label className="row">
              <span>No-guess boards</span>
              <input type="checkbox" checked={s.noGuess} onChange={(e) => set('noGuess', e.target.checked)} />
            </label>

            <label className="row">
              <span>Chord safety</span>
              <input type="checkbox" checked={s.chordSafety} onChange={(e) => set('chordSafety', e.target.checked)} />
            </label>

            <label className="row">
              <span>Dark theme</span>
              <input type="checkbox" checked={s.dark} onChange={(e) => set('dark', e.target.checked)} />
            </label>

            <button className="primary wide" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </>
  )
}
