import { VERSION } from './brand'
import { useGameStore } from './gameStore'
import { useTutorial } from './tutorial'

/*
 * Anonymous counts of how the game is used, to know whether the first minutes work: that a visit
 * began, that the tutorial was finished, that a first delivery was made, how long the visit was,
 * which picture quality was on, and that an error happened (its message, no more). No cookies, no
 * identifier of the player or the device, nothing typed by the player, no position on the map.
 * Each event is one small anonymous message.
 *
 * It sends nothing until `ANALYTICS_URL` is set to an endpoint that takes these (a privacy-friendly
 * counter the maker signs up for; none is set up yet), and never with ?debug. Said in Credits.
 */

/** Where events go: empty, so nothing is sent, until the maker sets one. */
export const ANALYTICS_URL = ''

type EventName = 'session_start' | 'tutorial_complete' | 'first_delivery' | 'session_end' | 'error'

const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')
const startedAt = Date.now()

export function track(event: EventName, data: Record<string, string | number> = {}) {
  if (!ANALYTICS_URL || debug) return
  const body = JSON.stringify({ event, version: VERSION, quality: useGameStore.getState().quality, ...data })
  try {
    // A beacon is sent even as the page closes, and never holds the game up.
    if (!navigator.sendBeacon?.(ANALYTICS_URL, body)) void fetch(ANALYTICS_URL, { method: 'POST', body, keepalive: true }).catch(() => undefined)
  } catch {
    // Counting is never worth an error.
  }
}

if (typeof window !== 'undefined') {
  // A visit begins when the ride does, not when the page opens.
  const stopStart = useGameStore.subscribe((state) => {
    if (!state.started) return
    stopStart()
    track('session_start', { mode: state.explore ? 'explore' : 'career' })
  })
  useTutorial.subscribe((state, previous) => {
    if (state.done && !previous.done && previous.step !== null) track('tutorial_complete')
  })
  useGameStore.subscribe((state, previous) => {
    if (state.history.length === 1 && previous.history.length === 0) track('first_delivery', { seconds: Math.round((Date.now() - startedAt) / 1000) })
  })
  window.addEventListener('pagehide', () => track('session_end', { minutes: Math.round((Date.now() - startedAt) / 60000) }))
  window.addEventListener('error', (event) => track('error', { message: String(event.message).slice(0, 120) }))
  window.addEventListener('unhandledrejection', (event) => track('error', { message: String((event.reason as Error | undefined)?.message ?? event.reason).slice(0, 120) }))
}
