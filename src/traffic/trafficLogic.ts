import type { CrashPhysics, CrashShape, Quaternion, Tumbler } from '../physics/crashPhysics'
import { uprightness } from '../physics/crashPhysics'
import { applyImpact, getTravelSpeed, type ScooterState } from '../vehicle/ScooterController'
import { SCOOTER } from '../vehicle/vehicleConfig'
import type { CollisionWorld } from '../world/collision'
import type { Prop } from '../world/props'
import type { RoadGraph } from '../world/roadGraph'
import { createLanes, type Lane } from './lanes'
import { createTrafficSignals, findStopAhead, type TrafficSignals } from './trafficSignals'

export const TRAFFIC_RULES = {
  maxVehicles: 34,
  maxPedestrians: 36,

  /**
   * New vehicles appear in this ring around the rider, in metres. It's kept close,
   * so the traffic is packed around you rather than spread over the whole map.
   */
  vehicleSpawnMin: 90,
  vehicleSpawnMax: 180,
  vehicleRemoveAt: 220,
  /** New pedestrians appear in this ring around the rider, in metres. */
  pedestrianSpawnMin: 70,
  pedestrianSpawnMax: 180,
  pedestrianRemoveAt: 210,

  walkSpeed: 1.3,
  acceleration: 3,
  /** A new vehicle won't appear this close to another one, in metres. */
  spawnGap: 8,
  braking: 9,

  /**
   * Bumper to bumper, Bengaluru style: the space cars leave in front, and the
   * smaller space two-wheelers and autos leave, in metres.
   */
  carGap: 1.4,
  nimbleGap: 0.6,
  lookAhead: 20,
  /** Room left beside something when passing it, in metres. */
  sideClearance: 0.15,

  /**
   * How far two-wheelers and autos squeeze over to get past, in metres. Negative
   * is right. Right goes past cars, partly into the other side of the road. Left,
   * along the kerb, only fits past other two-wheelers.
   */
  squeezeRight: -1.8,
  squeezeLeft: 1,
  /** How quickly they move sideways, in metres per second. */
  squeezeSpeed: 1.3,
  /** Something nearer than this ahead, in metres, makes them look for a way round. */
  squeezeLookAt: 8,
  /** Share of two-wheelers and autos that don't stop for red lights. */
  bikeRebels: 0.35,
  autoRebels: 0.25,

  /** Honking. Stuck behind the rider, they lean on it after this many seconds. */
  honkAtRiderAfter: 0.5,
  /** Chance per second of a honk while stuck in a queue, or while moving. */
  queueHonkRate: 0.05,
  movingHonkRate: 0.012,
  /** Nobody further away than this is heard, in metres. */
  honkHearing: 70,
  /** A vehicle crossing this close in front counts as being in the way, in metres. */
  junctionRange: 9,
  /**
   * After waiting this long for a vehicle crossing in front, go anyway. It clears
   * a rare deadlock at junctions. It never applies in a queue, or vehicles would
   * drive through each other.
   */
  patience: 4,
  /** How hard vehicles brake for a red light, in metres per second squared. */
  signalBraking: 3,

  /** How bouncy a hit is. 0 is a dead thud, and 1 is a perfect bounce. */
  bounciness: 0.25,
  /** A knock of less than this doesn't launch anything, in metres per second. */
  launchKnock: 1,
  /** How far a hit throws things upward and spins them, for each m/s of knock. */
  throwUp: 0.45,
  throwSpin: 0.9,
  /** Anything heavier than this, in kilograms, is thrown less. */
  easyTipMass: 200,
  /** The most upward speed a hit can give, in metres per second. */
  maxThrowUp: 4.5,
  /** How long a bike rider takes to get up, in seconds. */
  bikeDownTime: 3.5,
  /** The longest anything stays a real body before rejoining traffic, in seconds. */
  maxCrashTime: 8,
  /** A wreck is only cleared away when the rider is at least this far off, in metres. */
  clearDistance: 30,
  /** How long a vehicle takes to get going again after a hit, in seconds. */
  recoveryTime: 2,

  /** How quickly the drawn position catches up with the path, which rounds off corners. */
  positionResponse: 8,
  turnResponse: 6,

  /** Pedestrians step aside when the rider comes this close, by this much. */
  dodgeRange: 4,
  dodgeDistance: 1.8,
  dodgeResponse: 7,
  /** Faster than this, in metres per second, the rider is on them before they can step aside. */
  dodgeMaxRiderSpeed: 5,
  /** Walking back to their path after stepping aside or getting up, in metres per second. */
  returnSpeed: 1.4,
  /** A knock gentler than this just nudges a pedestrian, rather than throwing them. */
  pedestrianKnock: 3,
  /** How long someone stays down after being hit, before getting up, in seconds. */
  pedestrianDownTime: 3,
}

type Mover = {
  lane: number
  /** Metres along the lane. */
  along: number
  speed: number
  /** What gets drawn. */
  x: number
  z: number
  heading: number
  lift: number
  /** A 0 to 1 value used to pick a colour. */
  tint: number
}

export type VehicleKind = 'sedan' | 'hatchback' | 'suv' | 'mpv' | 'auto' | 'bike'

/** The mix of traffic, repeated: Bengaluru has a lot of two-wheelers. */
const VEHICLE_MIX: VehicleKind[] = [
  'sedan',
  'bike',
  'auto',
  'hatchback',
  'bike',
  'bike',
  'suv',
  'bike',
  'auto',
  'mpv',
  'bike',
  'hatchback',
]

/** `mass` is in kilograms. A collision shares speed out according to these weights. */
const VEHICLE_SHAPES: Record<
  VehicleKind,
  { speed: number; halfLength: number; radius: number; crash: CrashShape }
> = {
  sedan: {
    speed: 8,
    halfLength: 2.1,
    radius: 0.85,
    crash: { halfSize: [0.85, 0.56, 2.05], centre: 0.78, mass: 1200 },
  },
  hatchback: {
    speed: 8,
    halfLength: 1.8,
    radius: 0.85,
    crash: { halfSize: [0.82, 0.6, 1.76], centre: 0.82, mass: 950 },
  },
  suv: {
    speed: 8,
    halfLength: 2.3,
    radius: 0.92,
    crash: { halfSize: [0.92, 0.72, 2.25], centre: 0.92, mass: 1800 },
  },
  mpv: {
    speed: 8,
    halfLength: 2,
    radius: 0.88,
    crash: { halfSize: [0.86, 0.66, 1.96], centre: 0.86, mass: 1250 },
  },
  auto: {
    speed: 6,
    halfLength: 1.3,
    radius: 0.75,
    crash: { halfSize: [0.66, 0.78, 1.22], centre: 0.9, mass: 400 },
  },
  bike: {
    speed: 9,
    halfLength: 0.95,
    radius: 0.4,
    crash: { halfSize: [0.22, 0.62, 0.9], centre: 0.72, mass: 200 },
  },
}

const PARKED_SCOOTER_SHAPE: CrashShape = { halfSize: [0.2, 0.5, 0.74], centre: 0.53, mass: 110 }
/** A standing person, as a box from the feet up, about 1.7 m tall. */
const PERSON_SHAPE: CrashShape = { halfSize: [0.24, 0.84, 0.14], centre: 0.85, mass: 70 }
/** How close the rider's middle gets to a person's middle before they touch. */
const PERSON_HIT_DISTANCE = SCOOTER.collisionRadius + 0.3
/**
 * The rider's shape for pushing things, which doesn't react to being pushed back.
 * It's kept small on purpose. A hit has to be noticed by `hitLoose` or `hitRider`
 * first, or this would bulldoze things along the ground without ever launching them.
 */
const RIDER_SHAPE: CrashShape = { halfSize: [0.2, 0.5, 0.25], centre: 0.65, mass: SCOOTER.mass }
/** How close the rider's middle gets to a parked scooter's middle before they hit. */
const LOOSE_HIT_DISTANCE = 1.35
/** Parked scooters become real bodies inside this distance of the rider, in metres. */
const LOOSE_BODY_DISTANCE = 40
/** Traffic further from the rider than this doesn't need a shape in the physics world. */
const PUSHER_DISTANCE = 70
export const LOOSE_DRAW_DISTANCE = 170

export type Vehicle = Mover & {
  kind: VehicleKind
  /** Half the vehicle's width, used for the radius of its collision shape. */
  radius: number
  crash: CrashShape
  /** Rapier's body for it while it's being thrown around, or null while it's driving. */
  body: Tumbler['body']
  rotation: Quaternion | null
  /** Its shape in the physics world while it's driving normally. */
  pusher: Tumbler['body']
  /** Seconds since it was hit. */
  crashTime: number
  /** From 0 just after a hit, up to 1 when it has fully gone back to normal driving. */
  recovery: number
  cruiseSpeed: number
  halfLength: number
  waiting: number
  /** Two-wheelers and autos weave through gaps. Cars keep to their lane. */
  nimble: boolean
  /** Ignores red lights. */
  rebel: boolean
  /** How far it has moved sideways from its lane, and where it's heading. Negative is right. */
  shift: number
  shiftTarget: number
  /** Seconds stuck behind the rider, and until it can honk again. */
  blockedTime: number
  honkWait: number
}

/** A horn sounding somewhere, waiting to be played by the sound code. */
export type Honk = { x: number; z: number; kind: VehicleKind }

export type Pedestrian = Mover & {
  /** Rapier's body for them while they've been knocked over, or null while walking. */
  body: Tumbler['body']
  rotation: Quaternion | null
  /** Seconds since they were knocked over. */
  downTime: number
  dodgeX: number
  dodgeZ: number
  /** How far through the walking cycle they are, in radians. */
  stride: number
  /** How dark their skin is, as a number the colour is multiplied by. */
  skin: number
}

/** Something standing loose on the ground, which anything can knock about. */
export type LooseBody = Tumbler & { tint: number }

export type TrafficWorld = {
  physics: CrashPhysics
  riderPusher: NonNullable<Tumbler['body']>
  loose: LooseBody[]
  roadLanes: Lane[]
  walkLanes: Lane[]
  vehicles: Vehicle[]
  pedestrians: Pedestrian[]
  signals: TrafficSignals
  /** Seconds of game time, which every traffic light runs from. */
  signalClock: number
  random: () => number
  /** Horns that sounded this step. `Traffic` plays them and empties this. */
  honks: Honk[]
}

function angleBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function placeOnLane(mover: Mover, lanes: Lane[], laneIndex: number, random: () => number) {
  const lane = lanes[laneIndex]
  const along = random() * lane.length
  mover.lane = laneIndex
  mover.along = along
  mover.x = lane.startX + lane.forwardX * along
  mover.z = lane.startZ + lane.forwardZ * along
  mover.heading = Math.atan2(lane.forwardX, lane.forwardZ)
}

/** Picks a random lane whose start lies inside a ring around (x, z). */
function findLaneInRing(
  lanes: Lane[],
  x: number,
  z: number,
  min: number,
  max: number,
  random: () => number,
  isFree: (lane: Lane) => boolean = () => true,
): number {
  for (let attempt = 0; attempt < 60; attempt++) {
    const index = Math.floor(random() * lanes.length)
    const distance = Math.hypot(lanes[index].startX - x, lanes[index].startZ - z)
    if (distance >= min && distance <= max && isFree(lanes[index])) return index
  }
  return -1
}

export function createTrafficWorld(
  graph: RoadGraph,
  collisions: CollisionWorld,
  parked: Prop[],
  physics: CrashPhysics,
  random: () => number = Math.random,
): TrafficWorld {
  const roadLanes = createLanes(graph, collisions, {
    minRoadWidth: 5,
    sideOffset: () => 1.4,
    clearance: 1.1,
  })
  const signals = createTrafficSignals(graph)
  for (const lane of roadLanes) {
    const signal = signals.byNode.get(lane.endNode)
    const group = signal?.groupFrom.get(lane.startNode)
    if (signal && group !== undefined) {
      lane.signal = { junction: signal.junction, group, stopBack: signal.stopBack }
    }
  }

  const walkLanes = createLanes(graph, collisions, {
    minRoadWidth: 4,
    sideOffset: (roadWidth) => roadWidth / 2 + 0.7, // On the pavement, inside the lamp posts.
    clearance: 0.4,
  })

  const vehicles: Vehicle[] = Array.from({ length: TRAFFIC_RULES.maxVehicles }, (_, index) => {
    const kind = VEHICLE_MIX[index % VEHICLE_MIX.length]
    const { speed, halfLength, radius, crash } = VEHICLE_SHAPES[kind]
    const nimble = kind === 'bike' || kind === 'auto'
    const rebelShare = kind === 'bike' ? TRAFFIC_RULES.bikeRebels : kind === 'auto' ? TRAFFIC_RULES.autoRebels : 0
    return {
      kind,
      radius,
      crash,
      body: null,
      rotation: null,
      pusher: physics.createPusher(crash),
      crashTime: 0,
      recovery: 1,
      lane: -1,
      along: 0,
      speed: 0,
      x: 0,
      z: 0,
      heading: 0,
      lift: 0,
      tint: random(),
      cruiseSpeed: speed * (0.85 + random() * 0.3),
      halfLength,
      waiting: 0,
      nimble,
      rebel: random() < rebelShare,
      shift: 0,
      shiftTarget: 0,
      blockedTime: 0,
      honkWait: random() * 3,
    }
  })

  const pedestrians: Pedestrian[] = Array.from({ length: TRAFFIC_RULES.maxPedestrians }, () => ({
    lane: -1,
    along: 0,
    speed: TRAFFIC_RULES.walkSpeed * (0.8 + random() * 0.4),
    x: 0,
    z: 0,
    heading: 0,
    lift: 0,
    tint: random(),
    dodgeX: 0,
    dodgeZ: 0,
    stride: random() * 6,
    skin: 0.6 + random() * 0.55,
    body: null,
    rotation: null,
    downTime: 0,
  }))

  const loose = parked.map(
    ({ x, z, rotation, variation }): LooseBody => ({
      x,
      z,
      heading: rotation,
      lift: 0,
      tint: variation,
      rotation: null,
      body: null,
    }),
  )

  const riderPusher = physics.createPusher(RIDER_SHAPE)

  return {
    physics,
    riderPusher,
    loose,
    roadLanes,
    walkLanes,
    vehicles,
    pedestrians,
    signals,
    signalClock: 0,
    random,
    honks: [],
  }
}

/** Moves along the lanes, and picks a new lane at the end of each. False at a dead end. */
function advance(mover: Mover, lanes: Lane[], distance: number, random: () => number): boolean {
  mover.along += distance

  while (mover.along >= lanes[mover.lane].length) {
    const lane = lanes[mover.lane]
    if (lane.next.length === 0) return false
    mover.along -= lane.length
    mover.lane = lane.next[Math.floor(random() * lane.next.length)]
  }
  return true
}

/** The rider's size, for traffic deciding whether it can squeeze past. */
const RIDER_HALF_LENGTH = 1
/**
 * The space between this vehicle's front bumper and the back of whatever is in
 * its way, or Infinity. `sideways` asks "what if I moved over this far?", which
 * is how two-wheelers look for a gap. Negative is to the right.
 */
function findGapAhead(
  vehicle: Vehicle,
  lane: Lane,
  others: Vehicle[],
  rider: ScooterState,
  sideways = 0,
): { gap: number; blockedBy: 'rider' | 'queue' | 'crossing' | null } {
  let gap = Infinity
  let blockedBy: 'rider' | 'queue' | 'crossing' | null = null

  const check = (x: number, z: number, halfLength: number, radius: number, isRider: boolean) => {
    const offsetX = x - vehicle.x
    const offsetZ = z - vehicle.z
    const ahead = offsetX * lane.forwardX + offsetZ * lane.forwardZ
    // Positive is to the left, the same way round as `shift`.
    const side = offsetX * lane.forwardZ - offsetZ * lane.forwardX - sideways
    if (ahead <= 0 || ahead > TRAFFIC_RULES.lookAhead) return
    if (Math.abs(side) > vehicle.radius + radius + TRAFFIC_RULES.sideClearance) return
    const space = ahead - vehicle.halfLength - halfLength
    if (space < gap) {
      gap = space
      blockedBy = isRider ? 'rider' : 'queue'
    }
  }

  /**
   * Two vehicles crossing can't see each other in their lanes. So at a crossing
   * the one earlier in the list gives way. Nobody can end up waiting in a circle,
   * as the last one in the list never gives way to anyone.
   */
  const checkCrossing = (other: Vehicle) => {
    const offsetX = other.x - vehicle.x
    const offsetZ = other.z - vehicle.z
    const ahead = offsetX * lane.forwardX + offsetZ * lane.forwardZ
    const side = offsetX * lane.forwardZ - offsetZ * lane.forwardX
    if (ahead <= 0 || ahead > TRAFFIC_RULES.junctionRange || Math.abs(side) > ahead + 1) return

    const sameLine = Math.abs(Math.sin(other.heading) * lane.forwardX + Math.cos(other.heading) * lane.forwardZ)
    // Crossing traffic is side-on, so its width is what's in the way.
    const space = ahead - vehicle.halfLength - other.radius
    if (sameLine < 0.7 && space < gap) {
      gap = space
      blockedBy = 'crossing'
    }
  }

  check(rider.x, rider.z, RIDER_HALF_LENGTH, SCOOTER.collisionRadius, true)
  const ownPlace = others.indexOf(vehicle)
  others.forEach((other, place) => {
    if (other === vehicle || other.lane === -1) return
    check(other.x, other.z, other.halfLength, other.radius, false)
    if (place > ownPlace) checkCrossing(other)
  })
  return { gap, blockedBy }
}

/** A vehicle in the air or on its side, until it's ready to rejoin traffic. */
function stepCrashedVehicle(world: TrafficWorld, vehicle: Vehicle, rider: ScooterState, dt: number) {
  const rules = TRAFFIC_RULES
  const { physics } = world

  physics.readBack(vehicle, vehicle.crash)
  vehicle.crashTime += dt

  const settled = vehicle.body?.isSleeping() === true
  const isBike = vehicle.kind === 'bike'
  const upright = uprightness(vehicle.rotation) > 0.8
  const finished = isBike
    ? vehicle.crashTime > rules.bikeDownTime
    : (settled && upright) || vehicle.crashTime > rules.maxCrashTime
  if (!finished) return

  const farAway = Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) > rules.clearDistance
  if (!isBike && !upright && !farAway) return

  physics.removeBody(vehicle)
  vehicle.rotation = null
  vehicle.lift = 0
  vehicle.recovery = 0
  // A wreck that can't drive away is cleared, and a new vehicle appears elsewhere.
  if (!isBike && !upright) vehicle.lane = -1
}

/**
 * Two-wheelers and autos don't queue. With something close ahead, they try the
 * gap to the right (towards the middle of the road, and often into it) and the
 * gap to the left (along the kerb), and take whichever leaves the most room.
 * With the way clear again, they drift back to their lane.
 */
function squeezeThrough(vehicle: Vehicle, lane: Lane, active: Vehicle[], rider: ScooterState, dt: number) {
  const rules = TRAFFIC_RULES
  const roomAt = (shift: number) => findGapAhead(vehicle, lane, active, rider, shift - vehicle.shift).gap

  const here = roomAt(vehicle.shiftTarget)
  if (here < rules.squeezeLookAt) {
    let best = vehicle.shiftTarget
    let bestRoom = here
    for (const shift of [0, rules.squeezeRight, rules.squeezeLeft]) {
      const room = roomAt(shift)
      // A clear margin is needed to change, or it would dither between two gaps.
      if (room > bestRoom + 1.5) {
        best = shift
        bestRoom = room
      }
    }
    vehicle.shiftTarget = best
  } else if (vehicle.shiftTarget !== 0 && roomAt(0) >= rules.squeezeLookAt) {
    vehicle.shiftTarget = 0
  }

  const change = vehicle.shiftTarget - vehicle.shift
  vehicle.shift += Math.sign(change) * Math.min(Math.abs(change), rules.squeezeSpeed * dt)
}

/** Horns: long and often when the rider is in the way, now and then in a queue, and the odd one anyway. */
function maybeHonk(world: TrafficWorld, vehicle: Vehicle, rider: ScooterState, riderInWay: boolean, dt: number) {
  const rules = TRAFFIC_RULES
  vehicle.honkWait -= dt
  vehicle.blockedTime = riderInWay ? vehicle.blockedTime + dt : 0
  if (vehicle.honkWait > 0) return
  if (Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) > rules.honkHearing) return

  const random = world.random
  const stuck = vehicle.speed < 0.5
  const atRider = vehicle.blockedTime > rules.honkAtRiderAfter
  const rate = stuck ? rules.queueHonkRate : rules.movingHonkRate
  if (!atRider && random() > rate * dt) return

  world.honks.push({ x: vehicle.x, z: vehicle.z, kind: vehicle.kind })
  vehicle.honkWait = atRider ? 0.8 + random() * 1.5 : 2 + random() * 3
}

function stepVehicle(world: TrafficWorld, vehicle: Vehicle, active: Vehicle[], rider: ScooterState, dt: number) {
  const { roadLanes, random } = world
  const rules = TRAFFIC_RULES

  vehicle.recovery = Math.min(1, vehicle.recovery + dt / rules.recoveryTime)

  const lane = roadLanes[vehicle.lane]

  if (vehicle.nimble) squeezeThrough(vehicle, lane, active, rider, dt)

  const { gap, blockedBy } = findGapAhead(vehicle, lane, active, rider)
  const hasWaited = blockedBy === 'crossing' && vehicle.waiting > rules.patience
  const keep = vehicle.nimble ? rules.nimbleGap : rules.carGap
  const free = hasWaited ? vehicle.cruiseSpeed : Math.min(vehicle.cruiseSpeed, Math.max(0, gap - keep))

  // Patience never overrules a red light, unless this one doesn't stop for them at all.
  // The speed that stops it in time is sqrt(2 x braking x distance).
  const toStop = vehicle.rebel
    ? Infinity
    : findStopAhead(
        roadLanes,
        vehicle.lane,
        vehicle.along,
        vehicle.halfLength,
        vehicle.speed,
        world.signals,
        world.signalClock,
      )
  const held = Math.sqrt(2 * rules.signalBraking * toStop)
  const target = Math.min(free, held) * vehicle.recovery

  const rate = target < vehicle.speed ? rules.braking : rules.acceleration
  const change = target - vehicle.speed
  vehicle.speed += Math.sign(change) * Math.min(Math.abs(change), rate * dt)

  // Waiting at a light isn't a deadlock, or the whole queue would barge off together on green.
  const atLight = toStop !== Infinity
  vehicle.waiting = vehicle.speed < 0.3 && !atLight ? vehicle.waiting + dt : 0
  if (hasWaited) vehicle.waiting = rules.patience + 1

  maybeHonk(world, vehicle, rider, blockedBy === 'rider' && gap < 3, dt)

  if (!advance(vehicle, roadLanes, vehicle.speed * dt, random)) {
    vehicle.lane = -1
    return
  }

  const now = roadLanes[vehicle.lane]
  // `shift` moves it sideways off the lane's line: positive left, negative right.
  const pathX = now.startX + now.forwardX * vehicle.along + now.forwardZ * vehicle.shift
  const pathZ = now.startZ + now.forwardZ * vehicle.along - now.forwardX * vehicle.shift
  // After a hit it eases back to its lane, instead of snapping there.
  const follow = (1 - Math.exp(-rules.positionResponse * dt)) * vehicle.recovery
  vehicle.x += (pathX - vehicle.x) * follow
  vehicle.z += (pathZ - vehicle.z) * follow

  const wanted = Math.atan2(now.forwardX, now.forwardZ)
  vehicle.heading += angleBetween(vehicle.heading, wanted) * (1 - Math.exp(-rules.turnResponse * dt))
}

type Impact = { pushX: number; pushZ: number; changeX: number; changeZ: number; otherX: number; otherZ: number }

/**
 * Shares out a collision by weight, which is all of the rule "the lighter one
 * moves". The push along the line between them is the same on both, so the same
 * push changes a light thing's speed far more than a heavy thing's. `normal`
 * points from the second thing to the first. Null means they're already parting.
 */
function resolveHit(
  normalX: number,
  normalZ: number,
  overlap: number,
  [firstX, firstZ, firstMass]: [number, number, number],
  [secondX, secondZ, secondMass]: [number, number, number],
): Impact {
  const firstShare = secondMass / (firstMass + secondMass)
  const closing = (firstX - secondX) * normalX + (firstZ - secondZ) * normalZ
  const push = closing < 0 ? (-(1 + TRAFFIC_RULES.bounciness) * closing) / (1 / firstMass + 1 / secondMass) : 0

  return {
    pushX: normalX * overlap * firstShare,
    pushZ: normalZ * overlap * firstShare,
    changeX: (normalX * push) / firstMass,
    changeZ: (normalZ * push) / firstMass,
    otherX: (-normalX * push) / secondMass,
    otherZ: (-normalZ * push) / secondMass,
  }
}

/** Finds where a circle meets a vehicle, whose shape is a capsule: a line with a radius. */
function touchVehicle(vehicle: Vehicle, x: number, z: number, radius: number) {
  const forwardX = Math.sin(vehicle.heading)
  const forwardZ = Math.cos(vehicle.heading)
  const spine = Math.max(0, vehicle.halfLength - vehicle.radius)

  const along = (x - vehicle.x) * forwardX + (z - vehicle.z) * forwardZ
  const clamped = Math.max(-spine, Math.min(spine, along))
  const awayX = x - (vehicle.x + forwardX * clamped)
  const awayZ = z - (vehicle.z + forwardZ * clamped)
  const distance = Math.hypot(awayX, awayZ)
  const touching = vehicle.radius + radius
  if (distance >= touching || distance === 0) return null

  return { normalX: awayX / distance, normalZ: awayZ / distance, overlap: touching - distance, clamped }
}

function vehicleVelocity(vehicle: Vehicle): [number, number] {
  return [Math.sin(vehicle.heading) * vehicle.speed, Math.cos(vehicle.heading) * vehicle.speed]
}

/** What a hit does to a loose thing: more spin and height the harder it was. */
function throwFor(changeX: number, changeZ: number, baseX: number, baseZ: number, mass: number) {
  const rules = TRAFFIC_RULES
  const change = Math.hypot(changeX, changeZ)
  // A heavy thing has a low, wide base, so the same knock tips it far less.
  const tip = Math.min(1, rules.easyTipMass / mass)
  const up = Math.min(change * rules.throwUp * tip, rules.maxThrowUp)

  return {
    velocity: [baseX + changeX, up, baseZ + changeZ] as [number, number, number],
    // Tips away from the hit, as if its feet stayed behind.
    spin: [changeZ * rules.throwSpin * tip, change * 0.25, -changeX * rules.throwSpin * tip] as [
      number,
      number,
      number,
    ],
  }
}

function hitRider(world: TrafficWorld, vehicle: Vehicle, rider: ScooterState, dt: number) {
  const touch = touchVehicle(vehicle, rider.x, rider.z, SCOOTER.collisionRadius)
  if (!touch) return

  const { normalX, normalZ, overlap } = touch
  const [velocityX, velocityZ] = vehicleVelocity(vehicle)
  const hit = resolveHit(
    normalX,
    normalZ,
    overlap,
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
    [velocityX, velocityZ, vehicle.crash.mass],
  )

  applyImpact(rider, hit.changeX, hit.changeZ, hit.pushX, hit.pushZ, dt)

  if (Math.hypot(hit.otherX, hit.otherZ) < TRAFFIC_RULES.launchKnock) return

  // Hit hard enough, it stops being a car on rails and becomes a real object.
  world.physics.hidePusher(vehicle.pusher as NonNullable<Tumbler['body']>)
  world.physics.addBody(vehicle, vehicle.crash, false)
  const { velocity, spin } = throwFor(
    hit.otherX,
    hit.otherZ,
    velocityX,
    velocityZ,
    vehicle.crash.mass,
  )
  world.physics.launch(vehicle, velocity, spin)
  vehicle.speed = 0
  vehicle.crashTime = 0
}

/** The rider feels a loose thing as a real weight, and sends it on its way. */
function hitLoose(world: TrafficWorld, body: LooseBody, rider: ScooterState, dt: number) {
  const awayX = rider.x - body.x
  const awayZ = rider.z - body.z
  const distance = Math.hypot(awayX, awayZ)
  const touching = LOOSE_HIT_DISTANCE
  if (distance >= touching || distance === 0 || !body.body) return

  const velocity = body.body.linvel()
  const hit = resolveHit(
    awayX / distance,
    awayZ / distance,
    touching - distance,
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
    [velocity.x, velocity.z, PARKED_SCOOTER_SHAPE.mass],
  )
  const change = Math.hypot(hit.otherX, hit.otherZ)
  applyImpact(rider, hit.changeX, hit.changeZ, hit.pushX, hit.pushZ, dt)
  if (change < TRAFFIC_RULES.launchKnock) return

  const thrown = throwFor(hit.otherX, hit.otherZ, velocity.x, velocity.z, PARKED_SCOOTER_SHAPE.mass)
  world.physics.launch(body, thrown.velocity, thrown.spin)
}

/** Parked scooters near the rider are real bodies, resting until something touches them. */
function updateLoose(world: TrafficWorld, rider: ScooterState, dt: number) {
  const { physics } = world

  for (const body of world.loose) {
    const near = Math.hypot(body.x - rider.x, body.z - rider.z) < LOOSE_BODY_DISTANCE

    if (near && !body.body) physics.addBody(body, PARKED_SCOOTER_SHAPE, true)
    if (!near && body.body) physics.removeBody(body)

    if (body.body) {
      hitLoose(world, body, rider, dt)
      if (!body.body.isSleeping()) physics.readBack(body, PARKED_SCOOTER_SHAPE)
    }
  }
}

/** Keeps the physics world's copy of the rider and of traffic up to date. */
function updatePushers(world: TrafficWorld, vehicles: Vehicle[], rider: ScooterState) {
  const { physics, riderPusher } = world
  physics.movePusher(riderPusher, rider.x, RIDER_SHAPE.centre, rider.z, rider.heading)

  for (const vehicle of vehicles) {
    const pusher = vehicle.pusher as NonNullable<Tumbler['body']>
    const close = Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) < PUSHER_DISTANCE
    if (vehicle.lane !== -1 && !vehicle.body && close) {
      physics.movePusher(pusher, vehicle.x, vehicle.crash.centre, vehicle.z, vehicle.heading)
    } else {
      physics.hidePusher(pusher)
    }
  }
}

function stepPedestrian(world: TrafficWorld, person: Pedestrian, rider: ScooterState, dt: number) {
  const { walkLanes, random } = world
  const rules = TRAFFIC_RULES

  if (!advance(person, walkLanes, person.speed * dt, random)) {
    person.lane = -1
    return
  }

  const lane = walkLanes[person.lane]
  const pathX = lane.startX + lane.forwardX * person.along
  const pathZ = lane.startZ + lane.forwardZ * person.along

  // A slow rider is seen coming, and they step out of the way. A fast one isn't.
  const fromRiderX = pathX - rider.x
  const fromRiderZ = pathZ - rider.z
  const riderDistance = Math.hypot(fromRiderX, fromRiderZ)
  const slowRider = getTravelSpeed(rider) < rules.dodgeMaxRiderSpeed
  const dodging = slowRider && riderDistance < rules.dodgeRange && riderDistance > 0
  if (dodging) {
    const blend = 1 - Math.exp(-rules.dodgeResponse * dt)
    person.dodgeX += ((fromRiderX / riderDistance) * rules.dodgeDistance - person.dodgeX) * blend
    person.dodgeZ += ((fromRiderZ / riderDistance) * rules.dodgeDistance - person.dodgeZ) * blend
  } else {
    // Back to their path at a walk, so someone who was thrown doesn't slide back.
    const offset = Math.hypot(person.dodgeX, person.dodgeZ)
    const keep = offset > 0 ? Math.max(0, offset - rules.returnSpeed * dt) / offset : 0
    person.dodgeX *= keep
    person.dodgeZ *= keep
  }

  const follow = 1 - Math.exp(-rules.positionResponse * dt)
  person.x += (pathX + person.dodgeX - person.x) * follow
  person.z += (pathZ + person.dodgeZ - person.z) * follow

  const wanted = Math.atan2(lane.forwardX, lane.forwardZ)
  person.heading += angleBetween(person.heading, wanted) * (1 - Math.exp(-rules.turnResponse * dt))

  person.stride += person.speed * 4.5 * dt
  person.lift = Math.abs(Math.sin(person.stride)) * 0.03
}

/**
 * The rider knocks a pedestrian flying, by weight like any other hit. The faster
 * the rider, the further and higher they go. The rider loses a little speed but
 * never falls, so this goes straight to the velocity rather than `applyImpact`.
 */
function hitPedestrian(world: TrafficWorld, person: Pedestrian, rider: ScooterState) {
  const awayX = person.x - rider.x
  const awayZ = person.z - rider.z
  const distance = Math.hypot(awayX, awayZ)
  if (distance >= PERSON_HIT_DISTANCE || distance === 0) return

  // `resolveHit` works from the first thing's side, so the person goes first.
  const normalX = awayX / distance
  const normalZ = awayZ / distance
  const hit = resolveHit(
    normalX,
    normalZ,
    PERSON_HIT_DISTANCE - distance,
    [0, 0, PERSON_SHAPE.mass],
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
  )
  const knock = Math.hypot(hit.changeX, hit.changeZ)

  if (knock < TRAFFIC_RULES.pedestrianKnock) {
    // A gentle bump only moves them aside.
    person.dodgeX += hit.pushX
    person.dodgeZ += hit.pushZ
    return
  }

  rider.velocityX += hit.otherX
  rider.velocityZ += hit.otherZ
  rider.impact = Math.max(rider.impact, Math.min(knock / 20, 0.6))

  world.physics.addBody(person, PERSON_SHAPE, false)
  const { velocity, spin } = throwFor(hit.changeX, hit.changeZ, 0, 0, PERSON_SHAPE.mass)
  world.physics.launch(person, velocity, spin)
  person.downTime = 0
}

/** Someone who was knocked over lies there a while, then gets up and walks back to their path. */
function stepKnockedPedestrian(world: TrafficWorld, person: Pedestrian, dt: number) {
  const { physics, walkLanes } = world
  physics.readBack(person, PERSON_SHAPE)
  person.downTime += dt

  const settled = person.body?.isSleeping() === true
  const down = person.downTime > TRAFFIC_RULES.pedestrianDownTime
  if (!down || (!settled && person.downTime < TRAFFIC_RULES.maxCrashTime)) return

  physics.removeBody(person)
  person.rotation = null
  person.lift = 0

  // They stand up where they landed, and walk back from there.
  const lane = walkLanes[person.lane]
  person.dodgeX = person.x - (lane.startX + lane.forwardX * person.along)
  person.dodgeZ = person.z - (lane.startZ + lane.forwardZ * person.along)
}

/** Advances everything. Only the first `vehicleCount` and `pedestrianCount` are in play. */
export function stepTraffic(
  world: TrafficWorld,
  rider: ScooterState,
  vehicleCount: number,
  pedestrianCount: number,
  dt: number,
) {
  const { roadLanes, walkLanes, random } = world
  const rules = TRAFFIC_RULES
  const activeVehicles = world.vehicles.slice(0, vehicleCount)
  world.signalClock += dt

  for (const vehicle of activeVehicles) {
    const tooFar = Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) > rules.vehicleRemoveAt
    if (vehicle.lane === -1 || tooFar) {
      if (vehicle.body) world.physics.removeBody(vehicle)
      vehicle.rotation = null
      vehicle.lift = 0
      vehicle.lane = -1
      const isFree = ({ startX, startZ }: Lane) =>
        activeVehicles.every(
          (other) =>
            other.lane === -1 || Math.hypot(other.x - startX, other.z - startZ) >= rules.spawnGap,
        )
      const lane = findLaneInRing(
        roadLanes,
        rider.x,
        rider.z,
        rules.vehicleSpawnMin,
        rules.vehicleSpawnMax,
        random,
        isFree,
      )
      if (lane === -1) continue
      placeOnLane(vehicle, roadLanes, lane, random)
      vehicle.speed = vehicle.cruiseSpeed
      vehicle.waiting = 0
      vehicle.recovery = 1
      vehicle.shift = 0
      vehicle.shiftTarget = 0
    }

    if (vehicle.body) {
      stepCrashedVehicle(world, vehicle, rider, dt)
      continue
    }

    stepVehicle(world, vehicle, activeVehicles, rider, dt)
    if (vehicle.lane !== -1) hitRider(world, vehicle, rider, dt)
  }

  updateLoose(world, rider, dt)
  updatePushers(world, activeVehicles, rider)
  world.physics.step(dt)

  for (const person of world.pedestrians.slice(0, pedestrianCount)) {
    const tooFar = Math.hypot(person.x - rider.x, person.z - rider.z) > rules.pedestrianRemoveAt
    if (person.lane === -1 || tooFar) {
      if (person.body) world.physics.removeBody(person)
      person.rotation = null
      person.lift = 0
      person.lane = -1
      const lane = findLaneInRing(walkLanes, rider.x, rider.z, rules.pedestrianSpawnMin, rules.pedestrianSpawnMax, random)
      if (lane === -1) continue
      placeOnLane(person, walkLanes, lane, random)
      person.dodgeX = 0
      person.dodgeZ = 0
    }

    if (person.body) {
      stepKnockedPedestrian(world, person, dt)
      continue
    }

    stepPedestrian(world, person, rider, dt)
    hitPedestrian(world, person, rider)
  }
}

/** Hands each horn that sounded this step to `play`, then forgets them. */
export function takeHonks(world: TrafficWorld, play: (honk: Honk) => void) {
  world.honks.forEach(play)
  world.honks.length = 0
}
