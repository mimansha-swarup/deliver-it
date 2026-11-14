import { create } from 'zustand'
import { useGameStore } from './gameStore'
import { QUALITY_PRESETS, type Quality } from './qualitySettings'

/** The resolution each quality starts at on this screen: the screen's own, within the preset's range. */
export function startingRatio(quality: Quality): number {
  const [lowest, highest] = QUALITY_PRESETS[quality].pixelRatio
  return Math.min(Math.max(window.devicePixelRatio || 1, lowest), highest)
}

/**
 * The resolution the game draws at right now. It lives in its own small store,
 * because the Canvas sets its resolution from a prop each time it renders, so
 * the prop has to carry the adjusted value.
 */
export const useResolution = create<{ pixelRatio: number }>(() => ({
  pixelRatio: startingRatio(useGameStore.getState().quality),
}))
