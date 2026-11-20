import { create } from 'zustand'
import { useGameStore } from './gameStore'
import { refreshHandling } from './upkeep'
import { abandonVehicle, driveVehicle, hailVehicle, parkedNear, standInForParked, vehicleNear, type TrafficWorld, type Vehicle, type VehicleKind } from '../traffic/trafficLogic'
import { FOOT, type ScooterState } from '../vehicle/ScooterController'
import { applyVehicle } from '../vehicle/tuning'
import { removeSmallSolidAt, type CollisionWorld } from '../world/collision'
import type { StiltVehicle } from '../world/houseKit'
import { STREET_CAR_MODELS } from '../world/streetParking'
import { borrowedSpec, liveVehicle, VEHICLES, type BorrowClass } from '../vehicle/vehicleCatalog'

/*
 * "Use any vehicle": on foot, the rider can walk up to a vehicle on the street and drive it (F).
 *
 * One in traffic pulls up, its driver gets out calmly and walks to the footpath (trafficLogic.ts),
 * and the rider gets in. It stays the same vehicle the traffic was drawing, in its own colour and
 * with its own number plate: only now it goes where the rider's controller does, with the handling,
 * size, sound and camera of its class (vehicleCatalog.ts' BORROWED). There are no police, no fines
 * and nobody is hurt: it's a way to try the city's vehicles, not a crime.
 *
 * The rider's own vehicle stays where they left it, on the map, to be walked or driven back to. A
 * borrowed one left behind goes once it's out of sight. In the career, a borrowed vehicle can't
 * carry orders and costs nothing to run.
 */

type Pose = { x: number; z: number; heading: number }

/** Plain, as `livePlayer` is: read every frame by what draws and steps. */
export const borrow = {
  /** The traffic, and how many of its vehicles are in play: set by the traffic as it mounts. */
  world: null as TrafficWorld | null,
  count: 0,
  /** The street vehicle that is the rider's vehicle now, or null on their own. */
  vehicle: null as Vehicle | null,
  /** Where their own stands meanwhile. */
  own: null as Pose | null,
  /** One they've waved down, to get into when it has stopped and its driver is out. */
  wanted: null as Vehicle | null,
  /** The cars and bikes parked along the kerbs (world/streetParking.ts), and what makes them solid: set by the world. */
  kerbside: [] as StiltVehicle[],
  collisions: null as CollisionWorld | null,
}

/** For the screen: the borrowed vehicle's name, or null on the rider's own. */
export const useBorrow = create<{ name: string | null }>(() => ({ name: null }))

const CLASS_OF: Record<VehicleKind, BorrowClass> = { bike: 'twoWheeler', auto: 'auto', sedan: 'car', hatchback: 'car', suv: 'car', mpv: 'van', bus: 'bus' }

/** How near a vehicle's side the rider must be to wave it down, and to get into one standing, in metres. */
export const HAIL_REACH = 6
const ENTER_REACH = 3
const PARKED_REACH = 3
/** A car or bike parked along the kerb is taken from within this of its middle, in metres. */
const KERB_REACH = { car: 3.6, bike: 2.6 }
/** Which of the traffic's two-wheelers is drawn as a scooter (Traffic.tsx' bikeShapeOf): the one a parked scooter turns into. */
export const bikeShape = (tint: number) => Math.floor(tint * 997) % 3
const isScooterShape = (vehicle: Vehicle) => bikeShape(vehicle.tint) === 1
/** One waved down is forgotten when the rider is this far from it. */
const GIVE_UP = 30

/** Whether the setting is on: by default in Explore, by choice in the career. */
export function canUseAnyVehicle(): boolean {
  const game = useGameStore.getState()
  return game.explore ? game.anyVehicleExplore : game.anyVehicle
}

const NO_UPGRADES = { engine: 0, tyres: 0, brakes: 0 }

function place(state: ScooterState, { x, z, heading }: Pose) {
  state.x = x
  state.z = z
  state.heading = heading
  state.speed = 0
  state.velocityX = 0
  state.velocityZ = 0
  state.steer = 0
  state.lean = 0
  state.drifting = false
  state.nitroOn = false
}

function mount(state: ScooterState) {
  state.rider.phase = 'mounting'
  state.rider.time = 0
  state.rider.pace = 0
}

/** The rider gets into a street vehicle that's standing empty. */
export function takeVehicle(state: ScooterState, vehicle: Vehicle) {
  if (borrow.vehicle && borrow.vehicle !== vehicle) abandonVehicle(borrow.vehicle)
  else if (!borrow.vehicle) borrow.own = { x: state.x, z: state.z, heading: state.heading }
  borrow.vehicle = vehicle
  borrow.wanted = null
  driveVehicle(vehicle)
  place(state, vehicle)
  const spec = borrowedSpec(CLASS_OF[vehicle.kind], vehicle.radius, vehicle.halfLength)
  liveVehicle.spec = spec
  liveVehicle.cockpit = false
  applyVehicle(spec, NO_UPGRADES)
  refreshHandling()
  useBorrow.setState({ name: spec.name })
  mount(state)
}

/** Back onto their own vehicle, where it was left: the borrowed one stays behind, and goes once out of sight. */
export function backToOwn(state: ScooterState) {
  if (!borrow.own) return
  place(state, borrow.own)
  endBorrowing()
  mount(state)
}

/** The rider's own vehicle is theirs again (they walked back to it, or another was brought to them). */
function endBorrowing() {
  if (borrow.vehicle) abandonVehicle(borrow.vehicle)
  borrow.vehicle = null
  borrow.own = null
  borrow.wanted = null
  const game = useGameStore.getState()
  liveVehicle.spec = VEHICLES[game.vehicleId] ?? VEHICLES.scooter
  applyVehicle(liveVehicle.spec, game.upgrades)
  refreshHandling()
  useBorrow.setState({ name: null })
}

/** What F would do for a rider on foot at their place now, away from the vehicle they came on. */
export function driveOffer(state: ScooterState): { text: string; run: () => void } | null {
  const { rider } = state
  if (borrow.own && Math.hypot(rider.x - borrow.own.x, rider.z - borrow.own.z) < FOOT.reach + 0.8) {
    const own = VEHICLES[useGameStore.getState().vehicleId] ?? VEHICLES.scooter
    return { text: `${own.size.cab ? 'Get in' : 'Get on'} your ${own.id === 'scooter' ? 'scooter' : own.name}`, run: () => backToOwn(state) }
  }
  if (!borrow.world || !canUseAnyVehicle()) return null
  const world = borrow.world
  const vehicle = vehicleNear(world, rider.x, rider.z, HAIL_REACH, borrow.count)
  // Or one parked: a scooter standing loose, or a car or bike in the rows along the kerb.
  const parked = vehicle ? null : parkedNear(world, rider.x, rider.z, PARKED_REACH)
  const kerbside = vehicle || parked ? null : kerbsideNear(rider.x, rider.z)
  if (!vehicle && !parked && !kerbside) return null
  return {
    text: 'Drive',
    run: () => {
      const game = useGameStore.getState()
      // An order on board goes on the rider's own vehicle (or a rented one): the app won't have it otherwise.
      if (game.mission && (game.phase === 'toCustomer' || game.phase === 'handingOver')) {
        game.postChat('customer', 'Deliver It app', 'An order is on board: deliver it on your own or a rented vehicle first.', true)
        return
      }
      if (parked) {
        const standIn = standInForParked(world, parked, ['bike'], borrow.count, rider, isScooterShape)
        if (!standIn) return
        // The parked one is gone from the kerb for this visit.
        parked.x = 1e6
        parked.z = 1e6
        takeVehicle(state, standIn)
        return
      }
      if (kerbside) {
        // The same model from the traffic, or failing a spare one, another car.
        const kinds: VehicleKind[] = kerbside.car ? [STREET_CAR_MODELS[kerbside.model ?? 0], 'hatchback', 'sedan', 'suv', 'mpv'] : ['bike']
        const standIn = standInForParked(world, { x: kerbside.x, z: kerbside.z, heading: kerbside.rotation }, kinds, borrow.count, rider, kerbside.car ? undefined : isScooterShape)
        if (!standIn) return
        // It's no longer parked there: nothing solid left in its place, and not drawn in the row.
        if (borrow.collisions) removeSmallSolidAt(borrow.collisions, kerbside.x, kerbside.z, 6)
        kerbside.x = 1e6
        kerbside.z = 1e6
        takeVehicle(state, standIn)
        return
      }
      if (!vehicle) return
      if (vehicle.taken === 'empty') takeVehicle(state, vehicle)
      else {
        hailVehicle(vehicle)
        borrow.wanted = vehicle
      }
    },
  }
}

/** The nearest car or bike parked along the kerb within reach of a point, or null. */
function kerbsideNear(x: number, z: number): StiltVehicle | null {
  let best: StiltVehicle | null = null
  let bestGap = 0
  for (const item of borrow.kerbside) {
    if (Math.abs(item.x - x) > 4 || Math.abs(item.z - z) > 4) continue
    const gap = Math.hypot(item.x - x, item.z - z) - (item.car ? KERB_REACH.car : KERB_REACH.bike)
    if (gap < bestGap) {
      best = item
      bestGap = gap
    }
  }
  return best
}

/** A few times a second: one waved down is got into once it has stopped and its driver is out, if the rider is still by it. */
export function followWanted(state: ScooterState) {
  const wanted = borrow.wanted
  if (!wanted) return
  if (wanted.lane === -1 || (wanted.taken !== 'hailed' && wanted.taken !== 'empty')) {
    borrow.wanted = null
    return
  }
  if (wanted.taken !== 'empty' || state.rider.phase !== 'afoot') return
  const { rider } = state
  // It may have rolled on a few metres as it pulled up: they get in as they reach it, unless they wander off.
  const away = Math.hypot(rider.x - wanted.x, rider.z - wanted.z) - wanted.halfLength
  if (away < ENTER_REACH) takeVehicle(state, wanted)
  else if (away > GIVE_UP) borrow.wanted = null
}

// Another vehicle of the rider's own takes over (GaadiGo hands one over, the Garage, a recovery): the
// borrowed one is left. Upgrades bought meanwhile are the scooter's, not the borrowed vehicle's.
useGameStore.subscribe((state, previous) => {
  if (!borrow.vehicle) return
  if (state.vehicleId !== previous.vehicleId) endBorrowing()
  else if (state.upgrades !== previous.upgrades) {
    applyVehicle(liveVehicle.spec, NO_UPGRADES)
    refreshHandling()
  }
})
