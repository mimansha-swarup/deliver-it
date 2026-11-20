import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { tuning } from '../vehicle/tuning'
import { liveVehicle, VEHICLES, type VehicleId, type VehicleSpec } from '../vehicle/vehicleCatalog'
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
 * - Breakdowns: rare, and far likelier with the service overdue. A roadside mechanic mends it where it
 *   stands, or GaadiGo brings a rental and the broken one is towed to the Garage (ui/BreakdownCard.tsx).
 *
 * Each has its notifications: low, empty, due, overdue, broken down. Kept on this device with the fleet's save.
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
  /** With no money at the pump and less than this in the tank, this much is filled on Ravi's tab (the safety net: gameStore's `dues`). */
  advanceBelow: 0.15,
  advanceFill: 0.3,
  /**
   * Breakdowns: the chance of one in each kilometre, by how the servicing stands (rare when it's kept
   * up: about one in 250 km; overdue, about one in 11). Never in the first kilometres, nor soon after
   * the last. A roadside mechanic fixes it where it stands for a price, in a few seconds.
   */
  breakdownPerKm: { ok: 0.004, due: 0.02, overdue: 0.09 },
  breakdownFreeKm: 1.5,
  mechanic: { price: 180, seconds: 4 },
  /** Towed to the Garage and mended there, when a rental is taken instead. */
  tow: 150,
}

/** What goes wrong, by what the vehicle runs on. */
const FAULTS: Record<Energy, string[]> = {
  petrol: ['a puncture in the back tyre', 'a fouled spark plug', 'a snapped clutch cable', 'a choked fuel line'],
  charge: ['a puncture in the back tyre', 'a controller fault', 'a loose battery connector'],
  none: ['a puncture', 'a snapped chain', 'a jammed brake'],
}

type Upkeep = {
  /** How full each vehicle's tank or battery is, 0 to 1 (full if not listed). */
  fuel: Partial<Record<VehicleId, number>>
  /** Kilometres since each vehicle's last service. */
  sinceService: Partial<Record<VehicleId, number>>
  /** A fill in progress: the level it's rising to, and how fast (shares a second). */
  filling: { id: VehicleId; to: number; rate: number } | null
  /** The vehicle that has broken down and what's wrong with it, until it's mended; `mending`: a mechanic is at it. */
  broken: { id: VehicleId; fault: string; mending: boolean } | null
  /** Kilometres ridden since the last breakdown (or ever). */
  sinceBreakdown: number
  /** Calls the roadside mechanic: paid now, mended in a few seconds. The reason it can't, or null. */
  callMechanic: () => string | null
  /** Mended without the mechanic: towed to the Garage as a rental takes its place (`charge`), or by the rental company. */
  mend: (charge: number, word: string) => void
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
function applyToHandling(state: Pick<Upkeep, 'fuel' | 'sinceService' | 'broken'>, id: VehicleId) {
  // A borrowed vehicle isn't the rider's to fuel or service: it simply runs.
  if (liveVehicle.spec.borrowed) {
    tuning.limp = 1
    return
  }
  const spec = VEHICLES[id]
  const empty = energyOf(spec) !== 'none' && fuelLevel(state.fuel, id) <= 0
  // Broken down, it doesn't go at all.
  tuning.limp = state.broken?.id === id ? 0 : empty ? UPKEEP.emptyCrawl : serviceState(state.sinceService[id] ?? 0) === 'overdue' ? UPKEEP.overdueSpeed : 1
}

export const useUpkeep = create<Upkeep>()(
  persist(
    (set, get) => ({
      fuel: {},
      sinceService: {},
      filling: null,
      broken: null,
      sinceBreakdown: 0,

      callMechanic: () => {
        const broken = get().broken
        if (!broken || broken.mending) return null
        // Never refused for want of money: what the wallet can't pay goes on Ravi's tab (gameStore's `dues`).
        game().payEssential(`Roadside mechanic · ${VEHICLES[broken.id].name}`, UPKEEP.mechanic.price)
        set({ broken: { ...broken, mending: true } })
        game().raviSays(`A mechanic is on his way to your ${VEHICLES[broken.id].name}: ${broken.fault}. ₹${UPKEEP.mechanic.price}. Stay with it.`)
        window.setTimeout(() => {
          if (!get().broken?.mending) return
          get().mend(0, 'The mechanic has it running again')
        }, UPKEEP.mechanic.seconds * 1000)
        return null
      },

      mend: (charge, word) => {
        const broken = get().broken
        if (!broken) return
        if (charge > 0) game().fine(`Tow and repair · ${VEHICLES[broken.id].name}`, charge, '')
        const next = { fuel: get().fuel, sinceService: get().sinceService, broken: null }
        set({ broken: null, sinceBreakdown: 0 })
        applyToHandling(next, game().vehicleId)
        const overdue = serviceState(get().sinceService[broken.id] ?? 0) !== 'ok'
        game().raviSays(`${word}: the ${VEHICLES[broken.id].name}${charge > 0 ? `, ₹${charge}` : ''}.${overdue ? ' Get it serviced, maga, or it will happen again.' : ''}`)
      },

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
        // Breakdowns: rare with the servicing kept up, likely with it overdue.
        let { broken } = state
        const sinceBreakdown = state.sinceBreakdown + km
        if (!broken && km > 0 && sinceBreakdown > UPKEEP.breakdownFreeKm && Math.random() < UPKEEP.breakdownPerKm[service] * km) {
          const faults = FAULTS[energy]
          broken = { id, fault: faults[Math.floor(Math.random() * faults.length)], mending: false }
          game().raviSays(`Breakdown! Your ${spec.name} has ${broken.fault}. Call the roadside mechanic (₹${UPKEEP.mechanic.price}), or rent from GaadiGo and it's towed to your Garage: both are on your screen.`)
        }
        if (level !== fuelLevel(state.fuel, id) || km > 0 || filling !== state.filling || broken !== state.broken) {
          const next = { fuel: { ...state.fuel, [id]: level }, sinceService: { ...state.sinceService, [id]: sinceService }, filling, broken, sinceBreakdown }
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
        const what = `${energy === 'charge' ? 'Charging' : spec.drive.startsWith('Diesel') ? 'Diesel' : 'Petrol'} · ${spec.name}`
        if (share < 0.03) {
          // Broke at the pump with the tank nearly dry: enough to work on, on Ravi's tab. With fuel still in it, come back with money.
          if (level >= UPKEEP.advanceBelow) return 'Not enough in the wallet.'
          const advance = Math.min(1 - level, UPKEEP.advanceFill)
          game().payEssential(what, Math.ceil(advance * full))
          told.delete(`low ${id}`)
          set({ filling: { id, to: Math.min(1, level + advance), rate: 1 / UPKEEP.fillSeconds[energy] } })
          return null
        }
        const price = Math.min(credits, Math.ceil(share * full))
        game().spend(what, price)
        told.delete(`low ${id}`)
        set({ filling: { id, to: Math.min(1, level + share), rate: 1 / UPKEEP.fillSeconds[energy] } })
        return null
      },

      rescue: (id) => {
        const spec = VEHICLES[id]
        if (fuelLevel(get().fuel, id) > 0) return 'There is still some in it.'
        game().payEssential(`Roadside top-up · ${spec.name}`, UPKEEP.rescue.price)
        const next = { fuel: { ...get().fuel, [id]: UPKEEP.rescue.share }, sinceService: get().sinceService, broken: get().broken }
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
        const next = { fuel: get().fuel, sinceService: { ...get().sinceService, [id]: 0 }, broken: get().broken }
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
        applyToHandling({ fuel, sinceService: get().sinceService, broken: get().broken }, game().vehicleId)
      },
    }),
    { name: saveKey('swalpa-fast-upkeep'), version: 1, partialize: (state) => ({ fuel: state.fuel, sinceService: state.sinceService, broken: state.broken ? { ...state.broken, mending: false } : null, sinceBreakdown: state.sinceBreakdown }) },
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

/** The handling's share of fuel and servicing, worked out again: after the vehicle in use changes hands (game/borrow.ts). */
export function refreshHandling() {
  applyToHandling(useUpkeep.getState(), useGameStore.getState().vehicleId)
}
