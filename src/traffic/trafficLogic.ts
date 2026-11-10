import type { CrashPhysics, CrashShape, Quaternion, Tumbler } from '../physics/crashPhysics'
import { uprightness } from '../physics/crashPhysics'
import { applyImpact, type ScooterState } from '../vehicle/ScooterController'
import { SCOOTER } from '../vehicle/vehicleConfig'
import type { CollisionWorld } from '../world/collision'
import type { Prop } from '../world/props'
import type { RoadGraph } from '../world/roadGraph'
import { createLanes, type Lane } from './lanes'
import { createTrafficSignals, findStopAhead, type TrafficSignals } from './trafficSignals'

export const TRAFFIC_RULES = {
  maxVehicles: 18,
  maxPedestrians: 36,

  /** New vehicles appear in this ring around the rider, in metres. */
  vehicleSpawnMin: 150,
  vehicleSpawnMax: 260,
  vehicleRemoveAt: 300,
  /** New pedestrians appear in this ring around the rider, in metres. */
  pedestrianSpawnMin: 70,
  pedestrianSpawnMax: 180,
  pedestrianRemoveAt: 210,

  walkSpeed: 1.3,
  acceleration: 3,
  /** A new vehicle won't appear this close to another one, in metres. */
  spawnGap: 15,
  braking: 9,

  /** Vehicles keep this gap to whatever is ahead of them, in metres. */
  followGap: 6.5,
  lookAhead: 20,
  /** Something this far to either side of a vehicle's path isn't in its way. */
  laneHalfWidth: 1.5,
  /** A vehicle crossing this close in front counts as being in the way, in metres. */
  junctionRange: 9,
  /** After waiting this long for another vehicle, go anyway. It clears a rare deadlock. */
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
}

export type Pedestrian = Mover & {
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

/** The distance to the nearest thing in this vehicle's way, or Infinity. */
function findGapAhead(
  vehicle: Vehicle,
  lane: Lane,
  others: Vehicle[],
  rider: ScooterState,
): { gap: number; blockedByRider: boolean } {
  let gap = Infinity
  let blockedByRider = false

  const check = (x: number, z: number, isRider: boolean) => {
    const offsetX = x - vehicle.x
    const offsetZ = z - vehicle.z
    const ahead = offsetX * lane.forwardX + offsetZ * lane.forwardZ
    const side = offsetX * lane.forwardZ - offsetZ * lane.forwardX
    if (ahead <= 0 || ahead > TRAFFIC_RULES.lookAhead) return
    if (Math.abs(side) > TRAFFIC_RULES.laneHalfWidth) return
    if (ahead < gap) {
      gap = ahead
      blockedByRider = isRider
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
    if (sameLine < 0.7 && ahead < gap) gap = ahead
  }

  check(rider.x, rider.z, true)
  const ownPlace = others.indexOf(vehicle)
  others.forEach((other, place) => {
    if (other === vehicle || other.lane === -1) return
    check(other.x, other.z, false)
    if (place > ownPlace) checkCrossing(other)
  })
  return { gap, blockedByRider }
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

function stepVehicle(world: TrafficWorld, vehicle: Vehicle, active: Vehicle[], rider: ScooterState, dt: number) {
  const { roadLanes, random } = world
  const rules = TRAFFIC_RULES

  vehicle.recovery = Math.min(1, vehicle.recovery + dt / rules.recoveryTime)

  const lane = roadLanes[vehicle.lane]

  const { gap, blockedByRider } = findGapAhead(vehicle, lane, active, rider)
  const hasWaited = !blockedByRider && vehicle.waiting > rules.patience
  const free = hasWaited ? vehicle.cruiseSpeed : Math.min(vehicle.cruiseSpeed, Math.max(0, gap - rules.followGap))

  // Patience never overrules a red light. The speed that stops it in time is sqrt(2 x braking x distance).
  const toStop = findStopAhead(
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

  if (!advance(vehicle, roadLanes, vehicle.speed * dt, random)) {
    vehicle.lane = -1
    return
  }

  const now = roadLanes[vehicle.lane]
  const pathX = now.startX + now.forwardX * vehicle.along
  const pathZ = now.startZ + now.forwardZ * vehicle.along
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

  // Nobody gets hit: when the rider comes close, they step out of the way.
  const fromRiderX = pathX - rider.x
  const fromRiderZ = pathZ - rider.z
  const riderDistance = Math.hypot(fromRiderX, fromRiderZ)
  const dodging = riderDistance < rules.dodgeRange && riderDistance > 0
  const wantedX = dodging ? (fromRiderX / riderDistance) * rules.dodgeDistance : 0
  const wantedZ = dodging ? (fromRiderZ / riderDistance) * rules.dodgeDistance : 0
  const blend = 1 - Math.exp(-rules.dodgeResponse * dt)
  person.dodgeX += (wantedX - person.dodgeX) * blend
  person.dodgeZ += (wantedZ - person.dodgeZ) * blend

  const follow = 1 - Math.exp(-rules.positionResponse * dt)
  person.x += (pathX + person.dodgeX - person.x) * follow
  person.z += (pathZ + person.dodgeZ - person.z) * follow

  const wanted = Math.atan2(lane.forwardX, lane.forwardZ)
  person.heading += angleBetween(person.heading, wanted) * (1 - Math.exp(-rules.turnResponse * dt))

  person.stride += person.speed * 4.5 * dt
  person.lift = Math.abs(Math.sin(person.stride)) * 0.03
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
      person.lane = -1
      const lane = findLaneInRing(walkLanes, rider.x, rider.z, rules.pedestrianSpawnMin, rules.pedestrianSpawnMax, random)
      if (lane === -1) continue
      placeOnLane(person, walkLanes, lane, random)
      person.dodgeX = 0
      person.dodgeZ = 0
    }

    stepPedestrian(world, person, rider, dt)
  }
}
