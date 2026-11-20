import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { playPing } from '../audio/uiSounds'
import { NAMMA_SPOTS, useDiscovery } from './discovery'
import { FUND_GOALS, useFamily } from './family'
import { useGameStore } from './gameStore'
import { liveSky } from './livePlayer'
import { RUSH_ON, rushHour } from './rush'
import { saveKey } from './saveKeys'

/*
 * Achievements: things worth remembering having done. Each unlocks once, with a card on screen and
 * a line in the phone's Awards app; nothing is paid for them. Watched from here: this file listens
 * to the game (deliveries, the weather, the hour), the Namma spots and the family's fund.
 */

export type AchievementId = 'first' | 'regular' | 'century' | 'rain' | 'night' | 'rush' | 'agara' | 'guard' | 'cold' | 'books' | 'fees' | 'spots'

export const ACHIEVEMENTS: { id: AchievementId; name: string; how: string }[] = [
  { id: 'first', name: 'First order', how: 'Deliver your first order.' },
  { id: 'regular', name: 'Regular', how: 'Deliver 10 orders.' },
  { id: 'century', name: 'Century', how: 'Deliver 100 orders.' },
  { id: 'rain', name: 'First rainy shift', how: 'Deliver an order in the rain.' },
  { id: 'night', name: 'Night owl', how: 'Deliver an order between 11 at night and 4 in the morning.' },
  { id: 'rush', name: 'Perfect rush hour', how: 'In one rush hour, three orders in a row: on time, five stars, no crashes.' },
  { id: 'agara', name: 'The Agara view', how: 'See the Anjaneya statue from up on the Agara flyover.' },
  { id: 'guard', name: 'Signed in', how: 'Deliver to a flat in the gated society.' },
  { id: 'cold', name: 'Cold chain', how: 'Deliver ice cream still more than 90% frozen, by day.' },
  { id: 'books', name: 'Books for Kavya', how: 'Reach the first goal of your sister’s college fund.' },
  { id: 'fees', name: 'Every fee paid', how: 'Reach the last goal of the college fund.' },
  { id: 'spots', name: 'Namma ooru', how: 'Find every Namma spot.' },
]

type Achievements = {
  /** Which are unlocked, and on which game day. */
  unlocked: Partial<Record<AchievementId, number>>
  /** Orders delivered in all, and the run of perfect ones in the current rush hour. */
  deliveries: number
  rushRun: number
  unlock: (id: AchievementId) => void
}

export const useAchievements = create<Achievements>()(
  persist(
    (set, get) => ({
      unlocked: {},
      deliveries: 0,
      rushRun: 0,
      unlock: (id) => {
        if (get().unlocked[id] !== undefined) return
        set({ unlocked: { ...get().unlocked, [id]: useGameStore.getState().day } })
        const achievement = ACHIEVEMENTS.find((one) => one.id === id)
        // After whatever card the moment itself shows (a result, a Namma spot).
        window.setTimeout(() => {
          useDiscovery.getState().showCard(`Achievement: ${achievement?.name ?? ''}`, 'In Awards, on your phone.')
          playPing('offer')
        }, 2600)
      },
    }),
    { name: saveKey('swalpa-fast-awards'), version: 1, partialize: (state) => ({ unlocked: state.unlocked, deliveries: state.deliveries, rushRun: state.rushRun }) },
  ),
)

// Deliveries: counted, and looked at for how and when they were made.
useGameStore.subscribe((state, previous) => {
  if (state.history === previous.history || state.history.length === 0 || state.history[0] === previous.history[0]) return
  const { unlock } = useAchievements.getState()
  const deliveries = useAchievements.getState().deliveries + 1
  const reward = state.lastReward
  const order = previous.mission
  // A run of perfect orders inside one rush hour.
  const inRush = rushHour(liveSky.hours) > RUSH_ON
  const perfect = reward !== null && reward.onTime && reward.stars === 5 && reward.crashes === 0
  const rushRun = inRush && perfect ? useAchievements.getState().rushRun + 1 : 0
  useAchievements.setState({ deliveries, rushRun })
  unlock('first')
  if (deliveries >= 10) unlock('regular')
  if (deliveries >= 100) unlock('century')
  if (state.weather === 'rain' || liveSky.rain > 0.3) unlock('rain')
  if (liveSky.hours >= 23 || liveSky.hours < 4) unlock('night')
  if (rushRun >= 3) unlock('rush')
  if (order?.door.kind === 'society') unlock('guard')
  if (order?.story.cargo === 'frozen' && previous.condition >= 0.9 && liveSky.look.night < 0.3) unlock('cold')
})

// The Agara view and the full collection, from the Namma spots.
useDiscovery.subscribe((state) => {
  if (state.found.statue) useAchievements.getState().unlock('agara')
  if (NAMMA_SPOTS.every(({ id }) => state.found[id])) useAchievements.getState().unlock('spots')
})

// The college fund's first and last goals.
useFamily.subscribe((state) => {
  if (state.saved >= FUND_GOALS[0].at) useAchievements.getState().unlock('books')
  if (state.saved >= FUND_GOALS[FUND_GOALS.length - 1].at) useAchievements.getState().unlock('fees')
})

// Debug: the awards, for scripts (with ?debug).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  ;(window as unknown as { __deliverItAwards?: typeof useAchievements }).__deliverItAwards = useAchievements
}
