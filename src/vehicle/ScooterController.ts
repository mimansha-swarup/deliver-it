import { pushOutOfBuildings, type CollisionWorld } from '../world/collision'
import { analog } from './analogInput'
import { ROAD_HEIGHT, type Surface } from '../world/surface'
import { JOG, stridePerMetre } from './riderShape'
import { currentGrip, tuning } from './tuning'
import { liveRoom } from '../game/rooms'
import { liveView } from '../game/livePlayer'
import { SCOOTER, SCOOTER_SPAWN, WORLD_LIMITS } from './vehicleConfig'

export type DriveInput = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  handbrake: boolean
  /** Shift: burn nitro while the throttle is held. */
  nitro: boolean
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
  /** How full the nitro tank is, from 0 to 1, and whether it's burning. */
  nitro: number
  nitroOn: boolean
  /** Seconds until a cab can be jolted again (see `startCrash`). */
  joltLeft?: number
  /** How much of the engine's pull is on, 0 to 1: it follows the throttle at the vehicle's own rate (tuning.ts). */
  drive?: number
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
  /** Where each tyre meets the ground. See `followGround`. */
  frontWheel: WheelContact
  rearWheel: WheelContact
  /** Hard landings so far, and how hard the last was, from 0 to 1. `PlayerSounds` thuds for each. */
  bumpCount: number
  bump: number
  /** Breakers and potholes taken slowly enough not to be a bump (the tutorial counts these). */
  gentleCount: number
  /** How much water the tyres are in, eased so the grip comes back over a moment. */
  puddle: number
  /** Splashes so far, and how fast the scooter was going through the last, in m/s. `Splashes` throws water for each. */
  splashCount: number
  splashSpeed: number
}

/**
 * A tyre and the ground: how high the tyre's contact point is, in metres, how
 * fast it's dropping, in m/s (negative is rising), and how wet the ground under it is.
 */
export type WheelContact = { height: number; fall: number; wet: number }

/** What the rider is doing after coming off: in the air or sliding, lying still, getting up, walking back, getting on. */
/** `dismounting` and `afoot`: got off on purpose (F), and walking about under the player's own control (see `stepOnFoot`). */
export type RiderPhase = 'on' | 'thrown' | 'lying' | 'rising' | 'walking' | 'mounting' | 'dismounting' | 'afoot'

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
  /** Their place in a stride, in radians. A whole turn is two steps. */
  stride: number
  /** How fast they're jogging back, in m/s. */
  pace: number
  /** The height of the ground under them, eased so a kerb isn't a jump. */
  ground: number
  /**
   * Walking (`stepOnFoot`): how fast they're going over the ground each way, in m/s; how far they
   * lean into a turn (radians, positive to their left) and tip forward setting off or back pulling
   * up (radians, positive forward).
   */
  walkX: number
  walkZ: number
  lean: number
  tip: number
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
    nitro: SCOOTER.nitroStart,
    nitroOn: false,
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
      pace: 0,
      walkX: 0,
      walkZ: 0,
      lean: 0,
      tip: 0,
      ground: ROAD_HEIGHT,
    },
    // It starts on a road.
    frontWheel: { height: ROAD_HEIGHT, fall: 0, wet: 0 },
    rearWheel: { height: ROAD_HEIGHT, fall: 0, wet: 0 },
    bumpCount: 0,
    bump: 0,
    gentleCount: 0,
    puddle: 0,
    splashCount: 0,
    splashSpeed: 0,
  }
}

/** Brings the scooter to a gentle stop, while a parcel changes hands. */
export const HOLD_INPUT: DriveInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: true,
  nitro: false,
}

const NO_INPUT: DriveInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
  nitro: false,
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
/** Getting up to a jog takes this long, in seconds, and turning towards the scooter goes at this rate. */
const RIDER_SPEED_UP = 0.35
const RIDER_TURN_RATE = 9
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
  rider.ground = (state.frontWheel.height + state.rearWheel.height) / 2
  rider.x = state.x - Math.sin(state.heading) * SEAT_BACK
  rider.y = rider.ground + RIDER_HIP_HEIGHT
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
function stepThrownRider(state: ScooterState, collisions: CollisionWorld, surface: Surface, dt: number) {
  const rider = state.rider
  rider.time += dt
  rider.ground += (surface.heightAt(rider.x, rider.z, rider.ground) - rider.ground) * (1 - Math.exp(-20 * dt))
  const seatX = state.x - Math.sin(state.heading) * SEAT_BACK
  const seatZ = state.z - Math.cos(state.heading) * SEAT_BACK

  if (rider.phase === 'thrown') {
    rider.limp = Math.min(1, rider.limp + dt * 5)
    rider.x += rider.velocityX * dt
    rider.z += rider.velocityZ * dt

    // Hips are high when upright and low when flat, so the ground they rest on depends on the roll.
    // Upside down counts as low too: nobody stays in a headstand.
    const upright = Math.max(0, Math.cos(rider.roll))
    const restHeight = rider.ground + LYING_HIP_HEIGHT + (RIDER_HIP_HEIGHT - LYING_HIP_HEIGHT) * upright * upright
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
    rider.y = rider.ground + LYING_HIP_HEIGHT + (RIDER_HIP_HEIGHT - LYING_HIP_HEIGHT) * eased
    if (amount >= 1) {
      rider.phase = 'walking'
      rider.time = 0
      rider.roll = 0
      rider.pace = 0
      rider.y = rider.ground + RIDER_HIP_HEIGHT
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
      rider.pace = 0
      // The scooter is lifted back up while they climb on.
      state.crashLeft = SCOOTER.getUpTime
      return
    }
    // Picks up pace from a standstill, and eases off for the last stride or so.
    rider.pace = JOG.speed * Math.min(1, rider.time / RIDER_SPEED_UP, 0.4 + distance / 2)
    // Turns to face the scooter, rather than snapping round, and runs the way they face.
    rider.heading += angleBetween(rider.heading, Math.atan2(toSeatX, toSeatZ)) * (1 - Math.exp(-RIDER_TURN_RATE * dt))
    const step = Math.min(distance, rider.pace * dt)
    rider.x += Math.sin(rider.heading) * step
    rider.z += Math.cos(rider.heading) * step
    rider.y = rider.ground + RIDER_HIP_HEIGHT
    rider.stride += step * stridePerMetre(rider.pace)
    return
  }

  if (rider.phase === 'mounting') {
    rider.off = Math.max(0, 1 - rider.time / RIDER_MOUNT_TIME)
    if (rider.off === 0) rider.phase = 'on'
  }
}

/** Whether the rider is off the vehicle by choice: stepping off it, or walking about. */
export function isAfoot(state: ScooterState): boolean {
  return state.rider.phase === 'afoot' || state.rider.phase === 'dismounting'
}

/** On foot: walking and running speeds (m/s), how fast they're reached, turning, and how near the seat counts as beside the vehicle. */
/**
 * On foot. `walk` is a brisk walk and `run` (the nitro key held) a jog, in m/s: at 2.8 and 6 they
 * were a run and a sprint, and no walk's legs could keep up with the ground without skating.
 *
 * `ease`: how long they take to get up to speed and to pull up, in seconds (most of the way in that
 * time, then settling). `facing`: how quickly the body comes round to the way it's going (per
 * second), no faster than `turnMost` radians a second. `lean`: how far they lean into a turn, in
 * radians for each radian a second of turning at a jog, up to `leanMost`; `tip`: how far they tip
 * forward for each m/s² of setting off (and back, pulling up), up to `tipMost`.
 *
 * `radius`: the body's, as a capsule, in metres. `stepUp`: the highest rise it walks straight up,
 * in metres (a kerb is 0.15 to 0.2, a doorstep a little more); `stepRise` and `stepFall`: how
 * quickly it comes up onto one and down off one, per second.
 */
export const FOOT = { walk: 1.9, run: 4.3, ease: 0.24, facing: 11, turnMost: 9, lean: 0.045, leanMost: 0.16, tip: 0.012, tipMost: 0.09, radius: 0.3, stepUp: 0.45, stepRise: 18, stepFall: 12, dismountTime: 0.45, reach: 2.4 }
/** The vehicle must be slower than this to get off it, in m/s. */
const DISMOUNT_SPEED = 2

/** Where the rider stands having got off: beside the seat, on the kerb side of a two-wheeler, at the driver's door of a cab. */
function exitSpot(state: ScooterState, collisions: CollisionWorld): [number, number] {
  const forwardX = Math.sin(state.heading)
  const forwardZ = Math.cos(state.heading)
  // To the vehicle's left is (forwardZ, -forwardX). A cab's driver sits on the right and steps out there.
  const out = tuning.radius + 0.5
  const sides = tuning.cab ? [-1, 1] : [1, -1]
  const back = tuning.cab ? 0 : -SEAT_BACK
  for (const side of sides) {
    for (const along of [back, back - 0.8, back + 0.8]) {
      const x = state.x + forwardX * along + forwardZ * out * side
      const z = state.z + forwardZ * along - forwardX * out * side
      probe.x = x
      probe.z = z
      pushOutOfBuildings(collisions, probe, FOOT.radius)
      if (Math.hypot(probe.x - x, probe.z - z) < 0.05) return [x, z]
    }
  }
  return [state.x - forwardX * (tuning.halfLength + 0.5), state.z - forwardZ * (tuning.halfLength + 0.5)]
}
const probe = { x: 0, z: 0 }

/** F, stopped: the rider steps off. False if they can't (moving, mid-crash, already off). */
export function getOff(state: ScooterState, collisions: CollisionWorld): boolean {
  const rider = state.rider
  if (rider.phase !== 'on' || state.crashLeft > 0 || getTravelSpeed(state) > DISMOUNT_SPEED) return false
  const [x, z] = exitSpot(state, collisions)
  rider.phase = 'dismounting'
  rider.time = 0
  rider.x = x
  rider.z = z
  rider.ground = (state.frontWheel.height + state.rearWheel.height) / 2
  rider.y = rider.ground + RIDER_HIP_HEIGHT
  rider.heading = state.heading
  rider.walkX = 0
  rider.walkZ = 0
  rider.lean = 0
  rider.tip = 0
  rider.roll = 0
  rider.rollSpeed = 0
  rider.limp = 0
  rider.pace = 0
  rider.velocityX = 0
  rider.velocityY = 0
  rider.velocityZ = 0
  rider.onGround = true
  state.velocityX = 0
  state.velocityZ = 0
  state.drifting = false
  state.nitroOn = false
  return true
}

/** Whether the rider, on foot, is close enough to their vehicle to get on. */
export function isBesideVehicle(state: ScooterState): boolean {
  return state.rider.phase === 'afoot' && !liveRoom.kind && Math.hypot(state.rider.x - state.x, state.rider.z - state.z) < FOOT.reach + tuning.halfLength * 0.6
}

/** F, on foot beside the vehicle: the rider gets on. */
export function getOn(state: ScooterState): boolean {
  if (!isBesideVehicle(state)) return false
  state.rider.phase = 'mounting'
  state.rider.time = 0
  state.rider.pace = 0
  return true
}

/**
 * The rider on foot, under the player's control: forward and back walk (the nitro key runs), left
 * and right turn. Kept out of walls, compound walls, poles and parked vehicles like everything
 * else, up and down kerbs with the ground; inside a room (game/rooms.ts), kept within its walls
 * and off its furniture.
 */
/**
 * Eases a walker's speed towards the speed wanted, turns their body to the way they're going, and
 * works out their lean. Nothing snaps: the speed closes most of the gap in `FOOT.ease` seconds
 * (setting off and pulling up alike), and the body comes round at a rate that's quick at first
 * and gentle at the end, never faster than a person can turn.
 */
function walkTowards(rider: ThrownRider, wishX: number, wishZ: number, dt: number) {
  const before = Math.hypot(rider.walkX, rider.walkZ)
  const blend = 1 - Math.exp(-dt / (FOOT.ease / 2.3))
  rider.walkX += (wishX - rider.walkX) * blend
  rider.walkZ += (wishZ - rider.walkZ) * blend
  const speed = Math.hypot(rider.walkX, rider.walkZ)
  if (speed < 0.03 && wishX === 0 && wishZ === 0) {
    rider.walkX = 0
    rider.walkZ = 0
  }
  // Round to the way they're going, once they're going anywhere; standing, they keep facing as they were.
  const towards = speed > 0.25 ? Math.atan2(rider.walkX, rider.walkZ) : rider.heading
  const off = Math.atan2(Math.sin(towards - rider.heading), Math.cos(towards - rider.heading))
  const turn = Math.max(-FOOT.turnMost * dt, Math.min(FOOT.turnMost * dt, off * (1 - Math.exp(-FOOT.facing * dt))))
  rider.heading += turn
  // Into the turn, the more the faster they're going; forward as they set off, back as they pull up.
  const settle = 1 - Math.exp(-8 * dt)
  const turning = dt > 0 ? turn / dt : 0
  const lean = Math.max(-FOOT.leanMost, Math.min(FOOT.leanMost, turning * FOOT.lean * Math.min(1, speed / FOOT.run + 0.35)))
  rider.lean += (lean - rider.lean) * settle
  const gaining = dt > 0 ? (speed - before) / dt : 0
  const tip = Math.max(-FOOT.tipMost, Math.min(FOOT.tipMost, gaining * FOOT.tip))
  rider.tip += (tip - rider.tip) * settle
}

function stepOnFoot(state: ScooterState, input: DriveInput, collisions: CollisionWorld, surface: Surface, dt: number) {
  const rider = state.rider
  rider.time += dt
  if (rider.phase === 'dismounting') {
    // Swings a leg over and steps down beside it: the pose blends from the seat to standing.
    rider.off = Math.min(1, rider.time / FOOT.dismountTime)
    if (rider.off >= 1) {
      rider.phase = 'afoot'
      rider.time = 0
    }
    return
  }
  rider.off = 1
  rider.limp = 0
  rider.roll = 0
  // The keys are read against the camera, as in any third-person game: forward walks the way the
  // camera is looking, back towards it, left and right across it, and the body turns to the way
  // it's going. Turning the view with the mouse turns where forward is.
  const ahead = Number(input.forward) - Number(input.backward)
  const across = Number(input.left) - Number(input.right)
  const yaw = liveView.cameraYaw
  // The camera's forward is (sin, cos) of its yaw, and its left (cos, -sin).
  let wishX = Math.sin(yaw) * ahead + Math.cos(yaw) * across
  let wishZ = Math.cos(yaw) * ahead - Math.sin(yaw) * across
  const any = Math.hypot(wishX, wishZ)
  const wanted = liveRoom.frozen || any === 0 ? 0 : input.nitro ? FOOT.run : FOOT.walk
  wishX = any > 0 ? (wishX / any) * wanted : 0
  wishZ = any > 0 ? (wishZ / any) * wanted : 0
  walkTowards(rider, wishX, wishZ, dt)
  const fromX = rider.x
  const fromZ = rider.z
  // The body is an upright capsule, `FOOT.radius` round. It moves in steps shorter than that, so it
  // never gets far into anything; whatever it's then in pushes it straight back out, and the part of
  // its speed that was into the thing is taken off. What's left is along the wall: it slides, at the
  // speed it really has along it, and comes off the end of the wall without a stored shove into it.
  const pieces = Math.max(1, Math.ceil((Math.hypot(rider.walkX, rider.walkZ) * dt) / (FOOT.radius * 0.4)))
  for (let piece = 0; piece < pieces; piece++) {
    rider.x += (rider.walkX * dt) / pieces
    rider.z += (rider.walkZ * dt) / pieces
    const freeX = rider.x
    const freeZ = rider.z
    if (liveRoom.kind) liveRoom.keepInside(rider, FOOT.radius)
    else {
      rider.x = clamp(rider.x, WORLD_LIMITS.minX, WORLD_LIMITS.maxX)
      rider.z = clamp(rider.z, WORLD_LIMITS.minZ, WORLD_LIMITS.maxZ)
      pushOutOfBuildings(collisions, rider, FOOT.radius)
      // Not through their own vehicle either.
      const awayX = rider.x - state.x
      const awayZ = rider.z - state.z
      const gap = Math.hypot(awayX, awayZ)
      const keep = tuning.radius + FOOT.radius * 0.6
      if (gap < keep && gap > 0.001) {
        rider.x = state.x + (awayX / gap) * keep
        rider.z = state.z + (awayZ / gap) * keep
      }
      // Up a kerb or a step (`FOOT.stepUp`) they simply go. Anything higher is a ledge, and stops them like a wall.
      if (surface.heightAt(rider.x, rider.z, rider.ground) - rider.ground > FOOT.stepUp) {
        rider.x = freeX - (rider.walkX * dt) / pieces
        rider.z = freeZ - (rider.walkZ * dt) / pieces
      }
    }
    const outX = rider.x - freeX
    const outZ = rider.z - freeZ
    const out = Math.hypot(outX, outZ)
    if (out > 0.0005) {
      const into = (rider.walkX * outX + rider.walkZ * outZ) / out
      if (into < 0) {
        rider.walkX -= (outX / out) * into
        rider.walkZ -= (outZ / out) * into
      }
    }
  }
  if (liveRoom.kind) rider.ground = liveRoom.floorY
  else {
    // The ground under them: up a kerb quickly, as a foot is lifted onto it; down a little slower, as the body follows the step.
    const ground = surface.heightAt(rider.x, rider.z, rider.ground)
    rider.ground += (ground - rider.ground) * (1 - Math.exp(-(ground > rider.ground ? FOOT.stepRise : FOOT.stepFall) * dt))
  }
  rider.y = rider.ground + RIDER_HIP_HEIGHT
  // The legs go by the ground actually covered, not the speed asked for: walking into a wall, or
  // along one, the feet keep to what the body really does and don't skate. The stride per metre is
  // the gait's own at that speed (riderShape.ts), so a planted foot stays planted in a walk, a jog
  // and anything between.
  const covered = Math.hypot(rider.x - fromX, rider.z - fromZ)
  rider.pace += (covered / Math.max(dt, 0.001) - rider.pace) * (1 - Math.exp(-18 * dt))
  rider.stride += covered * stridePerMetre(rider.pace)
}

/**
 * `travelX` and `travelZ` are the speed just before the hit, which is what the
 * rider carries on with if they're thrown off.
 */
/** How much of its speed a cab comes back off a wall with (a scooter: `SCOOTER.wallBounce`). */
const CAB_WALL_BOUNCE = 0.04
/** A knock in a cab: no other for this long (s), and this share of the speed is left after it. */
const JOLT_GAP = 0.9
const JOLT_KEEPS = 0.35

function startCrash(state: ScooterState, side: number, strength: number, travelX: number, travelZ: number) {
  state.impact = Math.max(state.impact, Math.min(strength / 12, 1))
  if (state.crashLeft > 0) return
  // Inside a cab (a car, a van, the three-wheeler) nobody's thrown: a jolt, the speed knocked off it,
  // a dent, and on it goes. It still counts as a crash (a rental's damage, the thud).
  if (tuning.cab) {
    if ((state.joltLeft ?? 0) > 0) return
    state.joltLeft = JOLT_GAP
    state.crashCount++
    tuning.dents++
    state.impact = Math.max(state.impact, 0.55 + Math.min(strength / 20, 0.45))
    state.velocityX *= JOLT_KEEPS
    state.velocityZ *= JOLT_KEEPS
    state.drifting = false
    return
  }

  state.crashLeft = SCOOTER.crashTime
  state.crashSide = side >= 0 ? 1 : -1
  state.crashCount++
  state.spin = state.crashSide * Math.min(strength * 0.5, 5)
  state.drifting = false
  state.boostLeft = 0
  state.nitroOn = false
  // Nobody's thrown from a vehicle they aren't on (it was parked, and something hit it).
  if (state.rider.phase === 'on' && Math.hypot(travelX, travelZ) > SCOOTER.throwOffSpeed) throwRiderOff(state, travelX, travelZ)
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
      state.nitro = Math.min(1, state.nitro + SCOOTER.nitroFromBoost)
    }
    state.drifting = false
    state.driftTime = 0
  }

  // A tyre in a puddle grips less, for a moment.
  const targetGrip = (input.handbrake ? SCOOTER.driftGrip : currentGrip()) * (1 - SCOOTER.puddleGripLoss * state.puddle)
  state.grip = moveToward(state.grip, targetGrip, SCOOTER.gripChangeRate * dt)
  state.boostLeft = Math.max(0, state.boostLeft - dt)
}

const SPEED_LOCK = { from: 12, to: 23, least: 0.6 }

function updateSteering(state: ScooterState, input: DriveInput, dt: number) {
  // A stick steers by how far it's pushed; the keys, all the way.
  const targetSteer = analog.steer !== null && input !== NO_INPUT && input !== HOLD_INPUT ? analog.steer : Number(input.left) - Number(input.right)
  state.steer = moveToward(state.steer, targetSteer, SCOOTER.steerRate * dt)

  const absoluteSpeed = Math.abs(state.speed)
  const speedRatio = Math.min(absoluteSpeed / tuning.maxSpeed, 1)
  const steeringFade = Math.min(absoluteSpeed / SCOOTER.fullSteeringSpeed, 1)
  const driftBoost = state.drifting ? SCOOTER.driftTurnBoost : 1
  // A little tighter still at walking and turning speeds, below about 20 km/h, for junctions.
  const slowTurn = 1 + SCOOTER.slowTurnBoost * Math.max(0, 1 - absoluteSpeed / SCOOTER.slowTurnSpeed)
  const turnRate =
    (SCOOTER.turnRateLow + (SCOOTER.turnRateHigh - SCOOTER.turnRateLow) * speedRatio) * slowTurn * tuning.turn

  // Steering further into a slide fades out as it nears the limit. A slip to the
  // right means the scooter has turned left, so that's when steering left is "further".
  const slipAngle = Math.atan2(state.slip, Math.max(Math.abs(state.speed), 1))
  const steeringDeeper = state.drifting && state.steer * slipAngle < 0
  const driftLimit = steeringDeeper
    ? clamp(1 - Math.abs(slipAngle) / SCOOTER.maxDriftAngle, 0, 1)
    : 1

  // Every vehicle steers as the scooter does (each one's `turn` is 1): a car that needed a wider
  // swing than the scooter at every junction was no fun, however true.
  // At speed the steering has less lock, as a fast car's does: full below `SPEED_LOCK.from` m/s, down
  // to `SPEED_LOCK.least` of it by `SPEED_LOCK.to`. The scooter barely reaches it; a car at 80 km/h
  // changes lanes on a tap where it used to swerve.
  const lock = 1 - (1 - SPEED_LOCK.least) * clamp((absoluteSpeed - SPEED_LOCK.from) / (SPEED_LOCK.to - SPEED_LOCK.from), 0, 1)
  const turning = state.steer * turnRate * driftBoost * driftLimit * steeringFade * lock
  // Math.sign flips the steering in reverse, as on a real vehicle.
  state.heading += turning * Math.sign(state.speed) * dt
}

/**
 * Burns nitro while Shift and the throttle are held, and fills the tank while
 * riding: faster the nearer top speed. Starting needs a little in the tank, so
 * a nearly empty one doesn't flicker on and off.
 */
function updateNitro(state: ScooterState, input: DriveInput, dt: number) {
  const wanted = input.nitro && input.forward && !input.handbrake && state.speed > 0
  if (!wanted || !tuning.nitro || tuning.limp < 0.5) state.nitroOn = false
  else if (!state.nitroOn && state.nitro >= SCOOTER.nitroMinToStart) state.nitroOn = true

  if (state.nitroOn) {
    state.nitro = Math.max(0, state.nitro - dt / SCOOTER.nitroBurnTime)
    if (state.nitro === 0) state.nitroOn = false
  } else if (state.speed > 0) {
    const ratio = clamp(state.speed / tuning.maxSpeed, 0, 1)
    state.nitro = Math.min(1, state.nitro + (ratio * ratio * dt) / SCOOTER.nitroFillTime)
  }
}

/** How far a drift boost and nitro lift the speed limit, together. */
function speedLimit(state: ScooterState): number {
  // An empty tank crawls; a breakdown doesn't go at all (game/upkeep.ts, game/breakdowns.ts).
  return (tuning.maxSpeed + (state.boostLeft > 0 ? SCOOTER.boostSpeed : 0) + (state.nitroOn ? SCOOTER.nitroSpeed : 0)) * tuning.limp
}

/** The engine's pull at this speed: strongest from a standstill, falling off evenly towards top speed. Boosts add to it. */
function engineForce(speed: number, state: ScooterState): number {
  const ratio = clamp(speed / tuning.maxSpeed, 0, 1)
  const engine = tuning.acceleration + (tuning.topEndAcceleration - tuning.acceleration) * ratio
  return engine + (state.boostLeft > 0 ? SCOOTER.boostAcceleration : 0) + (state.nitroOn ? SCOOTER.nitroAcceleration : 0)
}

/**
 * Slower than this, in metres per second, counts as stopped, so the throttle or
 * reverse drives instead of braking. Without it, a crash's fading spin leaves a
 * rounding-error speed such as -0.00000001 every frame. The throttle then
 * "brakes" that to zero, again and again, and the scooter never moves off.
 */
const STOPPED_SPEED = 0.05

/** The share of top speed the lightest touch of an analog throttle holds. */
const PART_THROTTLE = 0.3

/** Returns the new speed along the scooter's direction. */
function applyControls(speed: number, state: ScooterState, input: DriveInput, dt: number): number {
  const limit = speedLimit(state)

  if (input.handbrake) {
    const drag = input.forward ? SCOOTER.powerSlideDrag : SCOOTER.handbrake
    return moveToward(speed, 0, drag * dt)
  }
  if (input.forward) {
    if (speed < -STOPPED_SPEED) return moveToward(speed, 0, tuning.braking * dt)
    if (speed > limit) return moveToward(speed, limit, SCOOTER.overspeedDrag * dt)
    // The drive comes in as fast as this vehicle's does: at once on an electric motor, slowly in a loaded van.
    state.drive = Math.min(1, (state.drive ?? 0) + tuning.response * dt)
    // A trigger part-way down is part of the pull, and holds a lower speed: a third of the top at a touch, all of it flat out.
    const throttle = analog.throttle ?? 1
    const holds = limit * (PART_THROTTLE + (1 - PART_THROTTLE) * throttle)
    if (speed > holds) return moveToward(speed, holds, tuning.coasting * dt)
    return moveToward(speed, holds, engineForce(speed, state) * state.drive * throttle * dt)
  }
  state.drive = Math.max(0, (state.drive ?? 0) - tuning.response * 2 * dt)
  if (input.backward) {
    // The brake trigger part-way down brakes that much (never less than a fifth: a touch still slows).
    if (speed > STOPPED_SPEED) return moveToward(speed, 0, tuning.braking * Math.max(0.2, analog.brake ?? 1) * dt)
    return moveToward(speed, -SCOOTER.maxReverseSpeed, SCOOTER.reverseAcceleration * dt)
  }
  // Off the throttle, it coasts down as usual, whatever the speed.
  return moveToward(speed, 0, tuning.coasting * dt)
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
  const limit = speedLimit(state)
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
const footprintProbe = { x: 0, z: 0 }

function handleCollisions(state: ScooterState, collisions: CollisionWorld, dt: number) {
  const beforeX = state.x
  const beforeZ = state.z
  if (state.joltLeft) state.joltLeft = Math.max(0, state.joltLeft - dt)
  // Its real footprint: circles of its half width along its length (one, for a two-wheeler), each
  // kept out of everything solid. A gap narrower than a van doesn't let a van through.
  const reach = tuning.halfLength - tuning.radius
  if (reach <= 0.05) pushOutOfBuildings(collisions, state, tuning.radius)
  else {
    const forwardX = Math.sin(state.heading)
    const forwardZ = Math.cos(state.heading)
    const steps = Math.max(2, Math.ceil((reach * 2) / (tuning.radius * 1.1)))
    for (let i = 0; i <= steps; i++) {
      const along = -reach + (2 * reach * i) / steps
      footprintProbe.x = state.x + forwardX * along
      footprintProbe.z = state.z + forwardZ * along
      const probeX = footprintProbe.x
      const probeZ = footprintProbe.z
      pushOutOfBuildings(collisions, footprintProbe, tuning.radius)
      state.x += footprintProbe.x - probeX
      state.z += footprintProbe.z - probeZ
    }
  }
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
    // A scooter that hits a wall is thrown back off it. A car stops against it: bounced back, it
    // lurched backwards and forwards at every touch.
    const bounce = isCrash ? hitSpeed * (tuning.cab ? CAB_WALL_BOUNCE : SCOOTER.wallBounce) : 0
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

/**
 * The furthest the scooter moves between collision checks, in metres. A compound
 * wall is 0.25 m thick and the scooter 0.6 m round: moving further than their
 * sum in one go, its middle can land past the wall's middle, and the push out
 * then sends it through. With nitro on a slow frame it moves over a metre.
 */
const MAX_STEP_TRAVEL = 0.25
const MAX_SUBSTEPS = 10

function updatePosition(state: ScooterState, collisions: CollisionWorld, dt: number) {
  const travel = Math.hypot(state.velocityX, state.velocityZ) * dt
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(travel / MAX_STEP_TRAVEL)))
  const stepTime = dt / steps

  for (let step = 0; step < steps; step++) {
    const nextX = state.x + state.velocityX * stepTime
    const nextZ = state.z + state.velocityZ * stepTime

    state.x = clamp(nextX, WORLD_LIMITS.minX, WORLD_LIMITS.maxX)
    state.z = clamp(nextZ, WORLD_LIMITS.minZ, WORLD_LIMITS.maxZ)
    if (state.x !== nextX) state.velocityX = 0
    if (state.z !== nextZ) state.velocityZ = 0

    handleCollisions(state, collisions, stepTime)
  }
  state.wheelSpin += (state.speed / SCOOTER.wheelRadius) * dt
}

/**
 * Moves one tyre's height towards the ground under it, and returns how fast it
 * landed, in m/s, if it came down this step (0 otherwise). Going up a step or a
 * hump, it rolls up over a little forward travel, as a round wheel meets an
 * edge, and keeps some of that upward speed: off the top of a breaker taken
 * fast, it leaves the ground for a moment. Going down an edge, it falls under gravity,
 * so riding off a kerb is a little drop and a landing rather than a snap; down a slope it rolls.
 */
function followGround(wheel: WheelContact, ground: number, travelled: number, dt: number): number {
  if (ground > wheel.height) {
    const climb = Math.min(ground - wheel.height, Math.max(travelled * SCOOTER.climbPerMetre, SCOOTER.climbAtCrawl * dt))
    wheel.height += climb
    // The suspension soaks up most of the push; the rest carries the wheel on upwards.
    wheel.fall = Math.min(wheel.fall, -Math.min(SCOOTER.maxLaunch, (climb / dt) * SCOOTER.launchShare))
    return 0
  }
  // Rolling down a slope (a flyover's ramp, a breaker's far side taken gently), a tyre on the ground
  // stays on it. Without this it fell from rest each step, caught the road up and landed hard, over
  // and over: a smooth ramp rode like a staircase on the way down. A real edge (a kerb) is far
  // steeper than `stickSlope`, so it's still a drop and a landing.
  const drop = wheel.height - ground
  if (wheel.fall === 0 && drop > 0 && drop <= travelled * SCOOTER.stickSlope) {
    wheel.height = ground
    return 0
  }
  wheel.fall += 9.81 * dt
  wheel.height -= wheel.fall * dt
  if (wheel.height > ground) return 0
  const landing = Math.max(0, wheel.fall)
  wheel.height = ground
  wheel.fall = 0
  return landing
}

/** Finds the ground under each tyre: road, breaker, pothole, kerb, pavement or soil. Lands hard, and splashes. */
function updateWheelContacts(state: ScooterState, surface: Surface, wetness: number, dt: number) {
  const forwardX = Math.sin(state.heading)
  const forwardZ = Math.cos(state.heading)
  const speed = getTravelSpeed(state)
  const travelled = speed * dt
  let landing = 0
  for (const [wheel, axle] of [[state.frontWheel, SCOOTER.frontAxle], [state.rearWheel, SCOOTER.rearAxle]] as const) {
    const x = state.x + forwardX * axle
    const z = state.z + forwardZ * axle
    landing = Math.max(landing, followGround(wheel, surface.heightAt(x, z, wheel.height), travelled, dt))

    // Into a puddle fast throws up water. It needs rain to have filled it.
    const wet = surface.wetAt(x, z) * wetness
    if (wet > SCOOTER.splashWetness && wheel.wet <= SCOOTER.splashWetness && speed > SCOOTER.splashSpeed) {
      state.splashCount++
      state.splashSpeed = speed
    }
    wheel.wet = wet
  }

  // A hard landing jolts the camera, thuds, and costs a little speed. Taken slowly, it's no bump at all.
  const slow = speed < tuning.maxSpeed * SCOOTER.bumpSpeedShare
  // A breaker or pothole taken slowly: no bump, but worth knowing about.
  if (slow && landing > SCOOTER.gentleLanding && state.crashLeft === 0 && speed > 0.5) state.gentleCount++
  if (landing > SCOOTER.joltSpeed && state.crashLeft === 0 && !slow) {
    const strength = Math.min(1, (landing - SCOOTER.joltSpeed) / 2)
    state.bump = strength
    state.bumpCount++
    state.impact = Math.max(state.impact, 0.15 + strength * 0.35)
    const keep = 1 - SCOOTER.landingSpeedLoss * strength
    state.velocityX *= keep
    state.velocityZ *= keep
  }

  // Water under the tyres takes away grip, and it comes back over a moment once they're through.
  const water = Math.max(state.frontWheel.wet, state.rearWheel.wet)
  state.puddle = Math.max(water, state.puddle * Math.exp(-SCOOTER.puddleGripReturn * dt))
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

/** How high the scooter is: its lower wheel, or the rider's ground while they're off it. Up on a flyover, metres above the street. */
export function scooterLevel(state: ScooterState): number {
  if (isAfoot(state)) return state.rider.ground
  return state.rider.phase === 'on' ? Math.min(state.frontWheel.height, state.rearWheel.height) : Math.min(state.rider.ground, state.frontWheel.height)
}

/** Advances the scooter by `dt` seconds. Updates `state` in place. */
export function stepScooter(
  state: ScooterState,
  input: DriveInput,
  collisions: CollisionWorld,
  surface: Surface,
  dt: number,
  /** How full the puddles are, from 0 to 1. See `water` in roadFeatures.ts. */
  wetness = 0,
) {
  const crashed = state.crashLeft > 0
  // Parked with the rider off it and walking: the vehicle holds its brake, and the keys move the rider.
  const afoot = isAfoot(state)
  // (Getting back on, too: it doesn't pull away until the rider is in the seat.)
  const controls = crashed ? NO_INPUT : afoot || state.rider.phase === 'mounting' ? HOLD_INPUT : input

  updateDrift(state, controls, dt)
  updateNitro(state, controls, dt)
  updateSteering(state, controls, dt)
  updateVelocity(state, controls, dt)

  if (crashed) {
    const skid = Math.exp(-SCOOTER.crashSkid * dt)
    state.velocityX *= skid
    state.velocityZ *= skid
    state.crashLeft = Math.max(0, state.crashLeft - dt)
  }

  if (afoot) stepOnFoot(state, input, collisions, surface, dt)
  else if (state.rider.phase !== 'on') {
    stepThrownRider(state, collisions, surface, dt)
    // The scooter stays on its side until the rider is back to pick it up.
    const { phase } = state.rider as { phase: RiderPhase }
    const away = phase !== 'on' && phase !== 'mounting'
    if (away) state.crashLeft = Math.max(state.crashLeft, SCOOTER.getUpTime + 0.05)
  }

  state.heading += state.spin * dt
  state.spin *= Math.exp(-3 * dt)
  state.impact *= Math.exp(-5 * dt)

  updatePosition(state, collisions, dt)
  updateWheelContacts(state, surface, wetness, dt)
  updateBodyMotion(state, controls, dt)
}
