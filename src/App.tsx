import { useEffect, useState } from 'react'
import { PlayScreen } from './screens/PlayScreen.tsx'
import { LearnScreen } from './screens/LearnScreen.tsx'
import { PatternsScreen } from './screens/PatternsScreen.tsx'
import { MenuSheet } from './screens/MenuSheet.tsx'
import { useCoarsePointer, usePrefersDark, useSettings } from './settings.ts'
import { DARK, TOKENS } from './tokens.ts'

type Mode = 'play' | 'learn' | 'patterns'
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'play', label: 'Play' },
  { id: 'learn', label: 'Learn' },
  { id: 'patterns', label: 'Patterns' },
]

export function App() {
  const [settings, set] = useSettings()
  const prefersDark = usePrefersDark()
  const coarse = useCoarsePointer()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('play')

  const dark = settings.theme === 'system' ? prefersDark : settings.theme === 'dark'

  // On the root element, so the page background and the sheet scrim follow too.
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? DARK.surface : TOKENS.surface)
  }, [dark])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ZINITH</span>
        <div className="segmented" role="group" aria-label="Section">
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <button className="icon" onClick={() => setMenuOpen(true)} aria-label="Settings">☰</button>
      </header>

      <div className="screen">
        {mode === 'play' && <PlayScreen settings={settings} set={set} dark={dark} menuOpen={menuOpen} />}
        {mode === 'learn' && <LearnScreen settings={settings} set={set} dark={dark} />}
        {mode === 'patterns' && <PatternsScreen />}
      </div>

      {menuOpen && (
        <MenuSheet settings={settings} set={set} coarse={coarse} onClose={() => setMenuOpen(false)} />
      )}
    </div>
  )
}
