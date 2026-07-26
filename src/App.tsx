import { useEffect, useState } from 'react'
import { PlayScreen } from './screens/PlayScreen.tsx'
import { MenuSheet } from './screens/MenuSheet.tsx'
import { useCoarsePointer, usePrefersDark, useSettings } from './settings.ts'
import { DARK, TOKENS } from './tokens.ts'

export function App() {
  const [settings, set] = useSettings()
  const prefersDark = usePrefersDark()
  const coarse = useCoarsePointer()
  const [menuOpen, setMenuOpen] = useState(false)

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
      <PlayScreen
        settings={settings}
        set={set}
        dark={dark}
        menuOpen={menuOpen}
        onOpenSettings={() => setMenuOpen(true)}
      />
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
