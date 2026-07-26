/**
 * §4.2 Presets. The Ranked preset is deliberately absent: Expert under default
 * settings *is* the minesweeper.online ranked configuration, so it is the
 * baseline rather than a mode you opt into (§4.5).
 */

export type PresetId = 'beginner' | 'intermediate' | 'expert'

export interface BoardSpec {
  readonly width: number
  readonly height: number
  readonly mines: number
}

export interface Preset extends BoardSpec {
  readonly id: PresetId
  readonly label: string
  /** mines / cells, precomputed for display. */
  readonly density: number
  /**
   * §4.4 — target size of the pre-generated no-guess pool. Expert is the only
   * expensive one to generate and gets the deepest pool.
   */
  readonly poolTarget: number
}

function preset(
  id: PresetId,
  label: string,
  width: number,
  height: number,
  mines: number,
  poolTarget: number,
): Preset {
  return { id, label, width, height, mines, density: mines / (width * height), poolTarget }
}

export const PRESETS: Record<PresetId, Preset> = {
  beginner: preset('beginner', 'Beginner', 9, 9, 10, 5),
  intermediate: preset('intermediate', 'Intermediate', 16, 16, 40, 10),
  expert: preset('expert', 'Expert', 30, 16, 99, 20),
}

export const PRESET_ORDER: readonly PresetId[] = ['beginner', 'intermediate', 'expert']

/** A custom board is any spec that does not match a preset. */
export function matchPreset(spec: BoardSpec): PresetId | null {
  for (const id of PRESET_ORDER) {
    const p = PRESETS[id]
    if (p.width === spec.width && p.height === spec.height && p.mines === spec.mines) return id
  }
  return null
}

export class InvalidSpecError extends Error {}

/**
 * Custom boards need bounds. A board must have at least one non-mine cell, and
 * generation reserves the opening cell plus its neighbours, so the practical
 * ceiling is lower than width*height - 1.
 */
export function validateSpec(spec: BoardSpec): void {
  const { width, height, mines } = spec
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(mines)) {
    throw new InvalidSpecError('width, height and mines must be integers')
  }
  if (width < 2 || height < 2) throw new InvalidSpecError('board must be at least 2×2')
  if (width > 200 || height > 200) throw new InvalidSpecError('board must be at most 200×200')
  if (mines < 1) throw new InvalidSpecError('board must have at least one mine')
  if (mines > width * height - 1) {
    throw new InvalidSpecError('board must have at least one safe cell')
  }
}
