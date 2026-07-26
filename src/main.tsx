import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

// Self-hosted, not CDN: the Android build has no network.
import './fonts.css'
import './styles.css'

const el = document.getElementById('root')
if (el) createRoot(el).render(<App />)
