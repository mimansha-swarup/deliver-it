import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { tuning } from '../vehicle/tuning'
import { VEHICLES, type VehicleId, type VehicleSpec } from '../vehicle/vehicleCatalog'
import { useGameStore } from './gameStore'
import { saveKey } from './saveKeys'

/*
 * What a vehicle costs to keep running, as things the rider does rather than a silent deduction:
 *
 * - Fuel or charge: every vehicle but the bicycle has a tank (or a battery) that empties with the
 *   kilometres. Petrol and diesel are filled at any petrol bunk's pumps; electrics charge at the
 *   bunks' EV chargers, and overnight at home. Empty, it crawls.
 * - Servicing: due every so many kilometres, done at the Garage at the dark store. Overdue, it's a
 *   little slower and far likelier to break down (breakdowns.ts).
 *
 * Each has its notifications: low, empty, due, overdue. Kept on this device with the fleet's save.
 */

export type Energy = 'petrol' | 'charge' | 'none'

/** What a vehicle runs on. */
export function energyOf(spec: VehicleSpec): Energy {
  if (spec.costPerKm === 0) return 'none'
  return spec.drive.startsWith('Electric') ? 'charge' : 'petrol'
}

export const UPKEEP = {
  /** Kilometres on a full tank or charge. */
  rangeKm: { scooter: 12, bicycle: Infinity, ev: 9, bike: 13, trike: 9, car: 15, van: 13 } as Record<VehicleId, number>,
  /** Rupees for each kilometre's worth put back in: the vehicle's running cost (vehicleCatalog.ts) times this. */
  priceScale: 3,
  /** Below this share of a tank, a warning; a full tank takes this long to fill (seconds), a battery this long. */
  lowAt: 0.2,
  fillSeconds: { petrol: 2.2, charge: 6 },
  /** With nothing in it, the top speed is this share of its own. */
  emptyCrawl: 0.22,
  /** A service is due after this many kilometres, overdue after this many; overdue costs this share of top speed. */
  serviceEveryKm: 18,
  overdueKm: 27,
  overdueSpeed: 0.93,
  /** What a service costs, by vehicle. */
  serviceCost: { scooter: 120, bicycle: 40, ev: 100, bike: 160, trike: 220, car: 320, van: 420 } as Record<VehicleId, number>,
  /** Out of fuel on the road: this much (a share of a tank) brought to the rider, for this much. */
  rescue: { share: 0.25, price: 90 },
}

type Upkeep = {
  /** How full each vehicle's tank or battery is, 0 to 1 (full if not listed). */
  fuel: Partial<Record<VehicleId, number>>
  /** Kilometres since each vehicle's last service. */
  sinceService: Partial<Record<VehicleId, number>>
  /** A fill in progress: the level it's rising to, and how fast (shares a second). */
  filling: { id: VehicleId; to: number; rate: number } | null
  /** Counts the metres just ridden: empties the tank, adds to the service clock, and says what needs saying. */
  drive: (id: VehicleId, metres: number, seconds: number) => void
  /** Fills up (as much as the wallet allows). The reason it can't, or null once paid for. */
  fill: (id: VehicleId) => string | null
  rescue: (id: VehicleId) => string | null
  service: (id: VehicleId) => string | null
  /** A night at home: every electric the rider has is charged. */
  overnight: () => void
}

const game = () => useGameStore.getState()
/** Which warnings have been given since the tank was last filled, or the service last done: not saved, so a new visit reminds once. */
const told = new Set<string>()

export const fuelLevel = (fuel: Upkeep['fuel'], id: VehicleId) => fuel[id] ?? 1
export const fullPrice = (spec: VehicleSpec) => Math.ceil(UPKEEP.rangeKm[spec.id] * spec.costPerKm * UPKEEP.priceScale)
/** What filling from this level costs. */
export const fillPrice = (spec: VehicleSpec, level: number) => Math.ceil((1 - level) * fullPrice(spec))
export type ServiceState = 'ok' | 'due' | 'overdue'
export const serviceState = (km: number): ServiceState => (km >= UPKEEP.overdueKm ? 'overdue' : km >= UPKEEP.serviceEveryKm ? 'due' : 'ok')

/** Sets what the upkeep does to the handling: an empty tank crawls, an overdue service is a little slow. */
function applyToHandling(state: Pick<Upkeep, 'fuel' | 'sinceService'>, id: VehicleId) {
  const spec = VEHICLES[id]
  const empty = energyOf(spec) !== 'none' && fuelLevel(state.fuel, id) <= 0
  tuning.limp = empty ? UPKEEP.emptyCrawl : serviceState(state.sinceService[id] ?? 0) === 'overdue' ? UPKEEP.overdueSpeed : 1
}

export const useUpkeep = create<Upkeep>()(
  persist(
    (set, get) => ({
      fuel: {},
      sinceService: {},
      filling: null,

      drive: (id, metres, seconds) => {
        const spec = VEHICLES[id]
        const state = get()
        const energy = energyOf(spec)
        const km = metres / 1000
        let level = fuelLevel(state.fuel, id)
        // A fill in progress rises to its mark.
        let { filling } = state
        if (filling?.id === id) {
          level = Math.min(filling.to, level + filling.rate * seconds)
          if (level >= filling.to) filling = null
        } else if (filling) filling = null
        const before = level
        if (energy !== 'none' && km > 0) level = Math.max(0, level - km / UPKEEP.rangeKm[id])
        const sinceService = (state.sinceService[id] ?? 0) + km
        const what = energy === 'charge' ? 'charge' : 'petrol'
        const where = energy === 'charge' ? 'an EV charger (at the petrol bunks)' : 'a petrol bunk'
        if (energy !== 'none') {
          if (level <= 0 && before > 0) game().raviSays(`Out of ${what}! The ${spec.name} can only crawl. Get to ${where}, or call for a top-up from the prompt.`)
          else if (level < UPKEEP.lowAt && !told.has(`low ${id}`)) {
            told.add(`low ${id}`)
            game().raviSays(`${energy === 'charge' ? 'Battery' : 'Petrol'} is low on the ${spec.name}: ${Math.round(level * 100)}% left. Stop at ${where}; they're on your map.`)
          }
        }
        const service = serviceState(sinceService)
        if (service !== 'ok' && !told.has(`${service} ${id}`)) {
          told.add(`${service} ${id}`)
          game().raviSays(
            service === 'due'
              ? `The ${spec.name} is due a service (${Math.round(sinceService)} km). Garage at the dark store: ₹${UPKEEP.serviceCost[id]}.`
              : `The ${spec.name}'s service is overdue. It's running rough and it will break down on you. Garage at the dark store, maga!`,
          )
        }
        if (level !== fuelLevel(state.fuel, id) || km > 0 || filling !== state.filling) {
          const next = { fuel: { ...state.fuel, [id]: level }, sinceService: { ...state.sinceService, [id]: sinceService }, filling }
          set(next)
          applyToHandling(next, id)
        }
      },

      fill: (id) => {
        const spec = VEHICLES[id]
        const energy = energyOf(spec)
        if (energy === 'none') return 'Nothing to fill: it runs on dosas.'
        const level = fuelLevel(get().fuel, id)
        if (level > 0.97) return 'Already full.'
        const credits = game().credits
        const full = fullPrice(spec)
        // As much as the wallet covers.
        const share = Math.min(1 - level, credits / full)
        if (share < 0.03) return 'Not enough in the wallet.'
        const price = Math.min(credits, Math.ceil(share * full))
        game().spend(`${energy === 'charge' ? 'Charging' : spec.drive.startsWith('Diesel') ? 'Diesel' : 'Petrol'} · ${spec.name}`, price)
        told.delete(`low ${id}`)
        set({ filling: { id, to: Math.min(1, level + share), rate: 1 / UPKEEP.fillSeconds[energy] } })
        return null
      },

      rescue: (id) => {
        const spec = VEHICLES[id]
        if (fuelLevel(get().fuel, id) > 0) return 'There is still some in it.'
        if (!game().spend(`Roadside top-up · ${spec.name}`, UPKEEP.rescue.price)) return `A roadside top-up is ₹${UPKEEP.rescue.price}: not enough in the wallet.`
        const next = { fuel: { ...get().fuel, [id]: UPKEEP.rescue.share }, sinceService: get().sinceService }
        set({ fuel: next.fuel })
        applyToHandling(next, id)
        game().raviSays(`A boy from the bunk brought a can: ${Math.round(UPKEEP.rescue.share * 100)}% in the ${spec.name}, ₹${UPKEEP.rescue.price}. Fill up properly now.`)
        return null
      },

      service: (id) => {
        const spec = VEHICLES[id]
        const price = UPKEEP.serviceCost[id]
        if (!game().spend(`Service · ${spec.name}`, price)) return 'Not enough in the wallet.'
        told.delete(`due ${id}`)
        told.delete(`overdue ${id}`)
        const next = { fuel: get().fuel, sinceService: { ...get().sinceService, [id]: 0 } }
        set({ sinceService: next.sinceService })
        applyToHandling(next, id)
        game().raviSays(`${spec.name} serviced: ${energyOf(spec) === 'petrol' ? 'oil, plugs, ' : ''}brakes, tyres, cables, air. ₹${price}. Good for another ${UPKEEP.serviceEveryKm} km.`)
        return null
      },

      overnight: () => {
        const fuel = { ...get().fuel }
        let charged = false
        for (const id of Object.keys(VEHICLES) as VehicleId[]) {
          if (energyOf(VEHICLES[id]) === 'charge' && fuelLevel(fuel, id) < 1) {
            fuel[id] = 1
            charged = true
          }
        }
        if (!charged) return
        set({ fuel })
        applyToHandling({ fuel, sinceService: get().sinceService }, game().vehicleId)
      },
    }),
    { name: saveKey('deliver-it-upkeep'), version: 1, partialize: (state) => ({ fuel: state.fuel, sinceService: state.sinceService }) },
  ),
)

// The handling follows the vehicle in use: now, and whenever it changes.
applyToHandling(useUpkeep.getState(), useGameStore.getState().vehicleId)
useGameStore.subscribe((state, previous) => {
  if (state.vehicleId !== previous.vehicleId) applyToHandling(useUpkeep.getState(), state.vehicleId)
})

// Debug: the upkeep, for scripts (with ?debug).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  ;(window as unknown as { __deliverItUpkeep?: typeof useUpkeep }).__deliverItUpkeep = useUpkeep
}
