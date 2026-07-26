import { useMemo, useState } from 'react'
import { PATTERNS, teachingOrder, type Pattern, type Tier } from '../../engine/coach/patterns.ts'
import { MEASURED_FREQUENCY, MEASURED_DEPTH, MEASURED_SAMPLE } from '../../engine/coach/measuredFrequency.ts'

const TIER_LABEL: Record<Tier, string> = {
  1: 'Tier 1 — single number',
  2: 'Tier 2 — two numbers',
  3: 'Tier 3 — chains',
  4: 'Tier 4 — enumeration',
}

/**
 * §10 — the pattern library, browsable at any time (§10.2). Order is the same
 * `teachingOrder` the curriculum uses, seeded with the real §10.1.2
 * measurement rather than a second, invented ranking — this list and "next in
 * course" must never disagree about what comes first.
 */
export function PatternsScreen() {
  const [openId, setOpenId] = useState<string | null>(null)

  const ordered = useMemo(() => teachingOrder(PATTERNS, MEASURED_FREQUENCY, MEASURED_DEPTH), [])
  const byTier = useMemo(() => {
    const m = new Map<Tier, Pattern[]>()
    for (const p of ordered) {
      const list = m.get(p.tier) ?? []
      list.push(p)
      m.set(p.tier, list)
    }
    return m
  }, [ordered])

  return (
    <div className="screen-scroll">
      <div className="library-head">
        <h1 className="display">Patterns</h1>
        <p className="dim">
          Order is derived, not decided: tier, then how often it actually fired over{' '}
          {MEASURED_SAMPLE.boards} generated expert boards, then how many numbers the proof needs.
        </p>
      </div>

      {([1, 2, 3, 4] as Tier[]).map((tier) => {
        const list = byTier.get(tier)
        if (!list || list.length === 0) return null
        return (
          <div className="group" key={tier}>
            <span className="label">{TIER_LABEL[tier]}</span>
            <div className="card">
              {list.map((p) => {
                const freq = MEASURED_FREQUENCY.get(p.id)
                const open = openId === p.id
                return (
                  <button
                    key={p.id}
                    className="row pattern-row"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : p.id)}
                  >
                    <span className="rowtext">
                      <span className="rowtitle">
                        <PatternChips id={p.id} />
                        <span style={{ marginLeft: 8 }}>{p.label}</span>
                      </span>
                      {open && (
                        <>
                          <br />
                          <span className="rowsub">{p.blurb}</span>
                          {p.requires.length > 0 && (
                            <>
                              <br />
                              <span className="rowsub dim">needs: {p.requires.join(', ')}</span>
                            </>
                          )}
                        </>
                      )}
                    </span>
                    <span className="mono dim" style={{ fontSize: 12 }}>
                      {freq ? `${((freq / MEASURED_SAMPLE.firings) * 100).toFixed(2)}%` : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Renders a pattern id as coloured digit chips using the canonical number
 * palette — the id already *is* the effective-count signature, so this reads
 * the proof directly rather than re-describing it in prose.
 */
export function PatternChips({ id }: { id: string }) {
  const parts = id.split('-')
  const numeric = parts.every((p) => /^\d+$/.test(p))
  if (!numeric) {
    return <span className="chip chip-word">{id.replace(/-/g, ' ')}</span>
  }
  return (
    <span className="chips">
      {parts.map((n, i) => (
        <span key={i} className={`chip chip-num n${n}`}>{n}</span>
      ))}
    </span>
  )
}
