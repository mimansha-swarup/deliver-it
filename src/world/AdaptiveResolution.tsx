import { useEffect, useRef } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { isDebug } from '../dev/spawn'
import { useGameStore } from '../game/gameStore'
import { firstRatio, liveScaler, ratioRange, rememberRatio, startingRatio, useResolution } from '../game/resolution'
import { useLaunch } from '../game/launch'
import { livePacing } from '../game/framePacing'
import { useSettings } from '../game/settings'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('resolution scaler')

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
 * On a screen faster than 60 Hz, High is held above this many frames a second (or just under the
 * screen's own rate, if that's lower): below it for `DROP_BATCHES` batches, the resolution drops a
 * step. A 120 Hz laptop in its low-power mode gives High about 70 FPS at full resolution and 90 a
 * step down, and 70 on a 120 Hz screen is every other frame shown twice. Above it (a sharp 85-110
 * FPS) the picture is left alone, as before.
 *
 * The frames' own times can't tell such a screen from a 75 Hz one: slowed, they come evenly. So the
 * screen's rate is read from the browser's frame stamps, which stay on its refresh.
 */
const TARGET_FPS = 80
/** A frame rate under this share of the aim is too slow. */
const NEAR_TARGET = 1.04
/** On a fast screen the drop waits for this many slow batches running: a step's own hitch costs more than a few seconds a little under the target. */
const DROP_BATCHES_FAST = 5
/** A step up is only tried from this much above the target, as it will cost about a fifth of the frame rate. */
const RAISE_HEADROOM = 1.25
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
 * Behind the loading screen, in the ride's first moments (game/launch.ts' `covered`), the
 * resolution is settled quickly, so a step that was always going to come doesn't come mid-ride
 * with its freeze: judging starts after `warmUp` seconds, in batches of `window`, a single slow
 * batch drops a step, and a change's own slow frames are skipped for `settle`. Standing at the
 * start is lighter than riding, so "slow" there is anything under `margin` times the usual aim.
 * On Low a step up is tried there too, once, if there is that much to spare (`raiseFrom` times the
 * aim: Low on a fast laptop starts a step under its top and has twice the frame rate it needs).
 * Never on Medium or High: standing at the start says little about riding there, and a step up
 * that riding can't hold costs far more than it gives.
 * The loading screen waits for `liveScaler.content` (LoadingScreen.tsx).
 */
const COVERED = { warmUp: 0.4, window: 0.5, settle: 0.8, margin: 1.1, raiseFrom: 1.45, batches: 2 }
/** Once riding, a step up (which freezes a few frames) is only made while the rider is slower than this, in km/h: stopped at a signal or a door, where nobody is watching the road go by. */
const RAISE_BELOW_KMH = 2
/**
 * Dropped below where the quality starts (High at 1× where it starts at 1.25×), it steps back up as
 * soon as there's headroom for it: `batches` calm seconds running, and `gap` seconds since the last change.
 */
const REGAIN = { batches: 8, gap: 15 }

/** Gaps between frame stamps this short, in seconds, are a faster screen's own refresh (under 4 ms is two callbacks in one frame). */
const SHORT_GAP = [0.004, 0.014]
const ENOUGH_GAPS = 40
function noteGap(screen: { refresh: number; sum: number; count: number }, gap: number) {
  if (gap <= SHORT_GAP[0] || gap >= SHORT_GAP[1] || screen.count > 2000) return
  screen.sum += gap
  screen.count++
  if (screen.count >= ENOUGH_GAPS) screen.refresh = screen.sum / screen.count
}

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
  const sharpPicture = useSettings((state) => state.sharpPicture)
  /**
   * Whether frames come faster than 60 a second: a screen that refreshes faster, and a game that's
   * let to (game/framePacing.ts: Unlimited). Paced to 60 or 30, a fast screen is judged as a 60 Hz
   * one is, by its late frames: an aim of 80 it's never allowed to reach would only blur the picture.
   */
  const fastNow = () => screen.current.refresh < SLOWEST_REFRESH * 0.95 && livePacing.cap === 0
  const batch = useRef({ time: 0, frames: [] as number[], slow: 0, calm: 0, ceiling: Infinity, ceilingAge: 0, sinceRaise: Infinity, sinceChange: Infinity, warmUp: WARM_UP, refresh: SLOWEST_REFRESH })
  /**
   * The screen's refresh, in seconds, if it's faster than 60 Hz: the average of the short gaps between
   * the browser's frame stamps, once enough have been seen that it isn't a stray one. Otherwise 1/60.
   */
  const screen = useRef({ refresh: SLOWEST_REFRESH, sum: 0, count: 0 })
  const pending = useRef<number | null>(null)
  /** Whether the one step up allowed behind the loading screen has been made. */
  const raisedCovered = useRef(false)
  useEffect(() => {
    let last = 0
    let id = requestAnimationFrame(function watch(stamp) {
      const gap = (stamp - last) / 1000
      last = stamp
      const known = screen.current.count >= ENOUGH_GAPS
      noteGap(screen.current, gap)
      // The moment the screen's speed is known (half a second into the title screen): the resolution
      // to ride at, set now. Left until the ride began, the change froze its first moments.
      if (!known && screen.current.count >= ENOUGH_GAPS && !useGameStore.getState().started) {
        const first = firstRatio(useGameStore.getState().quality, fastNow())
        if (first !== useResolution.getState().pixelRatio) pending.current = first
      }
      id = requestAnimationFrame(watch)
    })
    return () => cancelAnimationFrame(id)
  }, [])
  /** A resolution waiting to be applied at the start of the next frame. See `applyRatio`. */

  // A new quality starts again from its own resolution, and forgets what was too much.
  useEffect(() => {
    pending.current = firstRatio(quality, fastNow())
    Object.assign(batch.current, { time: 0, frames: [], slow: 0, calm: 0, ceiling: Infinity, sinceRaise: Infinity })
  }, [quality, lowScale, sharpPicture])

  // As the ride begins (the loading screen is still up), with the screen's speed now measured: the
  // resolution to ride at, so a change that was always going to come doesn't come mid-ride.
  useEffect(() => {
    if (!started) return
    const first = firstRatio(quality, fastNow())
    if (first !== useResolution.getState().pixelRatio) pending.current = first
  }, [started, quality])

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
    const covered = started && useLaunch.getState().covered
    if (pending.current !== null) {
      setDpr(pending.current)
      useResolution.setState({ pixelRatio: pending.current })
      pending.current = null
      batch.current.warmUp = covered ? COVERED.settle : Math.max(batch.current.warmUp, SETTLE)
      batch.current.sinceChange = 0
      liveScaler.content = false
    }

    // The title screen's flight over the whole city isn't what riding costs.
    const state = batch.current
    if (!started || document.hidden) {
      state.warmUp = WARM_UP
      return
    }
    // Resting (a menu up, or standing idle at 30 a second: game/framePacing.ts), the frames come
    // slowly on purpose and say nothing about the device: none are judged, and the batch starts again after.
    if (livePacing.resting && !covered) {
      state.frames = []
      state.time = 0
      state.warmUp = Math.max(state.warmUp, 0.5)
      return
    }
    state.sinceChange += delta
    if (covered) state.warmUp = Math.min(state.warmUp, COVERED.warmUp)
    if (state.warmUp > 0) {
      state.warmUp -= delta
      state.frames = []
      state.time = 0
      return
    }
    state.frames.push(delta)
    state.time += delta
    state.ceilingAge += delta
    if (state.time < (covered ? COVERED.window : WINDOW)) return

    // The screen's refresh is the quickest frames have come, give or take. A
    // screen that can change its rate, as many laptops' can, slows down to
    // match a slow game, so this remembers the best it has seen.
    const sorted = [...state.frames].sort((a, b) => a - b)
    state.refresh = Math.min(state.refresh, Math.max(FASTEST_REFRESH, sorted[Math.floor(sorted.length * 0.1)]))
    // Paced under the screen's rate (60 on a 120 Hz screen, 30 in Battery saver), a frame is late by that pace, not the screen's.
    const pace = livePacing.cap > 0 && !covered ? Math.max(state.refresh, livePacing.interval) : state.refresh
    const lateShare = state.frames.filter((frame) => frame > pace * LATE).length / state.frames.length
    // A fast screen is judged by its frame rate, a 60 Hz one by its late frames.
    const fps = state.frames.length / state.time
    const { refresh } = screen.current
    const fast = refresh < SLOWEST_REFRESH * 0.95 && (livePacing.cap === 0 || covered)
    const target = Math.min(TARGET_FPS, 0.94 / refresh)
    // On a fast screen, hovering a little under the aim counts: at 70 to 80 FPS with 80 the aim, a second
    // at 81 kept resetting the count and the resolution never came down.
    // Behind the loading screen the judge is the usual frame (the middle one of the batch), not the
    // count: the ride's first frames are long whatever the resolution, and counting them had a laptop
    // with plenty to spare dropped to 1× for a hitch that wasn't the resolution's doing.
    const usualFps = 1 / sorted[Math.floor(sorted.length / 2)]
    const tooSlow = covered && fast ? usualFps < target * NEAR_TARGET * COVERED.margin : fast ? fps < target * NEAR_TARGET : lateShare > DROP_SHARE
    const calm = lateShare <= CALM_SHARE && (!fast || fps >= target * RAISE_HEADROOM)
    if (state.ceilingAge > CEILING_SECONDS) state.ceiling = Infinity
    // Debug: what the last batch measured (`__deliverItScaler`, with ?debug).
    if (isDebug()) (window as unknown as { __deliverItScaler?: unknown }).__deliverItScaler = { fps: Math.round(fps), target: Math.round(target), screenHz: Math.round(1 / refresh), lateShare: +lateShare.toFixed(2), slow: state.slow }
    state.time = 0
    state.frames = []
    state.sinceRaise++

    const { pixelRatio } = useResolution.getState()
    const best = startingRatio(quality)
    const highest = Math.min(best, state.ceiling - STEP)
    // Never below the quality's own lowest resolution: 1x on High and Medium, 0.75x on Low.
    const lowest = Math.min(ratioRange(quality)[0], best)
    // Where this quality starts on this screen, with nothing remembered: a step under the top on a fast screen.
    const resting = fast ? Math.max(lowest, best - STEP) : best

    state.slow = tooSlow ? state.slow + 1 : 0
    state.calm = calm ? state.calm + 1 : 0

    // Behind the loading screen: content once a batch has passed, or there's no lower to go.
    if (covered) liveScaler.content = !tooSlow || pixelRatio <= lowest
    if (state.slow >= (covered ? COVERED.batches : fast ? DROP_BATCHES_FAST : DROP_BATCHES) && pixelRatio > lowest) {
      // Too much just after a step up: that level isn't tried again for a while,
      // so the picture doesn't keep sharpening and blurring.
      if (state.sinceRaise <= 3) {
        state.ceiling = pixelRatio
        state.ceilingAge = 0
      }
      pending.current = Math.max(lowest, pixelRatio - STEP)
      rememberRatio(quality, pending.current)
      state.slow = 0
      state.calm = 0
    } else if (covered && !raisedCovered.current && quality === 'low' && fast && fps >= target * COVERED.raiseFrom && lateShare <= CALM_SHARE && pixelRatio < highest) {
      // Behind the loading screen, with plenty to spare: the step up is made now, not 45 seconds into the ride.
      raisedCovered.current = true
      pending.current = Math.min(highest, pixelRatio + STEP)
      rememberRatio(quality, pending.current)
      state.sinceRaise = 0
    } else if (
      pixelRatio < highest &&
      state.calm >= (pixelRatio < resting ? REGAIN.batches : CALM_BATCHES) &&
      state.sinceChange >= (pixelRatio < resting ? REGAIN.gap : RAISE_GAP) &&
      // Back up to the resolution the quality starts at (1.25× on High on a fast screen), riding or
      // not: it was only left because of a slow spell, and there's headroom again. Past that, to the
      // screen's own, only at a standstill.
      (pixelRatio < resting || useGameStore.getState().speedKmh < RAISE_BELOW_KMH)
    ) {
      pending.current = Math.min(highest, pixelRatio + STEP)
      rememberRatio(quality, pending.current)
      state.calm = 0
      state.sinceRaise = 0
    }
  })

  return null
}
