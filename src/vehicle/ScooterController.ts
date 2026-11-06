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
  /** Which way the scooter points, in radians around Y. 0 faces +Z, increasing turns left. */
  heading: number
  /** Where the scooter is really going, in metres per second. */
  velocityX: number
  velocityZ: number
  /** Speed along the way it's pointing. Negative means reversing. */
  speed: number
  /** Speed sideways. Positive slides to the scooter's left. */
  slip: number
  /** Handlebar position, from -1 (full right) to 1 (full left). */
  steer: number
  /** Current tyre grip. */
  grip: number
  drifting: boolean
  /** Seconds spent sliding in the current drift. */
  driftTime: number
  /** Seconds of boost remaining. */
  boostLeft: number
  /** Tilt in radians. Positive leans left. */
  lean: number
  /** Nose movement in radians. Positive dips the nose. */
  pitch: number
  /** How far the wheels have turned, in radians. */
  wheelSpin: number
}

export function createScooterState(): ScooterState {
  return {
    ...SCOOTER_SPAWN,
    velocityX: 0,
    velocityZ: 0,
    speed: 0,
    slip: 0,
    steer: 0,
    grip: SCOOTER.grip,
    drifting: false,
    driftTime: 0,
    boostLeft: 0,
    lean: 0,
    pitch: 0,
    wheelSpin: 0,
  }
}

/** True speed in any direction, ignoring which way the scooter points. */
export function getTravelSpeed(state: ScooterState): number {
  return Math.hypot(state.velocityX, state.velocityZ)
}

/** Moves a value toward a target without overshooting. */
function moveToward(value: number, target: number, maxChange: number): number {
  if (Math.abs(target - value) <= maxChange) return target
  return value + Math.sign(target - value) * maxChange
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** The shortest signed turn from one angle to another, between -PI and PI. */
function angleBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function updateDrift(state: ScooterState, input: DriveInput, dt: number) {
  const fastEnough = state.speed > 0 && getTravelSpeed(state) >= SCOOTER.driftMinSpeed

  if (input.handbrake && fastEnough) {
    state.drifting = true
    if (Math.abs(state.slip) > SCOOTER.slipThreshold) state.driftTime += dt
  } else if (state.drifting) {
    // A boost is earned by letting go. Scrubbing off all your speed earns nothing.
    if (!input.handbrake && state.driftTime >= SCOOTER.boostChargeTime) {
      state.boostLeft = SCOOTER.boostTime
    }
    state.drifting = false
    state.driftTime = 0
  }

  const targetGrip = input.handbrake ? SCOOTER.driftGrip : SCOOTER.grip
  state.grip = moveToward(state.grip, targetGrip, SCOOTER.gripChangeRate * dt)
  state.boostLeft = Math.max(0, state.boostLeft - dt)
}

function updateSteering(state: ScooterState, input: DriveInput, dt: number) {
  const targetSteer = Number(input.left) - Number(input.right)
  state.steer = moveToward(state.steer, targetSteer, SCOOTER.steerRate * dt)

  const absoluteSpeed = Math.abs(state.speed)
  const speedRatio = Math.min(absoluteSpeed / SCOOTER.maxSpeed, 1)
  const steeringFade = Math.min(absoluteSpeed / SCOOTER.fullSteeringSpeed, 1)
  const driftBoost = state.drifting ? SCOOTER.driftTurnBoost : 1
  const turnRate =
    SCOOTER.turnRateLow + (SCOOTER.turnRateHigh - SCOOTER.turnRateLow) * speedRatio

  // Steering further into a slide fades out as it nears the limit. A slip to the
  // right means the scooter has turned left, so that's when steering left is "further".
  const slipAngle = Math.atan2(state.slip, Math.max(Math.abs(state.speed), 1))
  const steeringDeeper = state.drifting && state.steer * slipAngle < 0
  const driftLimit = steeringDeeper
    ? clamp(1 - Math.abs(slipAngle) / SCOOTER.maxDriftAngle, 0, 1)
    : 1

  // Math.sign flips the steering in reverse, as on a real vehicle.
  state.heading +=
    state.steer * turnRate * driftBoost * driftLimit * steeringFade * Math.sign(state.speed) * dt
}

function engineForce(speed: number, boosting: boolean): number {
  const ratio = clamp(speed / SCOOTER.maxSpeed, 0, 1)
  const engine =
    SCOOTER.acceleration + (SCOOTER.topEndAcceleration - SCOOTER.acceleration) * ratio * ratio
  return boosting ? engine + SCOOTER.boostAcceleration : engine
}

/** Returns the new speed along the scooter's direction. */
function applyControls(speed: number, state: ScooterState, input: DriveInput, dt: number): number {
  const boosting = state.boostLeft > 0
  const limit = SCOOTER.maxSpeed + (boosting ? SCOOTER.boostSpeed : 0)

  if (input.handbrake) {
    const drag = input.forward ? SCOOTER.powerSlideDrag : SCOOTER.handbrake
    return moveToward(speed, 0, drag * dt)
  }
  if (input.forward) {
    if (speed < 0) return moveToward(speed, 0, SCOOTER.braking * dt)
    if (speed > limit) return moveToward(speed, limit, SCOOTER.overspeedDrag * dt)
    return moveToward(speed, limit, engineForce(speed, boosting) * dt)
  }
  if (input.backward) {
    if (speed > 0) return moveToward(speed, 0, SCOOTER.braking * dt)
    return moveToward(speed, -SCOOTER.maxReverseSpeed, SCOOTER.reverseAcceleration * dt)
  }
  return moveToward(speed, 0, (speed > limit ? SCOOTER.overspeedDrag : SCOOTER.coasting) * dt)
}

/**
 * The heart of the handling. Velocity is split into two parts: along the way
 * the scooter points, and sideways. The controls act on the first, and tyre
 * grip wears away the second. When the scooter turns, its old velocity is
 * briefly sideways, and that's what a slide is. High grip erases it almost at
 * once, and low grip lets it carry on.
 */
function updateVelocity(state: ScooterState, input: DriveInput, dt: number) {
  const forwardX = Math.sin(state.heading)
  const forwardZ = Math.cos(state.heading)
  const sideX = forwardZ
  const sideZ = -forwardX

  const speed = state.velocityX * forwardX + state.velocityZ * forwardZ
  const slip = state.velocityX * sideX + state.velocityZ * sideZ

  const nextSlip = slip * Math.exp(-state.grip * dt)
  let nextSpeed = applyControls(speed, state, input, dt)

  // As the tyres bite, some of the slide becomes forward speed instead of being
  // lost. It can't lift you past the speed limit, or corners would speed you up.
  const recovery = input.handbrake
    ? input.forward
      ? SCOOTER.powerSlideRecovery
      : 0
    : SCOOTER.slideRecovery
  const limit = SCOOTER.maxSpeed + (state.boostLeft > 0 ? SCOOTER.boostSpeed : 0)
  if (nextSpeed > 0 && nextSpeed < limit) {
    const recovered = nextSpeed + (Math.abs(slip) - Math.abs(nextSlip)) * recovery
    nextSpeed = Math.min(recovered, limit)
  }

  state.speed = nextSpeed
  state.slip = nextSlip
  state.velocityX = forwardX * nextSpeed + sideX * nextSlip
  state.velocityZ = forwardZ * nextSpeed + sideZ * nextSlip
}

/**
 * Pushes the scooter out of any building, then removes the part of its velocity
 * heading into the wall. A glancing hit also swings the scooter along the wall,
 * or it would keep pointing into it and lose speed on every frame.
 */
function handleCollisions(state: ScooterState, collisions: CollisionWorld, dt: number) {
  const beforeX = state.x
  const beforeZ = state.z
  pushOutOfBuildings(collisions, state, SCOOTER.collisionRadius)

  const pushX = state.x - beforeX
  const pushZ = state.z - beforeZ
  const pushLength = Math.hypot(pushX, pushZ)
  const travelSpeed = getTravelSpeed(state)
  if (pushLength === 0 || travelSpeed === 0) return

  const normalX = pushX / pushLength
  const normalZ = pushZ / pushLength
  const intoWall = state.velocityX * normalX + state.velocityZ * normalZ
  if (intoWall >= 0) return

  const alongX = state.velocityX - normalX * intoWall
  const alongZ = state.velocityZ - normalZ * intoWall
  state.velocityX = alongX
  state.velocityZ = alongZ

  const directness = -intoWall / travelSpeed
  if (directness > SCOOTER.headOnThreshold) {
    state.velocityX = 0
    state.velocityZ = 0
    return
  }

  // Line up with the wall, facing whichever way along it is closest.
  let turn = angleBetween(state.heading, Math.atan2(alongX, alongZ))
  if (Math.abs(turn) > Math.PI / 2) turn = angleBetween(state.heading + Math.PI, state.heading + turn)
  state.heading += turn * (1 - Math.exp(-SCOOTER.wallDeflectRate * dt))
}

function updatePosition(state: ScooterState, collisions: CollisionWorld, dt: number) {
  const nextX = state.x + state.velocityX * dt
  const nextZ = state.z + state.velocityZ * dt

  state.x = clamp(nextX, -WORLD_LIMIT, WORLD_LIMIT)
  state.z = clamp(nextZ, -WORLD_LIMIT, WORLD_LIMIT)
  if (state.x !== nextX) state.velocityX = 0
  if (state.z !== nextZ) state.velocityZ = 0

  handleCollisions(state, collisions, dt)
  state.wheelSpin += (state.speed / SCOOTER.wheelRadius) * dt
}

/** Tilts the body. This changes how it looks, not where it goes. */
function updateBodyMotion(state: ScooterState, input: DriveInput, dt: number) {
  const speedRatio = Math.min(Math.abs(state.speed) / SCOOTER.maxSpeed, 1)

  const cornerLean = state.steer * Math.min(speedRatio * 1.5, 1) * SCOOTER.maxLean
  const slideLean = clamp(-state.slip / 6, -1, 1) * 0.15
  const targetLean = clamp(cornerLean + slideLean, -SCOOTER.maxLean * 1.2, SCOOTER.maxLean * 1.2)
  state.lean = moveToward(state.lean, targetLean, SCOOTER.leanRate * SCOOTER.maxLean * dt)

  let targetPitch = 0
  if ((input.backward && state.speed > 1) || input.handbrake) {
    targetPitch = SCOOTER.pitchUnderBraking
  } else if (input.forward && speedRatio < 0.8) {
    targetPitch = -SCOOTER.pitchUnderPower
  }
  state.pitch = moveToward(state.pitch, targetPitch, SCOOTER.pitchRate * dt)
}

/** Advances the scooter by `dt` seconds. Updates `state` in place. */
export function stepScooter(
  state: ScooterState,
  input: DriveInput,
  collisions: CollisionWorld,
  dt: number,
) {
  updateDrift(state, input, dt)
  updateSteering(state, input, dt)
  updateVelocity(state, input, dt)
  updatePosition(state, collisions, dt)
  updateBodyMotion(state, input, dt)
}
