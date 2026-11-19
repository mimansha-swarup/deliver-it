import { create } from 'zustand'
import { saveKey } from './saveKeys'

/*
 * Discovery: the card that names an area as the rider arrives, and the "Namma spots" (our spots):
 * views worth finding, ticked off in the phone once seen. Which spots are found is kept on this
 * device (localStorage), apart from the save.
 */

export type SpotId = 'statue' | 'lake' | 'temple' | 'busstand' | 'metro' | 'shops' | 'adda' | 'society'

/** `how`: the hint while it's unfound. `found`: what the phone says once it is. */
export const NAMMA_SPOTS: { id: SpotId; name: string; how: string; found: string }[] = [
  { id: 'statue', name: 'Anjaneya from the flyover', how: 'Ride over the Agara flyover on Outer Ring Road: he stands above the rooftops.', found: 'The whole of Agara under you, and Anjaneya above it all.' },
  { id: 'lake', name: 'Agara Lake at sunset', how: 'Be on the lake shore between 5 and 7 in the evening, when the sun lies on the water.', found: 'Coots on gold water, and the city gone quiet for a minute.' },
  { id: 'temple', name: 'The temple at night', how: 'Visit the Anjaneya or the Jagannath temple after dark, when they are floodlit.', found: 'Floodlit against the dark, bells carrying down the road.' },
  { id: 'busstand', name: 'HSR bus stand', how: 'Find the bus stand, where half of HSR starts its day.', found: 'Buses nosing in and out, and tea being sold to everyone waiting.' },
  { id: 'metro', name: 'Under the metro', how: 'Stand under a metro station on the viaduct.', found: 'The whole street hums when a train crosses.' },
  { id: 'shops', name: 'The shop street after dark', how: 'Ride a busy shop street once the lights and signboards are on.', found: 'Every signboard lit, in two languages, all the way down.' },
  { id: 'adda', name: 'Your adda', how: 'Walk into a chai stall or a darshini and eat something.', found: 'The first of many chais. They know your order now.' },
  { id: 'society', name: 'Past the guard', how: 'Deliver to Sampige Residency: OTP, register and all.', found: 'Signed in, in your best handwriting.' },
]

/** Where the spots that are simply places are, for finding them by being there. The world fills these in (World.tsx). */
export const spotPlaces: { busstand: { x: number; z: number } | null; metro: { x: number; z: number }[] } = { busstand: null, metro: [] }

const KEY = saveKey('deliver-it-spots')

function load(): Record<SpotId, boolean> {
  const none: Record<SpotId, boolean> = { statue: false, lake: false, temple: false, busstand: false, metro: false, shops: false, adda: false, society: false }
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
  /** The card on screen now, if any, and those waiting their turn behind it (two things found at once each get shown). */
  card: Card | null
  waiting: Card[]
  showCard: (title: string, sub: string) => void
  clearCard: (id: number) => void
  /** Ticks a spot off. True the first time. */
  find: (id: SpotId) => boolean
}

let nextCard = 1

export const useDiscovery = create<Discovery>((set, get) => ({
  found: load(),
  card: null,
  waiting: [],
  showCard: (title, sub) =>
    set((state) => {
      const card = { title, sub, id: nextCard++ }
      return state.card ? { waiting: [...state.waiting, card].slice(-4) } : { card }
    }),
  clearCard: (id) => set((state) => (state.card?.id === id ? { card: state.waiting[0] ?? null, waiting: state.waiting.slice(1) } : state)),
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

/** Ticks a spot off and shows its title card, the first time. For spots found by doing something (eating, signing in) rather than by being somewhere. */
export function discover(id: SpotId) {
  const { find, showCard } = useDiscovery.getState()
  if (!find(id)) return
  const spot = NAMMA_SPOTS.find((candidate) => candidate.id === id)
  showCard(`Namma spot: ${spot?.name ?? ''}`, spot?.found ?? 'Ticked off in Namma spots, in your phone.')
}
