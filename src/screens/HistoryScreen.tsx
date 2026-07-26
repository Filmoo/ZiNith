import { useEffect, useState } from 'react'
import { PRESETS } from '../../engine/presets.ts'
import {
  MISTAKE_CLASSES, STANDARD_POOL,
  type GameRecord, type HistoryFilter, type PoolId,
} from '../../engine/record.ts'
import type { CoachClass } from '../../engine/coach/grade.ts'
import type { PresetId, Result } from '../../engine/replay.ts'
import { countGames, listGames } from '../store/db.ts'

const PAGE = 50

const PRESET_SHORT: Record<string, string> = {
  beginner: 'BEG', intermediate: 'INT', expert: 'EXP', custom: 'CUS',
}

const MISTAKE_LABEL: Record<CoachClass, string> = {
  'unnecessary-guess': 'Unnecessary guess',
  error: 'Error',
  suboptimal: 'Wasted click',
  optimal: 'Optimal',
  'necessary-guess': 'Forced guess',
}

const secs = (ms: number) => (ms / 1000).toFixed(2)
const pct = (x: number | undefined) => (x === undefined ? '—' : `${Math.round(x * 100)}%`)

function when(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

/**
 * §14.2 — a marker for anything played outside the standard pool, so a fast time
 * on a guess board is never mistaken for a comparable one.
 */
function poolMark(pool: PoolId): string | null {
  if (pool === STANDARD_POOL) return null
  const [flags, guess] = pool.split('-')
  const bits: string[] = []
  if (flags === 'noflag') bits.push('no-flag')
  if (guess === 'guess') bits.push('guess')
  return bits.join(' · ')
}

export function HistoryScreen({
  onClose,
  onOpenReplay,
}: {
  onClose: () => void
  onOpenReplay: (rec: GameRecord) => void
}) {
  const [filter, setFilter] = useState<HistoryFilter>({})
  const [rows, setRows] = useState<GameRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setPage(0) }, [filter])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([listGames(filter, { limit: PAGE, offset: page * PAGE }), countGames(filter)]).then(
      ([r, n]) => {
        if (!alive) return
        setRows(r)
        setTotal(n)
        setLoading(false)
      },
      () => { if (alive) setLoading(false) },
    )
    return () => { alive = false }
  }, [filter, page])

  const patch = (p: Partial<HistoryFilter>) => setFilter((f) => ({ ...f, ...p }))
  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon" onClick={onClose} aria-label="Back">←</button>
        <span className="brand">HISTORY</span>
        <span className="mono dim">{total}</span>
      </header>

      <div className="filters" role="group" aria-label="Filters">
        <select
          value={filter.preset ?? ''}
          onChange={(e) => patch({ preset: (e.target.value || undefined) as PresetId | undefined })}
          aria-label="Preset"
        >
          <option value="">All presets</option>
          {Object.values(PRESETS).map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <select
          value={filter.result ?? ''}
          onChange={(e) => patch({ result: (e.target.value || undefined) as Result | undefined })}
          aria-label="Result"
        >
          <option value="">Any result</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="abandoned">Abandoned</option>
        </select>

        <select
          value={filter.pool ?? ''}
          onChange={(e) => patch({ pool: (e.target.value || undefined) as PoolId | undefined })}
          aria-label="Pool"
        >
          <option value="">All pools</option>
          <option value="flag-noguess">Standard</option>
          <option value="noflag-noguess">No-flag</option>
          <option value="flag-guess">Guess boards</option>
          <option value="noflag-guess">No-flag · guess</option>
        </select>

        {/* §14.3 — the highest-value query on this screen. */}
        <select
          value={filter.mistake ?? ''}
          onChange={(e) => patch({ mistake: (e.target.value || undefined) as CoachClass | undefined })}
          aria-label="Mistake class"
        >
          <option value="">Any mistake</option>
          {MISTAKE_CLASSES.map((c) => (
            <option key={c} value={c}>{MISTAKE_LABEL[c]}</option>
          ))}
        </select>

        {Object.values(filter).some(Boolean) && (
          <button className="ghost" onClick={() => setFilter({})}>Clear</button>
        )}
      </div>

      <div className="rowhead" aria-hidden="true">
        <span />
        <span>Date</span>
        <span />
        <span className="r">Time</span>
        <span className="r">3BV/s</span>
        <span className="r">Acc</span>
        <span className="r">IOE</span>
        <span />
      </div>

      <div className="rows" role="list">
        {loading && <p className="empty dim">Loading…</p>}

        {!loading && rows.length === 0 && (
          <p className="empty dim">
            {total === 0 && Object.values(filter).every((v) => !v)
              ? 'No games yet. Every game you play is recorded here.'
              : 'No games match these filters.'}
          </p>
        )}

        {!loading && rows.map((r) => {
          const mark = poolMark(r.pool)
          return (
            <button key={r.id} className="row" role="listitem" onClick={() => onOpenReplay(r)}>
              <span className={`dot ${r.result}`} aria-label={r.result} />
              <span className="when dim mono">{when(r.startedAt)}</span>
              <span className="preset mono">{PRESET_SHORT[r.preset] ?? r.preset}</span>
              <span className="time mono">{secs(r.durationMs)}s</span>
              <span className="bvs mono">{r.bvs.toFixed(2)}</span>
              <span className="acc mono">{pct(r.accuracy)}</span>
              <span className="ioe mono dim">{pct(r.efficiency)}</span>
              {mark && <span className="mark">{mark}</span>}
            </button>
          )
        })}
      </div>

      {pages > 1 && (
        <footer className="foot">
          <button className="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Newer
          </button>
          <span className="hint mono dim">{page + 1} / {pages}</span>
          <button className="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Older →
          </button>
        </footer>
      )}
    </div>
  )
}
