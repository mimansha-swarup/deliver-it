import { create } from 'zustand'
import { useGameStore } from './gameStore'
import { QUALITY_PRESETS, type Quality } from './qualitySettings'

/** The resolutions a quality may draw at: its preset's range, or a fixed 0.75× on Low if chosen. */
export function ratioRange(quality: Quality): [number, number] {
  if (quality === 'low' && useGameStore.getState().lowScale) return [LOW_SCALE, LOW_SCALE]
  return QUALITY_PRESETS[quality].pixelRatio
}

/** Low's optional fixed render scale. */
export const LOW_SCALE = 0.75

/** The resolution each quality starts at on this screen: the screen's own, within the preset's range. */
export function startingRatio(quality: Quality): number {
  const [lowest, highest] = ratioRange(quality)
  return Math.min(Math.max(window.devicePixelRatio || 1, lowest), highest)
}

/**
 * The resolution the game draws at right now. It lives in its own small store,
 * because the Canvas sets its resolution from a prop each time it renders, so
 * the prop has to carry the adjusted value.
 */
/*
 * Changing the resolution while riding freezes the picture for a fifth of a second or so (every
 * buffer the picture is drawn through is made again). So the game tries not to: it remembers, on
 * this device, where each quality settled, and starts there next time; and the first time, on a
 * screen faster than 60 Hz (where the aim is 80 FPS, which the top resolution rarely makes), it
 * starts one step under the top, behind the loading screen, rather than finding that out mid-ride.
 */
const REMEMBERED = 'swalpa-fast-resolution'
/** One step of the automatic resolution, as world/AdaptiveResolution.tsx moves it. */
export const RATIO_STEP = 0.25

function remembered(): Partial<Record<Quality, number>> {
  try {
    return JSON.parse(localStorage.getItem(REMEMBERED) ?? '{}') as Partial<Record<Quality, number>>
  } catch {
    return {}
  }
}

/** Where this quality settled on this device, kept for next time. */
export function rememberRatio(quality: Quality, ratio: number) {
  try {
    localStorage.setItem(REMEMBERED, JSON.stringify({ ...remembered(), [quality]: ratio }))
  } catch {
    // Private windows and full storage: it's found again next time.
  }
}

/** The resolution to begin a ride at: where it settled last time, or (never having settled) the top, a step under it on a fast screen. */
export function firstRatio(quality: Quality, fastScreen: boolean): number {
  const [lowest] = ratioRange(quality)
  const top = startingRatio(quality)
  const known = remembered()[quality]
  if (typeof known === 'number' && Number.isFinite(known)) return Math.min(top, Math.max(Math.min(lowest, top), known))
  return fastScreen ? Math.max(Math.min(lowest, top), top - RATIO_STEP) : top
}

export const useResolution = create<{ pixelRatio: number }>(() => ({
  pixelRatio: firstRatio(useGameStore.getState().quality, false),
}))

/**
 * Whether the automatic resolution (world/AdaptiveResolution.tsx) is content with the frame rate at
 * the resolution it has, as judged behind the loading screen: the screen waits for this before it
 * lifts, so the resolution's own steps (each a short freeze) are over before the street is seen.
 */
export const liveScaler = { content: false }
