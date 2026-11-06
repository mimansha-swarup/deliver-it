import { bumpScooter, type ScooterState } from '../vehicle/ScooterController'
import { SCOOTER } from '../vehicle/vehicleConfig'
import type { CollisionWorld } from '../world/collision'
import type { RoadGraph } from '../world/roadGraph'
import { createLanes, type Lane } from './lanes'

export const TRAFFIC_RULES = {
  maxVehicles: 18,
  maxPedestrians: 36,
  /** Every third vehicle is an auto rickshaw. */
  autoEvery: 3,

  /** New vehicles appear in this ring around the rider, in metres. */
  vehicleSpawnMin: 150,
  vehicleSpawnMax: 260,
  vehicleRemoveAt: 300,
  /** New pedestrians appear in this ring around the rider, in metres. */
  pedestrianSpawnMin: 70,
  pedestrianSpawnMax: 180,
  pedestrianRemoveAt: 210,

  carSpeed: 8,
  autoSpeed: 6,
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

  carHalfLength: 2.1,
  autoHalfLength: 1.3,
  /** Half the width of a vehicle, used as the radius of its collision shape. */
  bodyRadius: 0.85,

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

export type Vehicle = Mover & {
  isAuto: boolean
  cruiseSpeed: number
  halfLength: number
  waiting: number
}

export type Pedestrian = Mover & { dodgeX: number; dodgeZ: number; stride: number }

export type TrafficWorld = {
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
    const isAuto = index % TRAFFIC_RULES.autoEvery === TRAFFIC_RULES.autoEvery - 1
    return {
      isAuto,
      lane: -1,
      along: 0,
      speed: 0,
      x: 0,
      z: 0,
      heading: 0,
      lift: 0,
      tint: random(),
      cruiseSpeed: (isAuto ? TRAFFIC_RULES.autoSpeed : TRAFFIC_RULES.carSpeed) * (0.85 + random() * 0.3),
      halfLength: isAuto ? TRAFFIC_RULES.autoHalfLength : TRAFFIC_RULES.carHalfLength,
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
  }))

  return { roadLanes, walkLanes, vehicles, pedestrians, random }
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

function stepVehicle(world: TrafficWorld, vehicle: Vehicle, active: Vehicle[], rider: ScooterState, dt: number) {
  const { roadLanes, random } = world
  const rules = TRAFFIC_RULES
  const lane = roadLanes[vehicle.lane]

  const { gap, blockedByRider } = findGapAhead(vehicle, lane, active, rider)
  const hasWaited = !blockedByRider && vehicle.waiting > rules.patience
  const target = hasWaited ? vehicle.cruiseSpeed : Math.min(vehicle.cruiseSpeed, Math.max(0, gap - rules.followGap))

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
  const follow = 1 - Math.exp(-rules.positionResponse * dt)
  vehicle.x += (pathX - vehicle.x) * follow
  vehicle.z += (pathZ - vehicle.z) * follow

  const wanted = Math.atan2(now.forwardX, now.forwardZ)
  vehicle.heading += angleBetween(vehicle.heading, wanted) * (1 - Math.exp(-rules.turnResponse * dt))
}

/** Vehicles are solid. The shape is a capsule: a line down the middle, with a radius. */
function bumpRider(vehicle: Vehicle, rider: ScooterState, dt: number) {
  const forwardX = Math.sin(vehicle.heading)
  const forwardZ = Math.cos(vehicle.heading)
  const spine = vehicle.halfLength - TRAFFIC_RULES.bodyRadius

  const along = (rider.x - vehicle.x) * forwardX + (rider.z - vehicle.z) * forwardZ
  const clamped = Math.max(-spine, Math.min(spine, along))
  const awayX = rider.x - (vehicle.x + forwardX * clamped)
  const awayZ = rider.z - (vehicle.z + forwardZ * clamped)
  const distance = Math.hypot(awayX, awayZ)
  const touching = TRAFFIC_RULES.bodyRadius + SCOOTER.collisionRadius
  if (distance >= touching || distance === 0) return

  const push = (touching - distance) / distance
  bumpScooter(rider, awayX * push, awayZ * push, dt)
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

  person.stride += person.speed * 6 * dt
  person.lift = Math.abs(Math.sin(person.stride)) * 0.06
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
    }

    stepVehicle(world, vehicle, activeVehicles, rider, dt)
    if (vehicle.lane !== -1) bumpRider(vehicle, rider, dt)
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
