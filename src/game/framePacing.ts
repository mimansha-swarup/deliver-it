import { addAfterEffect, addEffect, invalidate } from '@react-three/fiber'
import { create } from 'zustand'
import { usePause, useUi } from '../ui/uiState'
import { useGameStore } from './gameStore'
import { useLaunch } from './launch'
import { livePlayer } from './livePlayer'
import { FRAME_RATES, useSettings, type FrameRate } from './settings'

/*
 * How often the game draws, so it runs cool: a laptop or phone drawing 120 pictures a second of a
 * street nobody is riding down gets hot for nothing.
 *
 * The canvas draws only when asked (react-three-fiber's "demand" loop), and this asks: on every
 * refresh of the screen it decides whether a picture is due, and skips the refreshes in between.
 * So frames stay on the screen's own beat (every second refresh of a 120 Hz screen for 60 a second,
 * every fourth for 30), which a timer can't do: a timer drifts across refreshes and the picture
 * stutters. Everything the game works out each frame hangs off the same loop, so a frame not drawn
 * is a frame not simulated either, and the time it covered is made up in the next one.
 *
 * The rate asked for is the lowest of:
 * - the player's setting (game/settings.ts): Battery saver 30, Smooth 60 (as it starts), Unlimited;
 * - 30, when the device is running on its battery or has been getting slower as it heats (below),
 *   unless the player has turned that off;
 * - 30, while there's nothing to watch: the story cards, the pause menu and its
 *   settings, the raised phone, the full map, the help; and standing still, hands off, for 3 seconds
 *   (any key, click or mouse movement brings it straight back); and 5 on the title screen,
 *   whose pictures hide the 3D scene altogether.
 * Loading, and the ride's first moments behind the loading screen, are never held back.
 * In a background tab or a minimised window the browser stops the screen's refreshes, so nothing is
 * drawn or simulated at all, and the sound is stopped too (audio/audioEngine.ts).
 */

/** Frames a second while there's nothing to watch. */
/** `unseen`: on the title screen, whose pictures cover the 3D scene completely until the city starts being built behind them. */
export const REST = { menus: 30, unseen: 5, idle: 30, idleAfterMs: 3000, movedMetres: 0.02 }
/**
 * Heat. A device that's getting hot slows its processor, and the same street takes longer and
 * longer to draw. The work of each frame is averaged over `window` seconds of riding; if three such
 * averages in a row each rise by `rise`, the last is `over` times the best average seen, and it
 * fills `full` of the time a frame has, the game goes to Battery saver. A busier street does some
 * of that by itself, but not all of it, for a minute and a half, and the cost of being wrong is a
 * toast with a "Turn off" on it.
 */
const HEAT = { window: 30, rise: 1.05, over: 1.5, full: 0.75 }

export type PacingWhy = 'unlimited' | 'smooth' | 'saver' | 'battery' | 'heat' | 'menu' | 'idle' | 'loading' | 'hidden'

/** What the pacing is doing now, for the frame-rate judge (world/AdaptiveResolution.tsx) and the debug overlay. */
export const livePacing = {
  /** Frames a second being drawn at most; 0 is every refresh of the screen. */
  cap: FRAME_RATES.smooth as number,
  why: 'smooth' as PacingWhy,
  /** The player's setting, or what took its place (battery, heat). */
  mode: 'smooth' as FrameRate,
  /** The screen's own refreshes a second, as measured. */
  screenHz: 60,
  /** Seconds between frames as paced: a whole number of the screen's refreshes. */
  interval: 1 / 60,
  /** Resting: a menu is up or the player is standing idle. The frame rate says nothing about the device then. */
  resting: false,
  /** Frames drawn so far. */
  frames: 0,
  /** The work of a frame, in milliseconds, averaged over the last second or so. */
  work: 0,
}

/** Why Battery saver came on by itself, if it has, and whether its toast is up (ui/PowerToast.tsx). */
export const usePower = create<{ auto: 'battery' | 'heat' | null; toast: boolean }>(() => ({ auto: null, toast: false }))

/** `?fps=unlimited` (or smooth, saver) in the address holds one rate, for measuring: no battery or heat switch. */
const forced = ((): FrameRate | null => {
  if (typeof location === 'undefined') return null
  const asked = new URLSearchParams(location.search).get('fps')
  return asked === 'unlimited' || asked === 'smooth' || asked === 'saver' ? asked : null
})()

function setAuto(auto: 'battery' | 'heat' | null) {
  if (usePower.getState().auto === auto) return
  // The toast only for a switch the player would see: not when they've already chosen Battery saver, or turned this off.
  const settings = useSettings.getState()
  usePower.setState({ auto, toast: auto !== null && settings.autoSaver !== false && settings.frameRate !== 'saver' && forced === null })
}

type Battery = EventTarget & { charging: boolean }
function watchBattery() {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<Battery> }).getBattery
  if (!getBattery) return
  void getBattery
    .call(navigator)
    .then((battery) => {
      const read = () => {
        if (!battery.charging) setAuto('battery')
        else if (usePower.getState().auto === 'battery') setAuto(null)
      }
      read()
      battery.addEventListener('chargingchange', read)
    })
    .catch(() => {})
}

/** When the player last pressed, clicked or moved anything, or the rider last moved, as `performance.now()`. */
let lastActive = 0
let overlayUp = false
const seen = { x: 0, z: 0, at: 0 }

/** The rate to draw at now, and why. A cap under 0: nothing at all. */
function decide(now: number): { cap: number; why: PacingWhy; mode: FrameRate; resting: boolean } {
  const settings = useSettings.getState()
  const auto = settings.autoSaver !== false && forced === null ? usePower.getState().auto : null
  const mode = forced ?? (auto ? 'saver' : (settings.frameRate ?? 'smooth'))
  if (document.hidden) return { cap: -1, why: 'hidden', mode, resting: true }
  const launch = useLaunch.getState()
  const game = useGameStore.getState()
  if (launch.requested && (!game.started || launch.covered)) return { cap: 0, why: 'loading', mode, resting: true }
  const base = FRAME_RATES[mode]
  const least = (rest: number) => (base === 0 ? rest : Math.min(base, rest))
  // Looked for a few times a second, not every refresh: the rider's place, and what's up on the page.
  if (now - seen.at > 250) {
    if (Math.hypot(livePlayer.x - seen.x, livePlayer.z - seen.z) > REST.movedMetres) lastActive = now
    seen.x = livePlayer.x
    seen.z = livePlayer.z
    seen.at = now
    overlayUp = document.querySelector('.phone-raised, .story, .help-overlay') !== null
  }
  if (!launch.requested && !launch.curtainDrawn) return { cap: REST.unseen, why: 'menu', mode, resting: true }
  if (!launch.requested || usePause.getState().open || useUi.getState().mapOpen || overlayUp) return { cap: least(REST.menus), why: 'menu', mode, resting: true }
  if (game.started && !game.photoMode && now - lastActive > REST.idleAfterMs) return { cap: least(REST.idle), why: 'idle', mode, resting: true }
  return { cap: base, why: auto ?? mode, mode, resting: false }
}

const SCREEN_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]
/** The screen's refreshes a second: from the quickest tenth of the last few seconds' gaps between them. */
const gaps: number[] = []
function measureScreen(gap: number) {
  if (gap < 2 || gap > 100) return
  gaps.push(gap)
  if (gaps.length > 480) gaps.shift()
  if (gaps.length < 30 || gaps.length % 30 !== 0) return
  // The quicker third's slowest: under it are refreshes that came a hair early, over it ones that were late.
  const quick = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.3)]
  const measured = Math.min(360, Math.max(24, 1000 / quick))
  // Screens come at a few rates, and the measure wobbles by a few percent: the nearest one, if it's close.
  const known = SCREEN_RATES.find((rate) => Math.abs(rate - measured) / rate < 0.06)
  livePacing.screenHz = known ?? measured
}

/** Heat: the averages of the frames' work, one every `HEAT.window` seconds of riding. */
const heat = { sum: 0, frames: 0, began: 0, averages: [] as number[], best: Infinity }
function noteWork(now: number, work: number) {
  livePacing.work += (work - livePacing.work) * 0.05
  // Only riding at the player's own rate says anything: a menu, a rest or the saver itself doesn't.
  if (livePacing.resting || usePower.getState().auto || forced !== null) {
    heat.sum = heat.frames = 0
    heat.began = now
    return
  }
  heat.sum += work
  heat.frames++
  if (now - heat.began < HEAT.window * 1000) return
  const average = heat.sum / Math.max(1, heat.frames)
  heat.sum = heat.frames = 0
  heat.began = now
  heat.averages.push(average)
  if (heat.averages.length > 3) heat.averages.shift()
  const [first, second, third] = heat.averages
  const budget = 1000 * livePacing.interval
  if (heat.averages.length === 3 && second > first * HEAT.rise && third > second * HEAT.rise && third > heat.best * HEAT.over && third > budget * HEAT.full) setAuto('heat')
  heat.best = Math.min(heat.best, average)
}

let running = false
/** Starts the pacing: once, as the page opens (App.tsx). */
export function startFramePacing() {
  if (running || typeof window === 'undefined') return
  running = true
  if (forced === null) watchBattery()
  const active = () => {
    lastActive = performance.now()
  }
  for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) window.addEventListener(type, active, { capture: true, passive: true })

  // The work of each frame: from before react-three-fiber's callbacks to after its drawing.
  let began = 0
  addEffect(() => {
    began = performance.now()
  })
  addAfterEffect(() => {
    const now = performance.now()
    livePacing.frames++
    noteWork(now, now - began)
  })

  let lastTick = 0
  let lastAsked = -Infinity
  const tick = (now: number) => {
    measureScreen(now - lastTick)
    lastTick = now
    const want = decide(now)
    const refresh = 1000 / livePacing.screenHz
    // How many of the screen's refreshes each frame is shown for: 2 on a 120 Hz screen for 60 a
    // second. A screen a little quicker than the rate (75 Hz for 60) is drawn on every refresh.
    const every = want.cap > 0 ? Math.max(1, Math.round(livePacing.screenHz / want.cap - 0.2)) : 1
    Object.assign(livePacing, { cap: Math.max(0, want.cap), why: want.why, mode: want.mode, resting: want.resting, interval: (every * refresh) / 1000 })
    // Due half a refresh early, so a refresh that comes a hair soon still counts.
    if (want.cap >= 0 && now - lastAsked >= (every - 0.5) * refresh) {
      lastAsked = now
      invalidate()
    }
    // Asked for again last of all, so that on the next refresh the frame asked for above is drawn
    // before this runs: asking for the one after it then starts it on the refresh that follows.
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // Back from a hidden tab: a frame at once, not a refresh later.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastActive = performance.now()
      invalidate()
    }
  })
}

/** The player turns the automatic Battery saver off (the toast's button; Settings has the switch). */
export function turnAutoSaverOff() {
  useSettings.getState().set({ autoSaver: false })
  usePower.setState({ toast: false })
}
