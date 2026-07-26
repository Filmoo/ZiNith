import { useEffect, useState } from 'react'
import { PlayScreen } from './screens/PlayScreen.tsx'
import { HistoryScreen } from './screens/HistoryScreen.tsx'
import { ReplayScreen } from './screens/ReplayScreen.tsx'
import { MenuSheet } from './screens/MenuSheet.tsx'
import { useCoarsePointer, usePrefersDark, useSettings } from './settings.ts'
import { DARK, TOKENS } from './tokens.ts'
import type { GameRecord } from '../engine/record.ts'

type View = { name: 'play' } | { name: 'history' } | { name: 'replay'; record: GameRecord }

export function App() {
  const [settings, set] = useSettings()
  const prefersDark = usePrefersDark()
  const coarse = useCoarsePointer()
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState<View>({ name: 'play' })

  const dark = settings.theme === 'system' ? prefersDark : settings.theme === 'dark'

  // On the root element, so the page background and the sheet scrim follow too.
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? DARK.surface : TOKENS.surface)
  }, [dark])

  return (
    <>
      {/*
        PlayScreen stays mounted behind the other views rather than unmounting:
        it owns the canvas, the renderer and the running game, and tearing that
        down to look at history would end the game you are in the middle of.
      */}
      <div hidden={view.name !== 'play'}>
        <PlayScreen
          settings={settings}
          set={set}
          dark={dark}
          menuOpen={menuOpen || view.name !== 'play'}
          onOpenSettings={() => setMenuOpen(true)}
          onOpenHistory={() => setView({ name: 'history' })}
        />
      </div>

      {view.name === 'history' && (
        <HistoryScreen
          onClose={() => setView({ name: 'play' })}
          onOpenReplay={(record) => setView({ name: 'replay', record })}
        />
      )}

      {view.name === 'replay' && (
        <ReplayScreen
          record={view.record}
          dark={dark}
          onClose={() => setView({ name: 'history' })}
        />
      )}

      {menuOpen && (
        <MenuSheet
          settings={settings}
          set={set}
          coarse={coarse}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  )
}
