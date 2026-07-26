import type { PresetId } from './replay.ts'

export interface Preset {
  id: PresetId
  label: string
  width: number
  height: number
  mines: number
  /** how deep to keep the pre-generated no-guess pool */
  poolTarget: number
}

export const PRESETS: Record<Exclude<PresetId, 'custom'>, Preset> = {
  beginner: { id: 'beginner', label: 'Beginner', width: 9, height: 9, mines: 10, poolTarget: 5 },
  intermediate: { id: 'intermediate', label: 'Intermediate', width: 16, height: 16, mines: 40, poolTarget: 10 },
  expert: { id: 'expert', label: 'Expert', width: 30, height: 16, mines: 99, poolTarget: 20 },
}

/**
 * Expert under default settings is the minesweeper.online ranked
 * configuration. There is deliberately no separate ranked mode.
 */
export const DEFAULT_PRESET = PRESETS.expert
