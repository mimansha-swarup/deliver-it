import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { isDebug } from '../dev/spawn'
import { useGameStore } from '../game/gameStore'
import { ratioRange, startingRatio, useResolution } from '../game/resolution'

/** How much the resolution moves in one step, in pixels per screen point. */
const STEP = 0.25
/** Frames are judged in batches this long, in seconds. */
const WINDOW = 1
/** A frame that takes longer than this many screen refreshes was late. */
const LATE = 1.3
/**
 * The screen is assumed to refresh at least 60 times a second, and the game
 * doesn't chase more than 60. Chasing a 120 Hz screen's refresh dropped High
 * to a quarter of the screen's pixels on a busy street, and a sharp picture at
 * 60-100 FPS looks far better than a blurred one at 120.
 */
const SLOWEST_REFRESH = 1 / 60
const FASTEST_REFRESH = 1 / 60
/**
 * Every change of resolution costs: the canvas and every buffer of the effects behind it are
 * made again, and for a second or so after, frames take 90 ms or more (measured on High; with
 * the sun's haze effect in the chain, though not from its depth read). So it changes rarely.
 *
 * If this share of a batch's frames are late, `DROP_BATCHES` batches running, the resolution drops.
 */
const DROP_SHARE = 0.2
const DROP_BATCHES = 3
/** If no more than this share are late, `CALM_BATCHES` batches running, it tries a step up, at most once in `RAISE_GAP` seconds. */
const CALM_SHARE = 0.02
const CALM_BATCHES = 20
const RAISE_GAP = 45
/** A resolution that proved too much isn't tried again for this long, in seconds. */
const CEILING_SECONDS = 300
/**
 * Just after Start, shaders compile and the nearby city is built, so frames
 * are late for reasons a lower resolution won't fix. Judging waits this long, in seconds.
 */
const WARM_UP = 6
/** After a change, its own slow frames aren't judged: they'd only call for another change. In seconds. */
const SETTLE = 2.5

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
  const lowScale = useGameStore((state) => state.lowScale)
  const batch = useRef({ time: 0, frames: [] as number[], slow: 0, calm: 0, ceiling: Infinity, ceilingAge: 0, sinceRaise: Infinity, sinceChange: Infinity, warmUp: WARM_UP, refresh: SLOWEST_REFRESH })
  /** A resolution waiting to be applied at the start of the next frame. See `applyRatio`. */
  const pending = useRef<number | null>(null)

  // A new quality starts again from its own resolution, and forgets what was too much.
  useEffect(() => {
    pending.current = startingRatio(quality)
    Object.assign(batch.current, { time: 0, frames: [], slow: 0, calm: 0, ceiling: Infinity, sinceRaise: Infinity })
  }, [quality, lowScale])

  useFrame(({ setDpr }, delta) => {
    // Debug: a resolution held still for measuring (`__deliverItLockDpr = 1.5`, with ?debug).
    const locked = isDebug() ? (window as unknown as { __deliverItLockDpr?: number }).__deliverItLockDpr : undefined
    if (locked) {
      if (useResolution.getState().pixelRatio !== locked) {
        setDpr(locked)
        useResolution.setState({ pixelRatio: locked })
      }
      return
    }
    // Changing the resolution resizes the canvas, which wipes it. Done here, just
    // before this frame is drawn, the wiped canvas is drawn over at once. Done from
    // React, between frames, the browser could show it empty: a black flash, as the
    // page behind is black.
    if (pending.current !== null) {
      setDpr(pending.current)
      useResolution.setState({ pixelRatio: pending.current })
      pending.current = null
      batch.current.warmUp = Math.max(batch.current.warmUp, SETTLE)
      batch.current.sinceChange = 0
    }

    // The title screen's flight over the whole city isn't what riding costs.
    const state = batch.current
    if (!started || document.hidden) {
      state.warmUp = WARM_UP
      return
    }
    state.sinceChange += delta
    if (state.warmUp > 0) {
      state.warmUp -= delta
      state.frames = []
      state.time = 0
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
    // Never below the quality's own lowest resolution: 1x on High and Medium, 0.75x on Low.
    const lowest = Math.min(ratioRange(quality)[0], best)

    state.slow = lateShare > DROP_SHARE ? state.slow + 1 : 0
    state.calm = lateShare <= CALM_SHARE ? state.calm + 1 : 0

    if (state.slow >= DROP_BATCHES && pixelRatio > lowest) {
      // Too much just after a step up: that level isn't tried again for a while,
      // so the picture doesn't keep sharpening and blurring.
      if (state.sinceRaise <= 3) {
        state.ceiling = pixelRatio
        state.ceilingAge = 0
      }
      pending.current = Math.max(lowest, pixelRatio - STEP)
      state.slow = 0
      state.calm = 0
    } else if (state.calm >= CALM_BATCHES && state.sinceChange >= RAISE_GAP && pixelRatio < highest) {
      pending.current = Math.min(highest, pixelRatio + STEP)
      state.calm = 0
      state.sinceRaise = 0
    }
  })

  return null
}
