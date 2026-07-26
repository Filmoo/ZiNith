/**
 * §7.2 — haptics on flag and chord only, never on plain open.
 * Swapped for @capacitor/haptics at P9 without touching callers.
 */
let enabled = true
export function setHaptics(on: boolean) { enabled = on }

export function tapFlag() {
  if (!enabled) return
  navigator.vibrate?.(8)
}
export function tapChord() {
  if (!enabled) return
  navigator.vibrate?.(12)
}
export function tapLoss() {
  if (!enabled) return
  navigator.vibrate?.([0, 30, 40, 60])
}
