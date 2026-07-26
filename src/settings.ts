import { useCallback, useEffect, useState } from 'react'
import type { Scheme } from './game/controller.ts'
import type { PresetId } from '../engine/replay.ts'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type PresetChoice = Exclude<PresetId, 'custom'>

export interface Settings {
  preset: PresetChoice
  /** Touch gesture routing. `no-flag` is also a play style the controller enforces. */
  scheme: Scheme
  /** §13.1 — provisional, needs device tuning. */
  longPressMs: number
  mouseLeftChord: boolean
  noGuess: boolean
  /** §7.3 — off in timed play, forced on in learning mode. */
  chordSafety: boolean
  /**
   * §7.3, §P8 — learning mode. Highlights every provable move live, allows
   * chord safety and undo, and does not write to the personal-best pools:
   * a time set with the answers on screen is not a time.
   */
  learning: boolean
  theme: ThemeChoice
  haptics: boolean
}

export const DEFAULTS: Settings = {
  preset: 'expert',
  scheme: 'standard',
  longPressMs: 180,
  mouseLeftChord: true,
  noGuess: true,
  chordSafety: false,
  learning: false,
  theme: 'system',
  haptics: true,
}

const KEY = 'zinith.settings.v1'
const SCHEMES: Scheme[] = ['standard', 'flag-first', 'no-flag', 'drag-flag']
const PRESETS: PresetChoice[] = ['beginner', 'intermediate', 'expert']
const THEMES: ThemeChoice[] = ['system', 'light', 'dark']

/**
 * Merge stored settings field by field. Never spread the parsed object over the
 * defaults: anything in localStorage is untrusted input, and one bad value
 * (`preset: "ranked"`, a string where a number belongs) would otherwise reach
 * the board config and crash on load with no way for the user to recover.
 */
function parse(raw: string | null): Settings {
  if (!raw) return DEFAULTS
  let o: Record<string, unknown>
  try {
    const p: unknown = JSON.parse(raw)
    if (!p || typeof p !== 'object') return DEFAULTS
    o = p as Record<string, unknown>
  } catch {
    return DEFAULTS
  }
  const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    preset: pick(o.preset, PRESETS, DEFAULTS.preset),
    scheme: pick(o.scheme, SCHEMES, DEFAULTS.scheme),
    longPressMs:
      typeof o.longPressMs === 'number' && Number.isFinite(o.longPressMs)
        ? Math.min(400, Math.max(120, Math.round(o.longPressMs)))
        : DEFAULTS.longPressMs,
    mouseLeftChord: bool(o.mouseLeftChord, DEFAULTS.mouseLeftChord),
    noGuess: bool(o.noGuess, DEFAULTS.noGuess),
    chordSafety: bool(o.chordSafety, DEFAULTS.chordSafety),
    learning: bool(o.learning, DEFAULTS.learning),
    theme: pick(o.theme, THEMES, DEFAULTS.theme),
    haptics: bool(o.haptics, DEFAULTS.haptics),
  }
}

function read(): Settings {
  try {
    return parse(localStorage.getItem(KEY))
  } catch {
    return DEFAULTS // private-mode Safari throws on access, not just on write
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(read)

  const set = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [k]: v }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage full or blocked; settings still apply for this session */
      }
      return next
    })
  }, [])

  return [settings, set] as const
}

/** Tracks `prefers-color-scheme` so `theme: 'system'` follows the OS live. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )
  useEffect(() => {
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const on = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

/** True when a coarse pointer is the primary one — used to label control help. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
  )
  useEffect(() => {
    const mq = globalThis.matchMedia?.('(pointer: coarse)')
    if (!mq) return
    const on = (e: MediaQueryListEvent) => setCoarse(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return coarse
}
