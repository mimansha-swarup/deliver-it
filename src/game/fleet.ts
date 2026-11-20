import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { MARKET, VEHICLES, type OrderType, type VehicleId, type VehicleSpec, liveVehicle } from '../vehicle/vehicleCatalog'
import { orderRules } from '../missions/orderStory'
import { Surface, worldSurface } from '../world/surfaceMap'
import { orderGate, useGameStore } from './gameStore'
import { livePlayer, liveSky } from './livePlayer'
import { levelFromXp } from './progression'
import { saveKey } from './saveKeys'
import { UPKEEP, useUpkeep } from './upkeep'

/*
 * GaadiGo (a made-up vehicle marketplace): renting and buying the vehicles in vehicleCatalog.ts.
 *
 * - Rent by the game hour or the day, paid up front. End the rental in the app, parked: it's
 *   collected. Past its time, late fees. Damage (crashes while it was out) is charged unless
 *   the rental was insured.
 * - Buy outright, or a fifth down and the rest in eight weekly EMIs (a week is seven game days)
 *   from the wallet. Miss one: a warning. Miss the next: a recovery agent takes the vehicle.
 * - A vehicle comes by delivery to where the rider is (a small fee, one to three game minutes), or
 *   free at the hub (the home dark store). The vehicle swapped out goes to the Garage: owned ones
 *   wait there and can be taken out again; the rider's scooter is always there.
 *
 * Kept on this device, apart from the main save.
 */

export const FLEET_RULES = {
  deliveryFee: 40,
  /** Game minutes a delivery takes, at random between these. */
  deliveryMinutes: [1, 3] as [number, number],
  /** The rider must be this near the delivery (metres) and this slow (m/s) to take the handover. */
  handoverRange: 25,
  handoverSpeed: 1.5,
  /** The hub: within this far of the home dark store, in metres. */
  hubRange: 30,
  /** Insurance, as a share of the rental's price. */
  insuranceShare: 0.15,
  /** Each crash while a rental was out, uninsured. */
  damagePerCrash: 60,
  /** A late hour costs this many times the hourly rate. */
  lateRate: 1.5,
  /** Buying on EMI: this share down, the rest (plus interest) over this many weeks. */
  downShare: 0.2,
  emiWeeks: 8,
  emiInterest: 0.12,
  daysPerWeek: 7,
}

export type RentPlan = 'hour' | 'day'
/** `hoursLeft`: game hours of the rental still to run (negative once it's late). `crashes`: crashes while it's been out. */
export type Rental = { id: VehicleId; plan: RentPlan; insured: boolean; hoursLeft: number; crashes: number }
export type Emi = { id: VehicleId; weekly: number; weeksLeft: number; nextDueDay: number; missed: number }
/** A vehicle on its way to the rider, or waiting there for them: `rental` or `purchase` set once handed over. */
export type Delivery = {
  id: VehicleId
  /** Where it's brought to: beside where the rider was when they asked, and the way they faced. */
  x: number
  z: number
  dirX: number
  dirZ: number
  arrivesAt: number
  rental: Rental | null
  own: boolean
  /** Ridden up and standing there (FleetClock.tsx says so once its ride in is done). */
  here: boolean
  /** When the handover began (performance.now()), while the keys change hands; else null. */
  handing: number | null
}

/** The vehicle the rider was on, being ridden away to the Garage after a handover: from where, which way, since when. */
export type Leaving = { id: VehicleId; x: number; z: number; dirX: number; dirZ: number; since: number }

type Fleet = {
  /** Bought vehicles (the scooter isn't listed: it's always the rider's). */
  owned: VehicleId[]
  rental: Rental | null
  emis: Emi[]
  delivery: Delivery | null
  leaving: Leaving | null
  /** The delivery has been ridden up and is standing at its spot. */
  markHere: () => void
  /** The keys have changed hands: the rider is on the new vehicle, and the old one is ridden away. */
  completeHandover: () => void
  /** Metres ridden not yet charged as running cost. */
  uncharged: number
  rent: (id: VehicleId, plan: RentPlan, insured: boolean, how: 'deliver' | 'hub') => string | null
  buy: (id: VehicleId, mode: 'full' | 'emi', how: 'deliver' | 'hub') => string | null
  /** Takes an owned vehicle (or the scooter) out of the Garage. */
  takeOut: (id: VehicleId, how: 'deliver' | 'hub') => string | null
  endRental: () => string | null
  /** Every so often while riding: deliveries arriving, handovers, running costs, the rental's clock. `crashed`: crashes since the last tick. */
  tick: (speed: number, moved: number, crashed: number) => void
  /** On a new day: the week's EMIs. */
  newDay: (day: number) => void
}

export const weeklyEmi = (spec: VehicleSpec) => Math.ceil((spec.price * (1 - FLEET_RULES.downShare) * (1 + FLEET_RULES.emiInterest)) / FLEET_RULES.emiWeeks)
export const downPayment = (spec: VehicleSpec) => Math.round(spec.price * FLEET_RULES.downShare)
export const rentPrice = (spec: VehicleSpec, plan: RentPlan, insured: boolean) => {
  const base = plan === 'hour' ? spec.rentHour : spec.rentDay
  return base + (insured ? Math.round(base * FLEET_RULES.insuranceShare) : 0)
}

/** The rider's average rating over their recent deliveries, or 5 with none yet (nobody's turned away for being new). */
export function averageRating(): number {
  const { ratings } = useGameStore.getState()
  return ratings.length ? ratings.reduce((sum, stars) => sum + stars, 0) / ratings.length : 5
}

/** Why the rider can't have this vehicle yet, or null if they can. */
export function locked(spec: VehicleSpec): string | null {
  const level = levelFromXp(useGameStore.getState().xp)
  if (level < spec.minLevel) return `Needs level ${spec.minLevel} (you're level ${level})`
  if (spec.minRating > 0 && averageRating() < spec.minRating) return `Needs a ${spec.minRating.toFixed(1)}★ rating (yours is ${averageRating().toFixed(1)})`
  return null
}

/** Whether the rider is at the hub: the home dark store. */
export function atHub(): boolean {
  const store = useGameStore.getState().planner?.stores[0]
  return store !== undefined && Math.hypot(store.x - livePlayer.x, store.z - livePlayer.z) < FLEET_RULES.hubRange
}

/**
 * Where a delivery parks: on the road, at the kerb. Looking left of the rider first (traffic keeps
 * left, so that's the kerb side), the furthest out that's still road within a lane's width; then
 * right; then just behind or ahead; and, with the rider off the road altogether, the nearest road.
 */
function roadSpotNear(x: number, z: number, dirX: number, dirZ: number): [number, number] {
  const map = worldSurface.map
  if (!map) return [x + dirZ * 2.2, z - dirX * 2.2]
  const isRoad = (px: number, pz: number) => map.at(px, pz) === Surface.Road
  // Room for the vehicle's width: the spot and half a metre either side of it are all road.
  const fits = (px: number, pz: number) => isRoad(px, pz) && isRoad(px + dirZ * 0.5, pz - dirX * 0.5) && isRoad(px - dirZ * 0.5, pz + dirX * 0.5)
  for (const side of [1, -1]) {
    for (const out of [3.2, 2.6, 2.0, 1.5]) {
      const px = x + dirZ * out * side
      const pz = z - dirX * out * side
      if (fits(px, pz)) return [px, pz]
    }
  }
  for (const along of [-4, 5, -7, 8]) if (fits(x + dirX * along, z + dirZ * along)) return [x + dirX * along, z + dirZ * along]
  for (let reach = 3; reach <= 30; reach += 3) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2
      const px = x + Math.cos(angle) * reach
      const pz = z + Math.sin(angle) * reach
      if (fits(px, pz)) return [px, pz]
    }
  }
  return [x, z]
}

/** Whether the vehicle in use carries a kind of order. */
export function carries(type: OrderType): boolean {
  return (VEHICLES[useGameStore.getState().vehicleId] ?? VEHICLES.scooter).unlocks.includes(type)
}

/**
 * "Rent one for this order": the cheapest vehicle that carries it, for an hour, brought to the rider.
 * Null if it's on its way; else why not.
 */
export function rentFor(type: OrderType): string | null {
  const spec = cheapestFor(type)
  if (!spec) return 'Nothing you can rent carries this yet.'
  return useFleet.getState().rent(spec.id, 'hour', false, atHub() ? 'hub' : 'deliver')
}

/** The cheapest vehicle on the market, that the rider may have, which carries a kind of order. */
export function cheapestFor(type: OrderType): VehicleSpec | null {
  const fits = MARKET.map((id) => VEHICLES[id]).filter((spec) => spec.unlocks.includes(type) && locked(spec) === null)
  return fits.sort((a, b) => a.rentHour - b.rentHour)[0] ?? null
}

const game = () => useGameStore.getState()
const say = (text: string) => game().raviSays(text)

export const useFleet = create<Fleet>()(
  persist(
    (set, get) => {
      /** Hands a vehicle over now, or sends it to where the rider is. Null if sent or handed over; else why not. */
      // `free`: no delivery fee: one of the rider's own vehicles, brought out of their Garage.
      const dispatch = (id: VehicleId, how: 'deliver' | 'hub', rental: Rental | null, own: boolean, free = false): string | null => {
        if (how === 'hub') {
          if (!atHub()) return 'Free pickup is at the hub: ride to your dark store.'
          game().setVehicle(id)
          if (rental) set({ rental })
          if (own && id !== 'scooter' && !get().owned.includes(id)) set({ owned: [...get().owned, id] })
          return null
        }
        if (get().delivery) return 'A delivery is already on its way.'
        if (!free && !game().spend('GaadiGo delivery fee', FLEET_RULES.deliveryFee)) return `Delivery is ₹${FLEET_RULES.deliveryFee}: not enough in the wallet.`
        const [low, high] = FLEET_RULES.deliveryMinutes
        const minutes = low + Math.random() * (high - low)
        // Brought to the road beside the rider, at the kerb, facing the way they face: never onto the footpath.
        const dirX = Math.sin(livePlayer.heading)
        const dirZ = Math.cos(livePlayer.heading)
        const spot = roadSpotNear(livePlayer.x, livePlayer.z, dirX, dirZ)
        set({ delivery: { id, x: spot[0], z: spot[1], dirX, dirZ, arrivesAt: liveSky.totalHours + minutes / 60, rental, own, here: false, handing: null } })
        say(`GaadiGo: your ${VEHICLES[id].name} is on its way, about ${Math.round(minutes)} min. Wait where you are.`)
        return null
      }

      return {
        owned: [],
        rental: null,
        emis: [],
        delivery: null,
        leaving: null,
        uncharged: 0,

        markHere: () => {
          const delivery = get().delivery
          if (!delivery || delivery.here) return
          set({ delivery: { ...delivery, here: true } })
          say(`GaadiGo: your ${VEHICLES[delivery.id].name} is here. Pull up beside it and stop for the keys.`)
        },

        completeHandover: () => {
          const delivery = get().delivery
          if (!delivery) return
          const before = game().vehicleId
          game().setVehicle(delivery.id)
          set({
            delivery: null,
            ...(delivery.rental ? { rental: delivery.rental } : {}),
            // The delivery person rides the one the rider was on away, to the Garage.
            leaving: { id: before, x: livePlayer.x - delivery.dirZ * 2.2, z: livePlayer.z + delivery.dirX * 2.2, dirX: delivery.dirX, dirZ: delivery.dirZ, since: performance.now() },
          })
          say(`Keys handed over: you're on the ${VEHICLES[delivery.id].name}. Your ${VEHICLES[before].name} is being taken to your Garage.`)
          // If that one had broken down, it's towed and mended there, for a charge.
          if (useUpkeep.getState().broken?.id === before) useUpkeep.getState().mend(UPKEEP.tow, 'Towed to your Garage and mended')
        },

        rent: (id, plan, insured, how) => {
          const spec = VEHICLES[id]
          const reason = locked(spec)
          if (reason) return reason
          if (get().rental) return 'End your current rental first.'
          if (how === 'hub' && !atHub()) return 'Free pickup is at the hub: ride to your dark store.'
          if (how === 'deliver' && get().delivery) return 'A delivery is already on its way.'
          const price = rentPrice(spec, plan, insured)
          if (game().credits < price + (how === 'deliver' ? FLEET_RULES.deliveryFee : 0)) return 'Not enough in the wallet.'
          game().spend(`GaadiGo rent · ${spec.name}${insured ? ' (insured)' : ''}`, price)
          // The clock runs from the handover, not the booking.
          return dispatch(id, how, { id, plan, insured, hoursLeft: plan === 'hour' ? 1 : 24, crashes: 0 }, false)
        },

        buy: (id, mode, how) => {
          const spec = VEHICLES[id]
          const reason = locked(spec)
          if (reason) return reason
          if (get().owned.includes(id)) return 'You already own one.'
          if (how === 'hub' && !atHub()) return 'Free pickup is at the hub: ride to your dark store.'
          if (how === 'deliver' && get().delivery) return 'A delivery is already on its way.'
          const now = mode === 'full' ? spec.price : downPayment(spec)
          if (game().credits < now + (how === 'deliver' ? FLEET_RULES.deliveryFee : 0)) return 'Not enough in the wallet.'
          game().spend(`GaadiGo ${mode === 'full' ? 'purchase' : 'down payment'} · ${spec.name}`, now)
          if (mode === 'emi') {
            set({ emis: [...get().emis, { id, weekly: weeklyEmi(spec), weeksLeft: FLEET_RULES.emiWeeks, nextDueDay: game().day + FLEET_RULES.daysPerWeek, missed: 0 }] })
          }
          // It's the rider's from now, wherever it's handed over.
          set({ owned: [...get().owned, id] })
          return dispatch(id, how, null, true)
        },

        takeOut: (id, how) => {
          if (id !== 'scooter' && !get().owned.includes(id)) return "That one isn't in your Garage."
          if (game().vehicleId === id) return "You're on it."
          if (get().rental) return 'End your rental first: it has to go back.'
          // Switching between what's already theirs costs nothing, wherever they are: the fee is for renting and buying.
          return dispatch(id, how, null, true, true)
        },

        endRental: () => {
          const rental = get().rental
          if (!rental) return 'No rental to end.'
          if (lastSpeed > FLEET_RULES.handoverSpeed) return 'Park first: stop, then end the rental.'
          const spec = VEHICLES[rental.id]
          const lateHours = Math.max(0, Math.ceil(-rental.hoursLeft))
          const late = Math.round(lateHours * spec.rentHour * FLEET_RULES.lateRate)
          const crashes = rental.crashes
          const damage = rental.insured ? 0 : crashes * FLEET_RULES.damagePerCrash
          if (late > 0) game().fine(`GaadiGo late fee · ${lateHours} h`, late, `GaadiGo: ${spec.name} came back ${lateHours} h late. Late fee ₹${late}.`)
          if (damage > 0) game().fine(`GaadiGo damage · ${crashes} crash${crashes === 1 ? '' : 'es'}`, damage, `GaadiGo: damage on the ${spec.name}, ₹${damage}. Insurance would have covered it.`)
          set({ rental: null })
          // It's collected where it stands, and the rider's own scooter is brought in its place.
          game().setVehicle('scooter')
          say(`GaadiGo: ${spec.name} collected${late + damage === 0 ? ', all clear' : ''}${rental.insured && crashes > 0 ? ' (damage covered by insurance)' : ''}. Your scooter's back.`)
          return null
        },

        tick: (speed, moved, crashed) => {
          lastSpeed = speed
          const elapsed = lastHours === null ? 0 : Math.max(0, liveSky.totalHours - lastHours)
          lastHours = liveSky.totalHours
          // Running costs are the tank's now: it empties with the kilometres, and filling it is what's paid for (upkeep.ts).
          const spec = VEHICLES[game().vehicleId] ?? VEHICLES.scooter
          // Not on a borrowed vehicle (game/borrow.ts): its petrol isn't the rider's to pay for, and their own stands still. Nor in Explore.
          useUpkeep.getState().drive(spec.id, liveVehicle.spec.borrowed || game().explore ? 0 : moved, tickSeconds())

          // A rental running late: one reminder as its time runs out.
          const before = get().rental
          if (before && game().vehicleId === before.id) {
            const rental = { ...before, hoursLeft: before.hoursLeft - elapsed, crashes: before.crashes + crashed }
            set({ rental })
            if (before.hoursLeft > 0 && rental.hoursLeft <= 0) say(`GaadiGo: your ${VEHICLES[rental.id].name} is due back. Late fees are running: end the rental in the app.`)
          }

          // A delivery standing at its spot: once the rider is beside it and stopped, the keys change
          // hands (FleetClock.tsx plays that, then calls `completeHandover`).
          const delivery = get().delivery
          if (!delivery || !delivery.here || delivery.handing !== null) return
          if (Math.hypot(delivery.x - livePlayer.x, delivery.z - livePlayer.z) > FLEET_RULES.handoverRange || speed > FLEET_RULES.handoverSpeed) return
          set({ delivery: { ...delivery, handing: performance.now() } })
        },

        newDay: (day) => {
          // A night at home charges the electrics.
          useUpkeep.getState().overnight()
          const kept: Emi[] = []
          let owned = get().owned
          for (const emi of get().emis) {
            if (day < emi.nextDueDay) {
              kept.push(emi)
              // The day before it's due, a reminder, with what's in the wallet against it.
              if (day === emi.nextDueDay - 1) say(`GaadiGo: EMI of ₹${emi.weekly} for the ${VEHICLES[emi.id].name} is due tomorrow. Wallet: ₹${game().credits}${game().credits < emi.weekly ? ', which is short' : ''}.`)
              continue
            }
            const spec = VEHICLES[emi.id]
            if (game().spend(`GaadiGo EMI · ${spec.name}`, emi.weekly)) {
              const weeksLeft = emi.weeksLeft - 1
              if (weeksLeft > 0) {
                kept.push({ ...emi, weeksLeft, nextDueDay: emi.nextDueDay + FLEET_RULES.daysPerWeek, missed: 0 })
                say(`GaadiGo: this week's EMI of ₹${emi.weekly} for the ${spec.name} is paid from your wallet. ${weeksLeft} to go; next on day ${emi.nextDueDay + FLEET_RULES.daysPerWeek}.`)
              } else say(`GaadiGo: last EMI paid. The ${spec.name} is all yours.`)
              continue
            }
            if (emi.missed === 0) {
              // One week's grace: the same EMI is asked for again tomorrow.
              kept.push({ ...emi, missed: 1, nextDueDay: day + 1 })
              say(`GaadiGo: this week's EMI of ₹${emi.weekly} for the ${spec.name} bounced. Pay by tomorrow, or our recovery agent comes for it.`)
              continue
            }
            // The recovery agent: the vehicle goes, and what was paid stays paid.
            owned = owned.filter((id) => id !== emi.id)
            if (game().vehicleId === emi.id) game().setVehicle('scooter')
            say(`GaadiGo recovery: EMI missed twice. Our agent has taken the ${spec.name} back.${game().vehicleId === 'scooter' ? " You're on your scooter." : ''}`)
          }
          set({ emis: kept, owned })
        },
      }
    },
    {
      name: saveKey('swalpa-fast-fleet'),
      version: 1,
      partialize: (state) => ({ owned: state.owned, rental: state.rental, emis: state.emis, uncharged: state.uncharged }),
    },
  ),
)

// Orders that need a kind of vehicle are offered when the rider's carries it, or GaadiGo would rent one that does.
orderRules.canOffer = (type) => carries(type) || cheapestFor(type) !== null
// Accepted on a vehicle that carries it, or with one that does on its way or just rented.
orderGate.allows = (type) => {
  const coming = useFleet.getState().delivery?.id ?? useFleet.getState().rental?.id
  return carries(type) || (coming !== undefined && VEHICLES[coming].unlocks.includes(type))
}

/** Real seconds since the last tick (capped: a hidden tab doesn't count). */
let lastTickAt = 0
function tickSeconds(): number {
  const now = performance.now()
  const seconds = lastTickAt ? Math.min(5, (now - lastTickAt) / 1000) : 0
  lastTickAt = now
  return seconds
}

/** The rider's speed at the last tick, and the game clock then. */
let lastSpeed = 0
let lastHours: number | null = null

// Debug: the fleet, for scripts (with ?debug).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  ;(window as unknown as { __deliverItFleet?: typeof useFleet }).__deliverItFleet = useFleet
}
