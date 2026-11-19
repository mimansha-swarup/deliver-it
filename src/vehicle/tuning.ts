import type { UpgradeLevels } from '../game/garage'
import type { VehicleSpec } from './vehicleCatalog'
import { SCOOTER } from './vehicleConfig'

/** What each upgrade level adds. */
const ENGINE_SPEED_STEP = 2 / 3.6 // 2 km/h, in m/s
const ENGINE_PULL_STEP = 0.06
const TYRE_GRIP_STEP = 0.1
const BRAKE_STEP = 0.15
/** In a full downpour, grip drops by this share. Each tyre level wins back a third of it. */
const RAIN_GRIP_LOSS = 0.3

/**
 * The handling the scooter has right now, which the controller reads every
 * frame. It's `SCOOTER` plus the Garage upgrades and the rain. Plain numbers in
 * a plain object, like `livePlayer`, so nothing re-renders when they change.
 */
export const tuning = {
  maxSpeed: SCOOTER.maxSpeed,
  acceleration: SCOOTER.acceleration,
  topEndAcceleration: SCOOTER.topEndAcceleration,
  grip: SCOOTER.grip,
  braking: SCOOTER.braking,
  /** How quickly it turns and how far it leans, against the scooter's: the vehicle's own (vehicleCatalog.ts). */
  turn: 1,
  lean: 1,
  /** How fast the drive follows the throttle (per second), how hard it slows off it (m/s²), and whether it has nitro. */
  /**
   * Its size on the road (vehicleCatalog.ts): half its width, half its length, and whether the rider
   * is inside a cab. `dents`: knocks it has taken since it was taken out, which show on it.
   */
  radius: SCOOTER.collisionRadius,
  halfLength: SCOOTER.collisionRadius,
  cab: false,
  dents: 0,
  response: 8,
  coasting: SCOOTER.coasting,
  nitro: true,
  /** A share of the top speed it can reach now: 1 ordinarily; less with an empty tank or an overdue service (game/upkeep.ts); 0 broken down. */
  limp: 1,
  /** How wet the road is, from 0 to 1. Set from the sky each frame. */
  wetness: 0,
  tyreLevel: 0,
}

/**
 * Sets the handling: the vehicle in use, and on the rider's own scooter the Garage's upgrades on top
 * (they're that scooter's parts, so a rented van doesn't get them).
 */
export function applyVehicle(spec: VehicleSpec, upgrades: UpgradeLevels) {
  const { engine, tyres, brakes } = spec.id === 'scooter' ? upgrades : { engine: 0, tyres: 0, brakes: 0 }
  tuning.maxSpeed = spec.topSpeed / 3.6 + engine * ENGINE_SPEED_STEP
  tuning.acceleration = SCOOTER.acceleration * spec.pull * (1 + engine * ENGINE_PULL_STEP)
  tuning.topEndAcceleration = SCOOTER.topEndAcceleration * spec.feel.topEnd * (1 + engine * ENGINE_PULL_STEP)
  // A two-wheeler stays the slim circle it always was (it leans and threads gaps); a cab is its real width and length.
  tuning.radius = spec.size.cab ? spec.size.width / 2 : SCOOTER.collisionRadius
  tuning.halfLength = spec.size.cab ? spec.size.length / 2 : SCOOTER.collisionRadius
  tuning.cab = spec.size.cab
  tuning.dents = 0
  tuning.response = spec.feel.response
  tuning.coasting = spec.feel.coast
  tuning.nitro = spec.feel.nitro
  tuning.grip = SCOOTER.grip * spec.grip * (1 + tyres * TYRE_GRIP_STEP)
  tuning.braking = SCOOTER.braking * spec.brake * (1 + brakes * BRAKE_STEP)
  tuning.turn = spec.turn
  tuning.lean = spec.lean
  tuning.tyreLevel = tyres
}

/** Grip on the road as it is now: upgraded tyres, less a share for rain that better tyres win back. */
export function currentGrip(): number {
  const rainLoss = RAIN_GRIP_LOSS * tuning.wetness * (1 - tuning.tyreLevel / 3)
  return tuning.grip * (1 - rainLoss)
}
