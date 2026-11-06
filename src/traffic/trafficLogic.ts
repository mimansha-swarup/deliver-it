import { applyImpact, type ScooterState } from '../vehicle/ScooterController'
import { SCOOTER } from '../vehicle/vehicleConfig'
import { pushOutOfBuildings, type CollisionWorld } from '../world/collision'
import type { Prop } from '../world/props'
import type { RoadGraph } from '../world/roadGraph'
import { createLanes, type Lane } from './lanes'

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

  /** How bouncy a hit is. 0 is a dead thud, and 1 is a perfect bounce. */
  bounciness: 0.25,
  /** How quickly each loses speed from a knock. Higher stops sooner. */
  vehicleScrub: 2.6,
  looseScrub: 2.2,
  /** A knock of less than this is ignored, in metres per second. */
  smallestKnock: 0.25,
  /** A knock of more than this tips over a bike or a parked scooter. */
  tipOverKnock: 1.6,
  /** How long a knocked-over bike lies there, in seconds. */
  fallenTime: 3.5,
  /** How long a vehicle takes to get going again after a hit, in seconds. */
  recoveryTime: 2,
  /** How far things tip over, and how quickly, in radians. */
  fallenTilt: 1.42,
  tiltRate: 5,

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

export type VehicleKind = 'sedan' | 'hatchback' | 'auto' | 'bike'

/** The mix of traffic, repeated: Bengaluru has a lot of two-wheelers. */
const VEHICLE_MIX: VehicleKind[] = ['sedan', 'bike', 'auto', 'hatchback', 'bike', 'bike']

/** `mass` is in kilograms. A collision shares speed out according to these weights. */
const VEHICLE_SHAPES: Record<
  VehicleKind,
  { speed: number; halfLength: number; radius: number; mass: number }
> = {
  sedan: { speed: 8, halfLength: 2.1, radius: 0.85, mass: 1200 },
  hatchback: { speed: 8, halfLength: 1.8, radius: 0.85, mass: 950 },
  auto: { speed: 6, halfLength: 1.3, radius: 0.75, mass: 400 },
  bike: { speed: 9, halfLength: 0.95, radius: 0.4, mass: 200 },
}

const PARKED_SCOOTER_MASS = 110
const PARKED_SCOOTER_RADIUS = 0.4
/** Parked scooters further from the rider than this aren't drawn, in metres. */
export const LOOSE_DRAW_DISTANCE = 170

export type Vehicle = Mover & {
  kind: VehicleKind
  /** Half the vehicle's width, used for the radius of its collision shape. */
  radius: number
  mass: number
  /** Speed from being hit, on top of its own driving. It fades as the tyres scrub it off. */
  knockX: number
  knockZ: number
  /** Turning speed from being hit, in radians per second. */
  spin: number
  /** How far it's tipped over, in radians. */
  tilt: number
  /** Seconds left lying on its side. Only bikes fall over. */
  fallenLeft: number
  tiltSide: number
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
export type LooseBody = {
  x: number
  z: number
  heading: number
  lift: number
  tint: number
  tilt: number
  velocityX: number
  velocityZ: number
  spin: number
  /** Which way it fell, or 0 if it's still standing. */
  fallenSide: number
}

export type TrafficWorld = {
  collisions: CollisionWorld
  loose: LooseBody[]
  roadLanes: Lane[]
  walkLanes: Lane[]
  vehicles: Vehicle[]
  pedestrians: Pedestrian[]
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
  parked: Prop[] = [],
  random: () => number = Math.random,
): TrafficWorld {
  const roadLanes = createLanes(graph, collisions, {
    minRoadWidth: 5,
    sideOffset: () => 1.4,
    clearance: 1.1,
  })
  const walkLanes = createLanes(graph, collisions, {
    minRoadWidth: 4,
    sideOffset: (roadWidth) => roadWidth / 2 + 0.7, // On the pavement, inside the lamp posts.
    clearance: 0.4,
  })

  const vehicles: Vehicle[] = Array.from({ length: TRAFFIC_RULES.maxVehicles }, (_, index) => {
    const kind = VEHICLE_MIX[index % VEHICLE_MIX.length]
    const { speed, halfLength, radius, mass } = VEHICLE_SHAPES[kind]
    return {
      kind,
      radius,
      mass,
      knockX: 0,
      knockZ: 0,
      spin: 0,
      tilt: 0,
      fallenLeft: 0,
      tiltSide: 1,
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
      tilt: 0,
      velocityX: 0,
      velocityZ: 0,
      spin: 0,
      fallenSide: 0,
    }),
  )

  return { collisions, loose, roadLanes, walkLanes, vehicles, pedestrians, random }
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

/** A vehicle sliding from a hit or lying on its side. True while it can't drive. */
function stepKnockedVehicle(world: TrafficWorld, vehicle: Vehicle, dt: number): boolean {
  const rules = TRAFFIC_RULES

  vehicle.fallenLeft = Math.max(0, vehicle.fallenLeft - dt)
  const targetTilt = vehicle.fallenLeft > 0 ? vehicle.tiltSide * rules.fallenTilt : 0
  vehicle.tilt += (targetTilt - vehicle.tilt) * (1 - Math.exp(-rules.tiltRate * dt))

  const knocked = Math.hypot(vehicle.knockX, vehicle.knockZ) > rules.smallestKnock
  if (!knocked && vehicle.fallenLeft === 0) {
    vehicle.knockX = 0
    vehicle.knockZ = 0
    vehicle.spin = 0
    return false
  }

  vehicle.x += vehicle.knockX * dt
  vehicle.z += vehicle.knockZ * dt
  vehicle.heading += vehicle.spin * dt

  const scrub = Math.exp(-rules.vehicleScrub * dt)
  vehicle.knockX *= scrub
  vehicle.knockZ *= scrub
  vehicle.spin *= scrub

  pushOutOfBuildings(world.collisions, vehicle, vehicle.radius)
  vehicle.speed = 0
  vehicle.recovery = 0
  return true
}

function stepVehicle(world: TrafficWorld, vehicle: Vehicle, active: Vehicle[], rider: ScooterState, dt: number) {
  const { roadLanes, random } = world
  const rules = TRAFFIC_RULES

  if (stepKnockedVehicle(world, vehicle, dt)) return
  vehicle.recovery = Math.min(1, vehicle.recovery + dt / rules.recoveryTime)

  const lane = roadLanes[vehicle.lane]

  const { gap, blockedByRider } = findGapAhead(vehicle, lane, active, rider)
  const hasWaited = !blockedByRider && vehicle.waiting > rules.patience
  const free = hasWaited ? vehicle.cruiseSpeed : Math.min(vehicle.cruiseSpeed, Math.max(0, gap - rules.followGap))
  const target = free * vehicle.recovery

  const rate = target < vehicle.speed ? rules.braking : rules.acceleration
  const change = target - vehicle.speed
  vehicle.speed += Math.sign(change) * Math.min(Math.abs(change), rate * dt)

  vehicle.waiting = vehicle.speed < 0.3 ? vehicle.waiting + dt : 0
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
  return [
    Math.sin(vehicle.heading) * vehicle.speed + vehicle.knockX,
    Math.cos(vehicle.heading) * vehicle.speed + vehicle.knockZ,
  ]
}

/** Gives a vehicle the far end of a hit: a shove, a twist, and for a bike, a fall. */
function knockVehicle(vehicle: Vehicle, hit: Impact, overlap: number, contact: number, overlapShare: number) {
  const rules = TRAFFIC_RULES
  const change = Math.hypot(hit.otherX, hit.otherZ)
  const away = Math.hypot(hit.pushX, hit.pushZ) || 1

  vehicle.x -= (hit.pushX / away) * overlap * overlapShare
  vehicle.z -= (hit.pushZ / away) * overlap * overlapShare
  if (change < rules.smallestKnock) return

  const [velocityX, velocityZ] = vehicleVelocity(vehicle)
  vehicle.knockX = velocityX + hit.otherX
  vehicle.knockZ = velocityZ + hit.otherZ
  vehicle.speed = 0

  // A hit towards either end turns it, as it would a real car.
  const sideways = hit.otherX * Math.cos(vehicle.heading) - hit.otherZ * Math.sin(vehicle.heading)
  vehicle.spin += (sideways * contact) / (vehicle.halfLength + 0.5)

  if (vehicle.kind === 'bike' && change > rules.tipOverKnock) {
    vehicle.fallenLeft = rules.fallenTime
    vehicle.tiltSide = sideways >= 0 ? 1 : -1
  }
}

function hitRider(vehicle: Vehicle, rider: ScooterState) {
  const touch = touchVehicle(vehicle, rider.x, rider.z, SCOOTER.collisionRadius)
  if (!touch) return

  const { normalX, normalZ, overlap, clamped } = touch
  const [velocityX, velocityZ] = vehicleVelocity(vehicle)
  const hit = resolveHit(
    normalX,
    normalZ,
    overlap,
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
    [velocityX, velocityZ, vehicle.mass],
  )

  applyImpact(rider, hit.changeX, hit.changeZ, hit.pushX, hit.pushZ)
  knockVehicle(vehicle, hit, overlap, clamped, SCOOTER.mass / (SCOOTER.mass + vehicle.mass))
}

/** Knocks a loose body, and tips it over if the hit is hard enough. */
function knockLoose(body: LooseBody, changeX: number, changeZ: number) {
  body.velocityX += changeX
  body.velocityZ += changeZ

  const change = Math.hypot(changeX, changeZ)
  body.spin += (changeX - changeZ) * 0.6
  if (change > TRAFFIC_RULES.tipOverKnock && body.fallenSide === 0) {
    body.fallenSide = changeX >= changeZ ? 1 : -1
  }
}

function hitLoose(body: LooseBody, others: LooseBody[], vehicles: Vehicle[], rider: ScooterState) {
  const radius = PARKED_SCOOTER_RADIUS

  const riderX = rider.x - body.x
  const riderZ = rider.z - body.z
  const riderDistance = Math.hypot(riderX, riderZ)
  const touching = radius + SCOOTER.collisionRadius
  if (riderDistance < touching && riderDistance > 0) {
    const hit = resolveHit(
      riderX / riderDistance,
      riderZ / riderDistance,
      touching - riderDistance,
      [rider.velocityX, rider.velocityZ, SCOOTER.mass],
      [body.velocityX, body.velocityZ, PARKED_SCOOTER_MASS],
    )
    applyImpact(rider, hit.changeX, hit.changeZ, hit.pushX, hit.pushZ)
    knockLoose(body, hit.otherX, hit.otherZ)
  }

  for (const vehicle of vehicles) {
    if (vehicle.lane === -1) continue

    const touch = touchVehicle(vehicle, body.x, body.z, radius)
    if (!touch) continue

    const [velocityX, velocityZ] = vehicleVelocity(vehicle)
    // The first thing here is the vehicle, so the normal points the other way.
    const hit = resolveHit(
      -touch.normalX,
      -touch.normalZ,
      touch.overlap,
      [velocityX, velocityZ, vehicle.mass],
      [body.velocityX, body.velocityZ, PARKED_SCOOTER_MASS],
    )
    knockLoose(body, hit.otherX, hit.otherZ)
    body.x += touch.normalX * touch.overlap
    body.z += touch.normalZ * touch.overlap
  }

  // Only something moving can set off another, so a row can topple like dominoes.
  if (Math.hypot(body.velocityX, body.velocityZ) < TRAFFIC_RULES.smallestKnock) return
  for (const other of others) {
    if (other === body) continue

    const awayX = other.x - body.x
    const awayZ = other.z - body.z
    const distance = Math.hypot(awayX, awayZ)
    if (distance >= radius * 2 || distance === 0) continue

    const hit = resolveHit(
      -awayX / distance,
      -awayZ / distance,
      radius * 2 - distance,
      [body.velocityX, body.velocityZ, PARKED_SCOOTER_MASS],
      [other.velocityX, other.velocityZ, PARKED_SCOOTER_MASS],
    )
    knockLoose(body, hit.changeX, hit.changeZ)
    knockLoose(other, hit.otherX, hit.otherZ)
    body.x += hit.pushX
    body.z += hit.pushZ
    other.x -= hit.pushX
    other.z -= hit.pushZ
  }
}

function stepLoose(world: TrafficWorld, body: LooseBody, dt: number) {
  const rules = TRAFFIC_RULES

  body.x += body.velocityX * dt
  body.z += body.velocityZ * dt
  body.heading += body.spin * dt

  const scrub = Math.exp(-rules.looseScrub * dt)
  body.velocityX *= scrub
  body.velocityZ *= scrub
  body.spin *= scrub

  const target = body.fallenSide * rules.fallenTilt
  body.tilt += (target - body.tilt) * (1 - Math.exp(-rules.tiltRate * dt))

  const beforeX = body.x
  const beforeZ = body.z
  pushOutOfBuildings(world.collisions, body, PARKED_SCOOTER_RADIUS)
  if (body.x !== beforeX || body.z !== beforeZ) {
    body.velocityX = 0
    body.velocityZ = 0
  }
}

/** Two vehicles only collide once one has been knocked off its lane. */
function hitVehicles(active: Vehicle[]) {
  active.forEach((vehicle, place) => {
    if (vehicle.lane === -1) return

    for (const other of active.slice(place + 1)) {
      if (other.lane === -1 || (vehicle.recovery === 1 && other.recovery === 1)) continue

      const touch = touchVehicle(vehicle, other.x, other.z, other.radius)
      if (!touch) continue

      const hit = resolveHit(
        touch.normalX,
        touch.normalZ,
        touch.overlap,
        [...vehicleVelocity(other), other.mass],
        [...vehicleVelocity(vehicle), vehicle.mass],
      )
      knockVehicle(vehicle, hit, touch.overlap, touch.clamped, other.mass / (vehicle.mass + other.mass))
      other.x += hit.pushX
      other.z += hit.pushZ
      other.knockX += hit.changeX
      other.knockZ += hit.changeZ
    }
  })
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

  for (const vehicle of activeVehicles) {
    const tooFar = Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) > rules.vehicleRemoveAt
    if (vehicle.lane === -1 || tooFar) {
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
      vehicle.knockX = 0
      vehicle.knockZ = 0
      vehicle.spin = 0
      vehicle.tilt = 0
      vehicle.fallenLeft = 0
      vehicle.recovery = 1
    }

    stepVehicle(world, vehicle, activeVehicles, rider, dt)
    if (vehicle.lane !== -1) hitRider(vehicle, rider)
  }

  hitVehicles(activeVehicles)

  const nearby = world.loose.filter(
    ({ x, z }) => Math.hypot(x - rider.x, z - rider.z) < LOOSE_DRAW_DISTANCE,
  )
  for (const body of nearby) {
    hitLoose(body, nearby, activeVehicles, rider)
    stepLoose(world, body, dt)
  }

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
