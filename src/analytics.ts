import posthog from 'posthog-js'
import { useGameStore } from './game/gameStore'
import { TUTORIAL_STEPS, useTutorial } from './game/tutorial'
import { useRoomStore } from './net/room'

/*
 * Anonymous gameplay statistics, through PostHog. This file is the only place that talks to it.
 *
 * What is sent is a short list of game events (below) with a few small properties: no name, no
 * email, nothing typed, no position on the map. PostHog is set up to do nothing on its own: no
 * autocapture of clicks, no page views, no session recording, no surveys, no feature flags, no
 * person profiles; and it keeps its anonymous id in memory only, so there is no cookie and nothing
 * in local storage, and a visitor is a new anonymous id each visit.
 *
 * It is off altogether, every call doing nothing, when there is no key (`VITE_POSTHOG_KEY`), on
 * localhost, on Netlify's deploy previews, and with `?debug` or `?fresh` in the address.
 *
 * `ip: false` is set because it was asked for, but in this version of posthog-js it does nothing
 * (it is marked deprecated). Whether PostHog keeps the visitor's IP address is the project's own
 * setting, "Discard client IP data", which has to be on.
 */

type Props = Record<string, string | number | boolean>
export type EventName =
  | 'page_open'
  | 'new_game'
  | 'explore_start'
  | 'multiplayer_join'
  | 'tutorial_step'
  | 'tutorial_skip'
  | 'tutorial_done'
  | 'order_accepted'
  | 'pickup_done'
  | 'order_delivered'
  | 'crash'
  | 'vehicle_switch'
  | 'session_end'

const KEY: string | undefined = import.meta.env.VITE_POSTHOG_KEY
const HOST: string | undefined = import.meta.env.VITE_POSTHOG_HOST

/** Where nothing is ever sent from: a developer's machine, a deploy preview, a debugging or testing visit. */
function switchedOff(): boolean {
  if (typeof window === 'undefined') return true
  const { hostname, search } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')) return true
  if (hostname.endsWith('--deliver-simulator.netlify.app')) return true
  const query = new URLSearchParams(search)
  return query.has('debug') || query.has('fresh')
}

const on = Boolean(KEY) && !switchedOff()

if (on && KEY) {
  posthog.init(KEY, {
    api_host: HOST || 'https://us.i.posthog.com',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    person_profiles: 'identified_only',
    persistence: 'memory',
    ip: false,
    // The page's address goes without its query: an invite link carries a room's code.
    before_send: (event) => {
      if (event?.properties) {
        for (const key of ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer']) {
          const value: unknown = event.properties[key]
          if (typeof value === 'string') event.properties[key] = value.split('?')[0].split('#')[0]
        }
      }
      return event
    },
  })
}

/** One game event. Does nothing where analytics is off. `beacon`: sent in a way that survives the page closing. */
export function track(event: EventName, props: Props = {}, beacon = false) {
  if (!on) return
  try {
    posthog.capture(event, props, beacon ? { transport: 'sendBeacon' } : undefined)
  } catch {
    // Counting is never worth an error in the game.
  }
}

/** The page has opened: which kind of device, and the picture quality it starts on. */
export function pageOpen() {
  const mobile = typeof navigator !== 'undefined' && (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900))
  track('page_open', { device: mobile ? 'mobile' : 'desktop', quality: useGameStore.getState().quality })
}

/*
 * The events that come from the game's own state, watched here so the game's code doesn't have to
 * know about analytics. (Starting a game, and skipping the tutorial, are said where they happen:
 * ui/TitleScreen.tsx and ui/Tutorial.tsx.)
 */
if (on) {
  const openedAt = Date.now()
  let tutorialFrom = 0

  useTutorial.subscribe((state, previous) => {
    if (state.step !== previous.step && state.step !== null) {
      if (previous.step === null) tutorialFrom = Date.now()
      track('tutorial_step', { n: TUTORIAL_STEPS.indexOf(state.step) + 1 })
    }
    // Finished by doing it: the last step was the delivery, and it has been made.
    if (state.done && !previous.done && previous.step === 'deliver' && useGameStore.getState().history.length > 0) {
      track('tutorial_done', { seconds: Math.round((Date.now() - tutorialFrom) / 1000) })
    }
  })

  useGameStore.subscribe((state, previous) => {
    if (state.mission && !previous.mission) track('order_accepted', { order_no: state.history.length + 1 })
    if (state.phase === 'toCustomer' && previous.phase === 'toPickup' && state.mission) track('pickup_done')
    if (state.lastReward && state.lastReward !== previous.lastReward) {
      const { stars, seconds, crashes, onTime } = state.lastReward
      track('order_delivered', { stars, seconds: Math.round(seconds), crashes, on_time: onTime, vehicle: state.vehicleId })
    }
    if (state.crashed && !previous.crashed) track('crash')
    if (state.started && previous.started && state.vehicleId !== previous.vehicleId) track('vehicle_switch', { vehicle: state.vehicleId })
  })

  useRoomStore.subscribe((state, previous) => {
    if (state.status === 'on' && previous.status !== 'on') track('multiplayer_join', { players: Object.keys(state.riders).length + 1 })
  })

  // The visit's end, once each time the page is hidden or closed, by beacon so it gets out.
  let told = false
  const end = () => {
    if (told) return
    told = true
    track('session_end', { minutes_played: Math.round((Date.now() - openedAt) / 60000), deliveries: useGameStore.getState().history.length }, true)
  }
  window.addEventListener('pagehide', end)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') end()
    else told = false
  })
}
