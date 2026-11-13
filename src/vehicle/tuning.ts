import type { UpgradeLevels } from '../game/garage'
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
  /** How wet the road is, from 0 to 1. Set from the sky each frame. */
  wetness: 0,
  tyreLevel: 0,
}

export function applyUpgrades({ engine, tyres, brakes }: UpgradeLevels) {
  tuning.maxSpeed = SCOOTER.maxSpeed + engine * ENGINE_SPEED_STEP
  tuning.acceleration = SCOOTER.acceleration * (1 + engine * ENGINE_PULL_STEP)
  tuning.topEndAcceleration = SCOOTER.topEndAcceleration * (1 + engine * ENGINE_PULL_STEP)
  tuning.grip = SCOOTER.grip * (1 + tyres * TYRE_GRIP_STEP)
  tuning.braking = SCOOTER.braking * (1 + brakes * BRAKE_STEP)
  tuning.tyreLevel = tyres
}

/** Grip on the road as it is now: upgraded tyres, less a share for rain that better tyres win back. */
export function currentGrip(): number {
  const rainLoss = RAIN_GRIP_LOSS * tuning.wetness * (1 - tuning.tyreLevel / 3)
  return tuning.grip * (1 - rainLoss)
}
