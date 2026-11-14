import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../game/gameStore'
import { startingRatio, useResolution } from '../game/resolution'

/** Never below this many pixels per screen point, however slow the computer. */
const LOWEST = 0.75
/** How much the resolution moves in one step, in pixels per screen point. */
const STEP = 0.25
/** Frames are judged in batches this long, in seconds. */
const WINDOW = 1
/** A frame that takes longer than this many screen refreshes was late. */
const LATE = 1.3
/**
 * The screen is assumed to refresh at least 60 times a second, and the game
 * doesn't chase more than 120, which would cost sharpness for little gain.
 */
const SLOWEST_REFRESH = 1 / 60
const FASTEST_REFRESH = 1 / 120
/** If this share of a batch's frames are late, two batches running, the resolution drops. */
const DROP_SHARE = 0.2
/** If no more than this share are late, five batches running, it tries a step up. */
const CALM_SHARE = 0.02
const CALM_BATCHES = 5
/** A resolution that proved too much isn't tried again for this long, in seconds. */
const CEILING_SECONDS = 60
/**
 * Just after Start, shaders compile and the nearby city is built, so frames
 * are late for reasons a lower resolution won't fix. Judging waits this long, in seconds.
 */
const WARM_UP = 3

/**
 * Keeps the frame rate steady by lowering the resolution when frames come in
 * late, and raising it again once things are calm.
 *
 * A frame is late when it misses the screen's refresh. A screen shows a new
 * picture only on its refresh, so a game that needs 11 ms on a 120 Hz screen
 * (8.3 ms) shows some pictures for one refresh and others for two. That uneven
 * rhythm feels laggier than a steady, slightly lower rate.
 */
export function AdaptiveResolution() {
  const started = useGameStore((state) => state.started)
  const quality = useGameStore((state) => state.quality)
  const batch = useRef({ time: 0, frames: [] as number[], slow: 0, calm: 0, ceiling: Infinity, ceilingAge: 0, sinceRaise: Infinity, warmUp: WARM_UP, refresh: SLOWEST_REFRESH })

  // A new quality starts again from its own resolution, and forgets what was too much.
  useEffect(() => {
    useResolution.setState({ pixelRatio: startingRatio(quality) })
    Object.assign(batch.current, { time: 0, frames: [], slow: 0, calm: 0, ceiling: Infinity, sinceRaise: Infinity })
  }, [quality])

  useFrame((_, delta) => {
    // The title screen's flight over the whole city isn't what riding costs.
    const state = batch.current
    if (!started || document.hidden) {
      state.warmUp = WARM_UP
      return
    }
    if (state.warmUp > 0) {
      state.warmUp -= delta
      return
    }
    state.frames.push(delta)
    state.time += delta
    state.ceilingAge += delta
    if (state.time < WINDOW) return

    // The screen's refresh is the quickest frames have come, give or take. A
    // screen that can change its rate, as many laptops' can, slows down to
    // match a slow game, so this remembers the best it has seen.
    const sorted = [...state.frames].sort((a, b) => a - b)
    state.refresh = Math.min(state.refresh, Math.max(FASTEST_REFRESH, sorted[Math.floor(sorted.length * 0.1)]))
    const lateShare = state.frames.filter((frame) => frame > state.refresh * LATE).length / state.frames.length
    if (state.ceilingAge > CEILING_SECONDS) state.ceiling = Infinity
    state.time = 0
    state.frames = []
    state.sinceRaise++

    const { pixelRatio } = useResolution.getState()
    const best = startingRatio(quality)
    const highest = Math.min(best, state.ceiling - STEP)
    const lowest = Math.min(LOWEST, best)

    state.slow = lateShare > DROP_SHARE ? state.slow + 1 : 0
    state.calm = lateShare <= CALM_SHARE ? state.calm + 1 : 0

    if (state.slow >= 2 && pixelRatio > lowest) {
      // Too much just after a step up: that level isn't tried again for a while,
      // so the picture doesn't keep sharpening and blurring.
      if (state.sinceRaise <= 3) {
        state.ceiling = pixelRatio
        state.ceilingAge = 0
      }
      useResolution.setState({ pixelRatio: Math.max(lowest, pixelRatio - STEP) })
      state.slow = 0
      state.calm = 0
    } else if (state.calm >= CALM_BATCHES && pixelRatio < highest) {
      useResolution.setState({ pixelRatio: Math.min(highest, pixelRatio + STEP) })
      state.calm = 0
      state.sinceRaise = 0
    }
  })

  return null
}
