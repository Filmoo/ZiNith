import { PRESETS } from '../engine/presets'

/**
 * Placeholder shell. The home screen (§14.1 — personal bests, trend line, new
 * game / history entry points) lands with P4; until then this only proves the
 * bundle boots and the engine's preset table is reachable from the UI layer.
 */
export function App() {
  return (
    <main className="shell">
      <h1>Zinith</h1>
      <p className="muted">Engine under construction — P1.</p>
      <ul className="presets">
        {Object.values(PRESETS).map((p) => (
          <li key={p.id}>
            <span>{p.label}</span>
            <span className="tabular">
              {p.width}×{p.height} · {p.mines} mines · {(p.density * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </main>
  )
}
