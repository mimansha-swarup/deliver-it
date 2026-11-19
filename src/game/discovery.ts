import { create } from 'zustand'

/*
 * Discovery: the card that names an area as the rider arrives, and the "Namma spots" (our spots):
 * views worth finding, ticked off in the phone once seen. Which spots are found is kept on this
 * device (localStorage), apart from the save.
 */

export type SpotId = 'statue' | 'lake' | 'temple'

export const NAMMA_SPOTS: { id: SpotId; name: string; how: string }[] = [
  { id: 'statue', name: 'Anjaneya from the flyover', how: 'Ride over the Agara flyover on Outer Ring Road: he stands above the rooftops.' },
  { id: 'lake', name: 'Agara Lake at sunset', how: 'Be on the lake shore between 5 and 7 in the evening, when the sun lies on the water.' },
  { id: 'temple', name: 'The temple at night', how: 'Visit the Anjaneya or the Jagannath temple after dark, when they are floodlit.' },
]

const KEY = 'deliver-it-spots'

function load(): Record<SpotId, boolean> {
  const none = { statue: false, lake: false, temple: false }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<SpotId, boolean>>
    return { ...none, ...saved }
  } catch {
    return none
  }
}

type Card = { title: string; sub: string; id: number }

type Discovery = {
  found: Record<SpotId, boolean>
  /** The card on screen now, if any. */
  card: Card | null
  showCard: (title: string, sub: string) => void
  clearCard: (id: number) => void
  /** Ticks a spot off. True the first time. */
  find: (id: SpotId) => boolean
}

let nextCard = 1

export const useDiscovery = create<Discovery>((set, get) => ({
  found: load(),
  card: null,
  showCard: (title, sub) => set({ card: { title, sub, id: nextCard++ } }),
  clearCard: (id) => set((state) => (state.card?.id === id ? { card: null } : state)),
  find: (id) => {
    if (get().found[id]) return false
    const found = { ...get().found, [id]: true }
    try {
      localStorage.setItem(KEY, JSON.stringify(found))
    } catch {
      // Private windows may refuse storage: the spot still counts for this session.
    }
    set({ found })
    return true
  },
}))
