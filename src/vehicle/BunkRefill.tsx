import { useRef, type RefObject } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { useGameStore } from '../game/gameStore'
import { setPrompt } from '../game/prompts'
import { energyOf, fillPrice, fuelLevel, UPKEEP, useUpkeep, fullPrice } from '../game/upkeep'
import { bunkAt, chargerAt, FUEL_BRANDS, type FuelStation } from '../world/fuelStationData'
import { getTravelSpeed, type ScooterState } from './ScooterController'
import { liveVehicle } from './vehicleCatalog'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('missions and markers')

/** Slower than this, in metres per second (about 9 km/h), counts as pulled in at the pumps. */
const PULLED_IN_SPEED = 2.5
/** How long an empty tank takes to fill at the pumps, in seconds. */
const FILL_TIME = 2.5
/** How often the prompts are worked out, in seconds. */
const CHECK_EVERY = 0.15

/** Tops up the nitro for one frame at the pumps. */
function fillTank(state: ScooterState, delta: number) {
  state.nitro = Math.min(1, state.nitro + Math.min(delta, 0.1) / FILL_TIME)
}

/**
 * At a petrol bunk. Pulled in under the canopy, the nitro tank fills in a couple of seconds, as
 * before; and the vehicle's own tank can be filled (E), paid from the wallet (game/upkeep.ts).
 * Electrics charge at the bunk's EV charger instead, past the canopy's end. Out on the road with
 * nothing in the tank, the same key calls for a can from the nearest bunk.
 */
export function BunkRefill({ scooter, stations }: { scooter: RefObject<ScooterState>; stations: FuelStation[] }) {
  const since = useRef(0)
  useFrame((_, delta) => {
    const state = scooter.current
    const game = useGameStore.getState()
    const riding = game.started && game.phase !== 'collecting' && game.phase !== 'handingOver' && state.rider.phase === 'on'
    const pulledIn =
      riding && state.crashLeft === 0 && !state.nitroOn && Math.abs(state.speed) < PULLED_IN_SPEED
    const bunk = pulledIn ? bunkAt(stations, state.x, state.z) : null

    if (bunk) fillTank(state, delta)

    const name = bunk ? FUEL_BRANDS[bunk.brand].name : null
    if (game.atBunk !== name) game.setAtBunk(name)

    since.current += delta
    if (since.current < CHECK_EVERY) return
    since.current = 0
    const spec = liveVehicle.spec
    const energy = energyOf(spec)
    const upkeep = useUpkeep.getState()
    const level = fuelLevel(upkeep.fuel, spec.id)
    const stopped = riding && getTravelSpeed(state) < 1
    const filling = upkeep.filling?.id === spec.id
    const say = (refused: string | null) => {
      if (refused) useGameStore.getState().raviSays(refused)
    }
    // Petrol and diesel at the pumps; electrics at the charger.
    const charger = energy === 'charge' && pulledIn ? chargerAt(stations, state.x, state.z) : null
    const canFill = !filling && level <= 0.97 && ((energy === 'petrol' && bunk !== null) || charger !== null)
    setPrompt(
      'fuel',
      canFill
        ? { action: 'interact', text: `${energy === 'charge' ? 'Charge' : 'Fill up'} · ${Math.min(1 - level, game.credits / fullPrice(spec)) < 0.03 && level < UPKEEP.advanceBelow ? 'on Ravi’s tab' : `₹${Math.min(game.credits, fillPrice(spec, level))}`}`, priority: 3, run: () => say(useUpkeep.getState().fill(spec.id)) }
        : energy !== 'none' && level <= 0 && stopped && !filling
          ? { action: 'interact', text: `Roadside top-up · ₹${UPKEEP.rescue.price}${game.credits < UPKEEP.rescue.price ? ' · Ravi covers the rest' : ''}`, priority: 3, run: () => say(useUpkeep.getState().rescue(spec.id)) }
          : null,
    )
  })
  return null
}
