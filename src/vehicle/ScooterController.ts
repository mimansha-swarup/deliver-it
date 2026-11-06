import { pushOutOfBuildings, type CollisionWorld } from '../world/collision'
import { SCOOTER, SCOOTER_SPAWN, WORLD_LIMIT } from './vehicleConfig'

export type DriveInput = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  handbrake: boolean
}

export type ScooterState = {
  x: number
  z: number
  /** Direction in radians around the Y axis. 0 faces +Z, and increasing turns left. */
  heading: number
  /** Metres per second. Negative means reversing. */
  speed: number
  /** Handlebar position, from -1 (full right) to 1 (full left). */
  steer: number
  /** Tilt in radians. Positive leans left. */
  lean: number
  /** How far the wheels have turned, in radians. */
  wheelSpin: number
}

export function createScooterState(): ScooterState {
  return { ...SCOOTER_SPAWN, speed: 0, steer: 0, lean: 0, wheelSpin: 0 }
}

/** Moves a value toward a target without overshooting. */
function moveToward(value: number, target: number, maxChange: number): number {
  if (Math.abs(target - value) <= maxChange) return target
  return value + Math.sign(target - value) * maxChange
}

function updateSpeed(state: ScooterState, input: DriveInput, dt: number) {
  const { speed } = state

  if (input.handbrake) {
    state.speed = moveToward(speed, 0, SCOOTER.handbrake * dt)
  } else if (input.forward) {
    state.speed =
      speed < 0
        ? moveToward(speed, 0, SCOOTER.braking * dt)
        : moveToward(speed, SCOOTER.maxSpeed, SCOOTER.acceleration * dt)
  } else if (input.backward) {
    state.speed =
      speed > 0
        ? moveToward(speed, 0, SCOOTER.braking * dt)
        : moveToward(speed, -SCOOTER.maxReverseSpeed, SCOOTER.reverseAcceleration * dt)
  } else {
    state.speed = moveToward(speed, 0, SCOOTER.coasting * dt)
  }
}

function updateSteering(state: ScooterState, input: DriveInput, dt: number) {
  const targetSteer = Number(input.left) - Number(input.right)
  state.steer = moveToward(state.steer, targetSteer, SCOOTER.steerRate * dt)

  const absoluteSpeed = Math.abs(state.speed)
  const speedRatio = absoluteSpeed / SCOOTER.maxSpeed
  const grip = Math.min(absoluteSpeed / SCOOTER.fullSteeringSpeed, 1)
  const turnRate =
    SCOOTER.turnRateLow + (SCOOTER.turnRateHigh - SCOOTER.turnRateLow) * speedRatio

  // Math.sign flips the steering in reverse, as on a real vehicle.
  state.heading += state.steer * turnRate * grip * Math.sign(state.speed) * dt

  const targetLean = state.steer * Math.min(speedRatio * 1.5, 1) * SCOOTER.maxLean
  state.lean = moveToward(state.lean, targetLean, SCOOTER.leanRate * SCOOTER.maxLean * dt)
}

/**
 * Pushes the scooter out of any building, then reacts to how direct the hit was.
 * Every hit removes the speed heading into the wall. A glancing hit also swings
 * the scooter along the wall, so it doesn't lose speed again on every frame.
 */
function handleCollisions(state: ScooterState, collisions: CollisionWorld, dt: number) {
  const beforeX = state.x
  const beforeZ = state.z
  pushOutOfBuildings(collisions, state, SCOOTER.collisionRadius)

  const pushX = state.x - beforeX
  const pushZ = state.z - beforeZ
  const pushLength = Math.hypot(pushX, pushZ)
  if (pushLength === 0 || state.speed === 0) return

  // The wall's facing direction, and our direction of travel (flipped in reverse).
  const normalX = pushX / pushLength
  const normalZ = pushZ / pushLength
  const travelSign = Math.sign(state.speed)
  const travelX = Math.sin(state.heading) * travelSign
  const travelZ = Math.cos(state.heading) * travelSign

  const towardWall = -(travelX * normalX + travelZ * normalZ)
  if (towardWall <= 0) return

  state.speed *= Math.sqrt(Math.max(0, 1 - towardWall * towardWall))
  if (towardWall > SCOOTER.headOnThreshold) return

  // Remove the part of our travel that points into the wall. What's left runs along it.
  const alongX = travelX + normalX * towardWall
  const alongZ = travelZ + normalZ * towardWall
  const targetHeading = Math.atan2(alongX * travelSign, alongZ * travelSign)

  // The shortest way round from one angle to the other.
  const turn = Math.atan2(
    Math.sin(targetHeading - state.heading),
    Math.cos(targetHeading - state.heading),
  )
  state.heading += turn * (1 - Math.exp(-SCOOTER.wallDeflectRate * dt))
}

function updatePosition(state: ScooterState, collisions: CollisionWorld, dt: number) {
  const nextX = state.x + Math.sin(state.heading) * state.speed * dt
  const nextZ = state.z + Math.cos(state.heading) * state.speed * dt

  state.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextX))
  state.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextZ))
  if (state.x !== nextX || state.z !== nextZ) state.speed = 0

  handleCollisions(state, collisions, dt)

  state.wheelSpin += (state.speed / SCOOTER.wheelRadius) * dt
}

/** Advances the scooter by `dt` seconds. Updates `state` in place. */
export function stepScooter(
  state: ScooterState,
  input: DriveInput,
  collisions: CollisionWorld,
  dt: number,
) {
  updateSpeed(state, input, dt)
  updateSteering(state, input, dt)
  updatePosition(state, collisions, dt)
}
