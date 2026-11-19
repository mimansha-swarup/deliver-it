import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { todayKey } from './career'
import { useGameStore } from './gameStore'
import { livePlayer } from './livePlayer'
import { saveKey } from './saveKeys'

/*
 * Today, as the daily challenge and its score card see it: one headline challenge a day (the same
 * for everyone that day, like the three quiet daily goals in career.ts), what the rider has done
 * since midnight, and the route they've ridden, for the card's map. Kept on this device; a new
 * calendar day starts it afresh.
 */

export type TodayStats = {
  date: string
  orders: number
  earnings: number
  ratings: number[]
  crashes: number
  /** Orders in a row with no crash, on time, and five-starred: now, and the day's best of each. */
  cleanRun: number
  bestClean: number
  onTimeRun: number
  bestOnTime: number
  starRun: number
  bestStars: number
  metres: number
  /** Where the rider has been, as x, z, x, z…: a point every few seconds, the oldest dropped. */
  route: number[]
  /** The challenge's bonus has been paid. */
  paid: boolean
}

export type Challenge = { id: string; text: string; target: number; progress: (stats: TodayStats) => number; unit: string }

/** The headline challenges: one is the day's, picked by the date. */
export const CHALLENGES: Challenge[] = [
  { id: 'clean5', text: '5 orders in a row, no crashes', target: 5, progress: (stats) => stats.bestClean, unit: 'clean orders' },
  { id: 'ontime4', text: '4 orders in a row, every one on time', target: 4, progress: (stats) => stats.bestOnTime, unit: 'on time' },
  { id: 'stars3', text: '3 five-star deliveries in a row', target: 3, progress: (stats) => stats.bestStars, unit: 'five-stars' },
  { id: 'earn600', text: 'Earn ₹600 in a day', target: 600, progress: (stats) => stats.earnings, unit: 'earned' },
  { id: 'six', text: '6 orders in a day', target: 6, progress: (stats) => stats.orders, unit: 'orders' },
  { id: 'far', text: 'Ride 8 km and deliver 3 orders', target: 8, progress: (stats) => (stats.orders >= 3 ? stats.metres / 1000 : Math.min(7.9, stats.metres / 1000)), unit: 'km' },
]

export const CHALLENGE_BONUS = 200
const ROUTE_POINTS = 700
const ROUTE_EVERY_MS = 3000

/** The day's challenge: the same one all day, for everyone, from the date. */
export function challengeFor(date: string): Challenge {
  let sum = 0
  for (const character of date) sum = (sum * 31 + character.charCodeAt(0)) >>> 0
  return CHALLENGES[sum % CHALLENGES.length]
}

const fresh = (date: string): TodayStats => ({ date, orders: 0, earnings: 0, ratings: [], crashes: 0, cleanRun: 0, bestClean: 0, onTimeRun: 0, bestOnTime: 0, starRun: 0, bestStars: 0, metres: 0, route: [], paid: false })

type Today = { stats: TodayStats; delivered: (order: { earned: number; stars: number; crashes: number; onTime: boolean }) => void; moved: (x: number, z: number) => void }

export const useToday = create<Today>()(
  persist(
    (set, get) => {
      /** Today's stats, started afresh if the date has changed. */
      const current = (): TodayStats => (get().stats.date === todayKey() ? get().stats : fresh(todayKey()))
      return {
        stats: fresh(todayKey()),
        delivered: ({ earned, stars, crashes, onTime }) => {
          const before = current()
          const cleanRun = crashes === 0 ? before.cleanRun + 1 : 0
          const onTimeRun = onTime ? before.onTimeRun + 1 : 0
          const starRun = stars === 5 ? before.starRun + 1 : 0
          const stats: TodayStats = {
            ...before,
            orders: before.orders + 1,
            earnings: before.earnings + earned,
            ratings: [...before.ratings, stars],
            crashes: before.crashes + crashes,
            cleanRun,
            bestClean: Math.max(before.bestClean, cleanRun),
            onTimeRun,
            bestOnTime: Math.max(before.bestOnTime, onTimeRun),
            starRun,
            bestStars: Math.max(before.bestStars, starRun),
          }
          // The challenge met: its bonus, once.
          const challenge = challengeFor(stats.date)
          if (!stats.paid && challenge.progress(stats) >= challenge.target) {
            stats.paid = true
            window.setTimeout(() => {
              useGameStore.setState((state) => ({ credits: state.credits + CHALLENGE_BONUS }))
              useGameStore.getState().raviSays(`Daily challenge done: ${challenge.text}! +${CHALLENGE_BONUS} credits. Your score card is in the Deliver It app: share maadi!`)
            }, 2500)
          }
          set({ stats })
        },
        moved: (x, z) => {
          const before = current()
          const route = before.route
          const lastX = route[route.length - 2]
          const lastZ = route[route.length - 1]
          const step = route.length >= 2 ? Math.hypot(x - lastX, z - lastZ) : 0
          // Standing still adds nothing; a jump (a debug teleport) isn't riding.
          if (route.length >= 2 && step < 6) return
          const next = [...route, Math.round(x), Math.round(z)].slice(-ROUTE_POINTS * 2)
          set({ stats: { ...before, route: next, metres: before.metres + (step < 250 ? step : 0) } })
        },
      }
    },
    { name: saveKey('deliver-it-today'), version: 1, partialize: (state) => ({ stats: state.stats }) },
  ),
)

// Each delivery counts, with what it paid and how it went.
useGameStore.subscribe((state, previous) => {
  if (state.history === previous.history || state.history.length === 0 || state.history[0] === previous.history[0]) return
  const record = state.history[0]
  const reward = state.lastReward
  useToday.getState().delivered({ earned: record.earned, stars: record.stars, crashes: reward?.crashes ?? 0, onTime: reward?.onTime ?? true })
})

// Where the rider goes, a point every few seconds while riding.
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    const game = useGameStore.getState()
    if (game.started && !game.photoMode && !livePlayer.indoors) useToday.getState().moved(livePlayer.x, livePlayer.z)
  }, ROUTE_EVERY_MS)
}
