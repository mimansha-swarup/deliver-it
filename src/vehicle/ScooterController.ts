import { pushOutOfBuildings, type CollisionWorld } from '../world/collision'
import { currentGrip, tuning } from './tuning'
import { SCOOTER, SCOOTER_SPAWN, WORLD_LIMITS } from './vehicleConfig'

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
  /** Seconds left of a crash, during which the controls do nothing. */
  crashLeft: number
  /** Which way it falls: 1 or -1. */
  crashSide: number
  /** Crashes so far. The mission tracker counts these. */
  crashCount: number
  /** Turning speed after a hit, in radians per second. */
  spin: number
  /** How hard the last hit was, from 0 to 1. It fades, and shakes the camera. */
  impact: number
  /** The rider, who is thrown off in a hard crash. See `stepThrownRider`. */
  rider: ThrownRider
}

/** What the rider is doing after coming off: in the air or sliding, lying still, getting up, walking back, getting on. */
export type RiderPhase = 'on' | 'thrown' | 'lying' | 'rising' | 'walking' | 'mounting'

export type ThrownRider = {
  phase: RiderPhase
  /** Seconds in this phase. */
  time: number
  /** Where their hips are, in the world, and how fast they're moving. */
  x: number
  y: number
  z: number
  velocityX: number
  velocityY: number
  velocityZ: number
  /** Which way their body faces, around Y. */
  heading: number
  /** Forward roll: the axis it turns around (level, square to the throw), the angle, and how fast. */
  rollAxisX: number
  rollAxisZ: number
  roll: number
  rollSpeed: number
  /** The roll they were lying at, which getting up turns back from. */
  lyingRoll: number
  /** Whether they've landed. After that they slide, and never go back to flying. */
  onGround: boolean
  /** How far off the scooter they are, for drawing: 1 is off, 0 is sitting on it. */
  off: number
  /** How limp they are, from 0 to 1. */
  limp: number
  /** Their place in a walking stride, in radians. */
  stride: number
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
    crashLeft: 0,
    crashSide: 1,
    crashCount: 0,
    spin: 0,
    impact: 0,
    rider: {
      phase: 'on',
      time: 0,
      x: 0,
      y: 0,
      z: 0,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      heading: 0,
      rollAxisX: 1,
      rollAxisZ: 0,
      roll: 0,
      rollSpeed: 0,
      lyingRoll: 0,
      onGround: false,
      off: 0,
      limp: 0,
      stride: 0,
    },
  }
}

/** Brings the scooter to a gentle stop, while a parcel changes hands. */
export const HOLD_INPUT: DriveInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: true,
}

const NO_INPUT: DriveInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
}

/** The rider's hips, sitting or standing, and lying flat on the ground, in metres up. */
const RIDER_HIP_HEIGHT = 0.93
const LYING_HIP_HEIGHT = 0.17
/** Where the seat is, from the scooter's middle, in metres back. Matches `HIP` in Rider.tsx. */
const SEAT_BACK = 0.36
/** Share of the scooter's speed the rider carries on with. */
const RIDER_CARRY = 0.65
/** A body sliding on tarmac slows by this much each second, in m/s. */
const RIDER_SLIDE_FRICTION = 8.5
const RIDER_RADIUS = 0.3
/** How long each part of coming off takes, in seconds. */
const RIDER_MIN_THROWN = 0.8
const RIDER_LIE_TIME = 0.6
const RIDER_RISE_TIME = 0.7
const RIDER_MOUNT_TIME = 0.55
const RIDER_WALK_SPEED = 4
/** Close enough to the seat to get on, in metres. */
const RIDER_REACH = 0.7

/**
 * Throws the rider off, over the bars. They carry on with most of the speed
 * they had, come up off the seat, and roll forward, more the faster they were going.
 */
function throwRiderOff(state: ScooterState, travelX: number, travelZ: number) {
  const rider = state.rider
  const speed = Math.hypot(travelX, travelZ)
  rider.phase = 'thrown'
  rider.time = 0
  rider.x = state.x - Math.sin(state.heading) * SEAT_BACK
  rider.y = RIDER_HIP_HEIGHT
  rider.z = state.z - Math.cos(state.heading) * SEAT_BACK
  rider.velocityX = travelX * RIDER_CARRY
  rider.velocityY = Math.min(1.2 + speed * 0.08, 2.6)
  rider.velocityZ = travelZ * RIDER_CARRY
  rider.heading = state.heading
  // To roll forward along the travel (u, w), the body turns about the level axis (w, 0, -u).
  rider.rollAxisX = travelZ / speed
  rider.rollAxisZ = -travelX / speed
  rider.roll = 0
  rider.rollSpeed = Math.min(speed * 0.45, 6)
  rider.onGround = false
  rider.off = 1
  rider.limp = 0.3
}

/** The nearest angle at which the body lies flat, face down or on its back. */
function nearestLyingRoll(roll: number): number {
  return Math.round((roll - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2
}

/**
 * The thrown rider, step by step: through the air under gravity, then sliding
 * to a stop, settling flat, lying still, getting up, walking back to the
 * scooter, and getting on. It's simple maths rather than Rapier, as there's
 * only one rider and the path matters more than the bounces.
 */
function stepThrownRider(state: ScooterState, collisions: CollisionWorld, dt: number) {
  const rider = state.rider
  rider.time += dt
  const seatX = state.x - Math.sin(state.heading) * SEAT_BACK
  const seatZ = state.z - Math.cos(state.heading) * SEAT_BACK

  if (rider.phase === 'thrown') {
    rider.limp = Math.min(1, rider.limp + dt * 5)
    rider.x += rider.velocityX * dt
    rider.z += rider.velocityZ * dt

    // Hips are high when upright and low when flat, so the ground they rest on depends on the roll.
    // Upside down counts as low too: nobody stays in a headstand.
    const upright = Math.max(0, Math.cos(rider.roll))
    const restHeight = LYING_HIP_HEIGHT + (RIDER_HIP_HEIGHT - LYING_HIP_HEIGHT) * upright * upright
    if (!rider.onGround) {
      rider.velocityY -= 9.81 * dt
      rider.y += rider.velocityY * dt
      rider.onGround = rider.y <= restHeight
    }
    const grounded = rider.onGround
    if (grounded) {
      // Rolling changes how high the hips rest, so they ease there rather than jumping, and never take off again.
      rider.y += (restHeight - rider.y) * (1 - Math.exp(-12 * dt))
      rider.velocityY = 0
      const speed = Math.hypot(rider.velocityX, rider.velocityZ)
      const slowed = Math.max(0, speed - RIDER_SLIDE_FRICTION * dt)
      rider.velocityX *= speed > 0 ? slowed / speed : 0
      rider.velocityZ *= speed > 0 ? slowed / speed : 0
      // Rubbing on the ground stops the roll, and the body settles flat.
      rider.rollSpeed *= Math.exp(-6 * dt)
      rider.roll += (nearestLyingRoll(rider.roll) - rider.roll) * (1 - Math.exp(-9 * dt))
    }
    rider.roll += rider.rollSpeed * dt

    // Walls stop a thrown rider dead.
    const before = { x: rider.x, z: rider.z }
    pushOutOfBuildings(collisions, rider, RIDER_RADIUS)
    if (rider.x !== before.x || rider.z !== before.z) {
      rider.velocityX = 0
      rider.velocityZ = 0
      // Hitting a wall stops most of the roll too.
      rider.rollSpeed *= 0.3
    }

    const stopped = grounded && Math.hypot(rider.velocityX, rider.velocityZ) < 0.3
    if (stopped && rider.time > RIDER_MIN_THROWN) {
      rider.phase = 'lying'
      rider.time = 0
      // Whole turns don't matter once they're down, so getting up never turns them the long way round.
      const lying = nearestLyingRoll(rider.roll)
      rider.roll = Math.atan2(Math.sin(lying), Math.cos(lying))
    }
    return
  }

  if (rider.phase === 'lying') {
    if (rider.time > RIDER_LIE_TIME) {
      rider.phase = 'rising'
      rider.time = 0
      rider.lyingRoll = rider.roll
    }
    return
  }

  if (rider.phase === 'rising') {
    const amount = Math.min(1, rider.time / RIDER_RISE_TIME)
    const eased = amount * amount * (3 - 2 * amount)
    rider.limp = 1 - eased
    rider.y = LYING_HIP_HEIGHT + (RIDER_HIP_HEIGHT - LYING_HIP_HEIGHT) * eased
    if (amount >= 1) {
      rider.phase = 'walking'
      rider.time = 0
      rider.roll = 0
      rider.y = RIDER_HIP_HEIGHT
      rider.limp = 0
      return
    }
    // Rolls back from flat to upright, by turning the lying angle down towards 0.
    rider.roll = rider.lyingRoll * (1 - eased)
    return
  }

  if (rider.phase === 'walking') {
    const toSeatX = seatX - rider.x
    const toSeatZ = seatZ - rider.z
    const distance = Math.hypot(toSeatX, toSeatZ)
    if (distance <= RIDER_REACH) {
      rider.phase = 'mounting'
      rider.time = 0
      // The scooter is lifted back up while they climb on.
      state.crashLeft = SCOOTER.getUpTime
      return
    }
    const step = Math.min(distance, RIDER_WALK_SPEED * dt)
    rider.x += (toSeatX / distance) * step
    rider.z += (toSeatZ / distance) * step
    rider.heading = Math.atan2(toSeatX, toSeatZ)
    rider.stride += RIDER_WALK_SPEED * 3.2 * dt
    return
  }

  if (rider.phase === 'mounting') {
    rider.off = Math.max(0, 1 - rider.time / RIDER_MOUNT_TIME)
    if (rider.off === 0) rider.phase = 'on'
  }
}

/**
 * `travelX` and `travelZ` are the speed just before the hit, which is what the
 * rider carries on with if they're thrown off.
 */
function startCrash(state: ScooterState, side: number, strength: number, travelX: number, travelZ: number) {
  state.impact = Math.max(state.impact, Math.min(strength / 12, 1))
  if (state.crashLeft > 0) return

  state.crashLeft = SCOOTER.crashTime
  state.crashSide = side >= 0 ? 1 : -1
  state.crashCount++
  state.spin = state.crashSide * Math.min(strength * 0.5, 5)
  state.drifting = false
  state.boostLeft = 0
  if (Math.hypot(travelX, travelZ) > SCOOTER.throwOffSpeed) throwRiderOff(state, travelX, travelZ)
}

/**
 * Turns a scooter that's pressed against something towards running along it.
 * Steering fades out at low speed, so a nose against a wall can neither move nor
 * turn without this. It goes the way the rider is steering, or else the nearest way.
 */
function nudgeAlongSurface(state: ScooterState, normalX: number, normalZ: number, dt: number) {
  const towards = Math.atan2(normalZ, -normalX)
  const turnA = angleBetween(state.heading, towards)
  const turnB = angleBetween(state.heading, towards + Math.PI)

  const wanted = Math.sign(state.steer)
  const nearest = Math.abs(turnA) < Math.abs(turnB) ? turnA : turnB
  const steered = Math.sign(turnA) === wanted ? turnA : turnB
  const turn = wanted === 0 ? nearest : steered

  state.heading += turn * (1 - Math.exp(-SCOOTER.wallNudgeRate * dt))
}

/**
 * Applies a hit from something that isn't a wall. `changeX` and `changeZ` are
 * the speed the hit adds, and `pushX` and `pushZ` move the scooter clear of it.
 * It's called every frame the two touch, so `dt` is what a gentle press acts over.
 */
export function applyImpact(
  state: ScooterState,
  changeX: number,
  changeZ: number,
  pushX: number,
  pushZ: number,
  dt: number,
) {
  const pushLength = Math.hypot(pushX, pushZ)
  if (pushLength > 0) {
    const pressing =
      state.velocityX * pushX + state.velocityZ * pushZ < 0 && state.crashLeft === 0
    if (pressing) nudgeAlongSurface(state, pushX / pushLength, pushZ / pushLength, dt)
  }

  state.x += pushX
  state.z += pushZ
  state.velocityX += changeX
  state.velocityZ += changeZ

  const change = Math.hypot(changeX, changeZ)
  state.impact = Math.max(state.impact, Math.min(change / 12, 1))
  if (change > SCOOTER.impactCrashSpeed) {
    const side = changeX * Math.cos(state.heading) - changeZ * Math.sin(state.heading)
    startCrash(state, side, change, state.velocityX - changeX, state.velocityZ - changeZ)
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

  const targetGrip = input.handbrake ? SCOOTER.driftGrip : currentGrip()
  state.grip = moveToward(state.grip, targetGrip, SCOOTER.gripChangeRate * dt)
  state.boostLeft = Math.max(0, state.boostLeft - dt)
}

function updateSteering(state: ScooterState, input: DriveInput, dt: number) {
  const targetSteer = Number(input.left) - Number(input.right)
  state.steer = moveToward(state.steer, targetSteer, SCOOTER.steerRate * dt)

  const absoluteSpeed = Math.abs(state.speed)
  const speedRatio = Math.min(absoluteSpeed / tuning.maxSpeed, 1)
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
  const ratio = clamp(speed / tuning.maxSpeed, 0, 1)
  const engine =
    tuning.acceleration + (tuning.topEndAcceleration - tuning.acceleration) * ratio * ratio
  return boosting ? engine + SCOOTER.boostAcceleration : engine
}

/**
 * Slower than this, in metres per second, counts as stopped, so the throttle or
 * reverse drives instead of braking. Without it, a crash's fading spin leaves a
 * rounding-error speed such as -0.00000001 every frame. The throttle then
 * "brakes" that to zero, again and again, and the scooter never moves off.
 */
const STOPPED_SPEED = 0.05

/** Returns the new speed along the scooter's direction. */
function applyControls(speed: number, state: ScooterState, input: DriveInput, dt: number): number {
  const boosting = state.boostLeft > 0
  const limit = tuning.maxSpeed + (boosting ? SCOOTER.boostSpeed : 0)

  if (input.handbrake) {
    const drag = input.forward ? SCOOTER.powerSlideDrag : SCOOTER.handbrake
    return moveToward(speed, 0, drag * dt)
  }
  if (input.forward) {
    if (speed < -STOPPED_SPEED) return moveToward(speed, 0, tuning.braking * dt)
    if (speed > limit) return moveToward(speed, limit, SCOOTER.overspeedDrag * dt)
    return moveToward(speed, limit, engineForce(speed, boosting) * dt)
  }
  if (input.backward) {
    if (speed > STOPPED_SPEED) return moveToward(speed, 0, tuning.braking * dt)
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
  const limit = tuning.maxSpeed + (state.boostLeft > 0 ? SCOOTER.boostSpeed : 0)
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
  reactToPush(state, state.x - beforeX, state.z - beforeZ, dt)
}

function reactToPush(state: ScooterState, pushX: number, pushZ: number, dt: number) {
  const pushLength = Math.hypot(pushX, pushZ)
  const travelSpeed = getTravelSpeed(state)
  if (pushLength === 0 || travelSpeed === 0) return

  const normalX = pushX / pushLength
  const normalZ = pushZ / pushLength
  const intoWall = state.velocityX * normalX + state.velocityZ * normalZ
  if (intoWall >= 0) return

  const alongX = state.velocityX - normalX * intoWall
  const alongZ = state.velocityZ - normalZ * intoWall
  const travelX = state.velocityX
  const travelZ = state.velocityZ
  state.velocityX = alongX
  state.velocityZ = alongZ

  const hitSpeed = -intoWall
  const isCrash = hitSpeed > SCOOTER.wallCrashSpeed
  if (isCrash) {
    // Which side the wall is on decides which way the scooter falls.
    const side = normalX * Math.cos(state.heading) - normalZ * Math.sin(state.heading)
    startCrash(state, side, hitSpeed, travelX, travelZ)
  }

  const directness = hitSpeed / travelSpeed
  if (directness > SCOOTER.headOnThreshold) {
    const bounce = isCrash ? hitSpeed * SCOOTER.wallBounce : 0
    state.velocityX = normalX * bounce
    state.velocityZ = normalZ * bounce
    if (!isCrash) nudgeAlongSurface(state, normalX, normalZ, dt)
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

  state.x = clamp(nextX, WORLD_LIMITS.minX, WORLD_LIMITS.maxX)
  state.z = clamp(nextZ, WORLD_LIMITS.minZ, WORLD_LIMITS.maxZ)
  if (state.x !== nextX) state.velocityX = 0
  if (state.z !== nextZ) state.velocityZ = 0

  handleCollisions(state, collisions, dt)
  state.wheelSpin += (state.speed / SCOOTER.wheelRadius) * dt
}

/** Tilts the body. This changes how it looks, not where it goes. */
function updateBodyMotion(state: ScooterState, input: DriveInput, dt: number) {
  if (state.crashLeft > SCOOTER.getUpTime) {
    const fallen = state.crashSide * SCOOTER.crashLean
    state.lean = moveToward(state.lean, fallen, 7 * dt)
    return
  }

  const speedRatio = Math.min(Math.abs(state.speed) / tuning.maxSpeed, 1)

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
  const crashed = state.crashLeft > 0
  const controls = crashed ? NO_INPUT : input

  updateDrift(state, controls, dt)
  updateSteering(state, controls, dt)
  updateVelocity(state, controls, dt)

  if (crashed) {
    const skid = Math.exp(-SCOOTER.crashSkid * dt)
    state.velocityX *= skid
    state.velocityZ *= skid
    state.crashLeft = Math.max(0, state.crashLeft - dt)
  }

  if (state.rider.phase !== 'on') {
    stepThrownRider(state, collisions, dt)
    // The scooter stays on its side until the rider is back to pick it up.
    const { phase } = state.rider as { phase: RiderPhase }
    const away = phase !== 'on' && phase !== 'mounting'
    if (away) state.crashLeft = Math.max(state.crashLeft, SCOOTER.getUpTime + 0.05)
  }

  state.heading += state.spin * dt
  state.spin *= Math.exp(-3 * dt)
  state.impact *= Math.exp(-5 * dt)

  updatePosition(state, collisions, dt)
  updateBodyMotion(state, controls, dt)
}
