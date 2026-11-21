import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppId } from '../ui/phoneAppList'
import { useAchievements, ACHIEVEMENTS } from './achievements'
import { todayKey } from './career'
import { NAMMA_SPOTS, useDiscovery } from './discovery'
import { useFamily } from './family'
import { UPGRADES, UPGRADE_KINDS } from './garage'
import { useGameStore } from './gameStore'
import { inFirstOrder } from './firstOrder'
import { levelFromXp, unlocksBetween } from './progression'
import { saveKey } from './saveKeys'
import { CHALLENGE_BONUS, challengeFor, useToday } from './today'
import { fuelLevel, useUpkeep } from './upkeep'

/*
 * Reasons to open the phone. It has eleven apps, and a rider who never looks finds none of them:
 * the only thing that ever called them to it was a message. So the apps speak up, as a real
 * phone's do: each sends a notification at the moment it has something worth opening it for (the
 * first pay in the Wallet, an upgrade that can now be afforded in the Garage, a petrol bunk on Maps
 * when the tank is low, today's challenge in the Deliver It app), which shows above the phone like
 * a message, opens that app when clicked, and leaves a badge on the app's icon until it's opened.
 *
 * Each is sent once (`sent`), one at a time and spaced out (`PACE`), never over an order offer or
 * a hand-over. Kept on this device, apart from the main save.
 */

export type AppNote = { id: number; app: AppId; text: string }

/** No two closer than `gap` ms; the queue is looked at every `look` ms; a note not yet due waits no longer than the queue holds (`most`). */
const PACE = { gap: 40000, look: 4000, most: 4 }
/** The tank is low under this share; the radio is suggested this long into a ride (ms); and the camera at this hour. */
const LOW_TANK = 0.3
const RADIO_AFTER = 100000
const CAMERA_HOUR = '17:'

type AppNotes = {
  /** The notes already sent, by key: each is said once. */
  sent: Record<string, true>
  /** How many unseen notes each app has: the badge on its icon. */
  pending: Partial<Record<AppId, number>>
  /** The note to show now; Phone.tsx shows each new one. */
  latest: AppNote | null
  /** Queues a note for an app, unless that key has been sent before. */
  notify: (key: string, app: AppId, text: string) => void
  /** The app has been opened: its badge goes. */
  opened: (app: AppId) => void
}

let nextId = 1
const queue: { key: string; app: AppId; text: string }[] = []
let lastShown = 0

export const useAppNotes = create<AppNotes>()(
  persist(
    (set, get) => ({
      sent: {},
      pending: {},
      latest: null,
      notify: (key, app, text) => {
        if (get().sent[key] || queue.some((waiting) => waiting.key === key)) return
        queue.push({ key, app, text })
        if (queue.length > PACE.most) queue.shift()
      },
      opened: (app) => {
        if (get().pending[app]) set((state) => ({ pending: { ...state.pending, [app]: 0 } }))
      },
    }),
    { name: saveKey('swalpa-fast-app-notes'), version: 1, partialize: (state) => ({ sent: state.sent, pending: state.pending }) },
  ),
)

// One at a time, spaced out, and not while an order is being offered or handed over.
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    const game = useGameStore.getState()
    if (queue.length === 0 || !game.started || game.photoMode || game.offer || game.phase === 'handingOver' || game.phase === 'collecting') return
    // Not during the tutorial: the apps' own news waits until the first delivery is done.
    if (inFirstOrder()) return
    if (performance.now() - lastShown < PACE.gap && lastShown > 0) return
    const next = queue.shift()
    if (!next) return
    lastShown = performance.now()
    useAppNotes.setState((state) => ({
      sent: { ...state.sent, [next.key]: true },
      pending: { ...state.pending, [next.app]: (state.pending[next.app] ?? 0) + 1 },
      latest: { id: nextId++, app: next.app, text: next.text },
    }))
  }, PACE.look)
}

const notify = (key: string, app: AppId, text: string) => useAppNotes.getState().notify(key, app, text)
const cheapestUpgrade = Math.min(...UPGRADE_KINDS.map((kind) => UPGRADES[kind].prices[0]))

// What happens in the game that an app has something to say about.
useGameStore.subscribe((state, previous) => {
  if (state.explore) return
  // The first pay, and what the wallet is for.
  if (state.history.length > 0 && previous.history.length === 0) notify('wallet-first', 'wallet', 'Your first pay is in. See what came in, and where it goes.')
  if (state.history.length >= 2 && previous.history.length < 2 && useFamily.getState().introduced) notify('wallet-home', 'wallet', 'You can send money home from the Wallet: Kavya’s college fund.')
  // An upgrade within reach.
  if (state.credits >= cheapestUpgrade && previous.credits < cheapestUpgrade && state.history.length > 0) notify('garage-afford', 'garage', `You can afford your first upgrade: from ₹${cheapestUpgrade}. Ride to a dark store to fit it.`)
  // A new level: what it opened.
  const level = levelFromXp(state.xp)
  const before = levelFromXp(previous.xp)
  if (level > before) {
    const unlocks = unlocksBetween(before, level)
    if (unlocks.length > 0) notify(`level-${level}`, 'garage', `Level ${level}: ${unlocks.join(', ')}.`)
    if (level === 2) notify('gaadigo-level', 'gaadigo', 'Bigger orders need a bigger vehicle. Rent one by the hour on GaadiGo.')
  }
  // Going online: today's challenge.
  if (state.duty === 'online' && previous.duty !== 'online') {
    const date = todayKey()
    const stats = useToday.getState().stats
    if (!(stats.date === date && stats.paid)) notify(`challenge-${date}`, 'deliver', `Today’s challenge: ${challengeFor(date).text}. ₹${CHALLENGE_BONUS} if you do it.`)
  }
  // Golden hour, once: the camera.
  if (state.skyTime !== previous.skyTime && state.skyTime.startsWith(CAMERA_HOUR) && state.weather === 'clear') notify('camera-golden', 'camera', 'Golden hour over HSR. Your phone has a camera.')
  // A while into the first ride: the radio.
  if (state.started && !previous.started) window.setTimeout(() => notify('radio-first', 'music', 'A long ride ahead? Pick a station.'), RADIO_AFTER)
})

// A low tank: the bunks are on the map.
useUpkeep.subscribe((state, previous) => {
  const game = useGameStore.getState()
  if (game.explore) return
  const level = fuelLevel(state.fuel, game.vehicleId)
  if (level < LOW_TANK && fuelLevel(previous.fuel, game.vehicleId) >= LOW_TANK) notify(`maps-fuel-${game.day}`, 'maps', 'The tank is getting low. Petrol bunks and chargers are on the map.')
})

// The first spot found, and the first award.
useDiscovery.subscribe((state, previous) => {
  const found = Object.keys(state.found).length
  if (found > 0 && Object.keys(previous.found).length === 0) notify('spots-first', 'spots', `You found your first Namma spot. ${NAMMA_SPOTS.length - found} more are out there.`)
})
useAchievements.subscribe((state, previous) => {
  const earned = Object.keys(state.unlocked).length
  if (earned > 0 && Object.keys(previous.unlocked).length === 0) notify('awards-first', 'awards', `Your first award. ${ACHIEVEMENTS.length - earned} more to earn.`)
})

// Debug: the apps' notifications, for scripts (with ?debug).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  ;(window as unknown as { __deliverItAppNotes?: typeof useAppNotes }).__deliverItAppNotes = useAppNotes
}
