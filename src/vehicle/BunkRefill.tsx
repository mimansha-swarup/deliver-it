import type { RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../game/gameStore'
import { bunkAt, FUEL_BRANDS, type FuelStation } from '../world/fuelStationData'
import type { ScooterState } from './ScooterController'

/** Slower than this, in metres per second (about 9 km/h), counts as pulled in at the pumps. */
const PULLED_IN_SPEED = 2.5
/** How long an empty tank takes to fill at the pumps, in seconds. */
const FILL_TIME = 2.5

/** Tops up the tank for one frame at the pumps. */
function fillTank(state: ScooterState, delta: number) {
  state.nitro = Math.min(1, state.nitro + Math.min(delta, 0.1) / FILL_TIME)
}

/**
 * Pull in under a petrol bunk's canopy and slow down, and the nitro tank fills
 * in a couple of seconds. It costs the time of a stop, which is the trade.
 * Tells the HUD which bunk the rider is at, but only when that changes.
 */
export function BunkRefill({ scooter, stations }: { scooter: RefObject<ScooterState>; stations: FuelStation[] }) {
  useFrame((_, delta) => {
    const state = scooter.current
    const game = useGameStore.getState()
    const riding = game.started && game.phase !== 'collecting' && game.phase !== 'handingOver'
    const pulledIn =
      riding && state.crashLeft === 0 && !state.nitroOn && Math.abs(state.speed) < PULLED_IN_SPEED
    const bunk = pulledIn ? bunkAt(stations, state.x, state.z) : null

    if (bunk) fillTank(state, delta)

    const name = bunk ? FUEL_BRANDS[bunk.brand].name : null
    if (game.atBunk !== name) game.setAtBunk(name)
  })
  return null
}
