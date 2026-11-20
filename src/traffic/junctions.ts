import type { Lane } from './lanes'
import { getLight, type TrafficSignals } from './trafficSignals'
import type { Vehicle } from './trafficLogic'

/*
 * Thinking before a junction. Lanes cross at a junction with nothing between them, so traffic used
 * to drive in from every side at once, meet in the middle, and stand there locked in a ring for
 * good. Now each road into a junction has a line across it, and the vehicle at the front of each
 * road decides at its line, every step, whether to go:
 *
 *   - not while the road it's heading for is full just past the junction (it would stop in the middle);
 *   - not while a vehicle already in the junction has a path that crosses or joins its own;
 *   - not across a vehicle coming up another road that has the right of way and would get there
 *     before it's clear, or that can no longer stop.
 *
 * The right of way goes to the bigger road, then to going straight over turning left over turning
 * right (which crosses the oncoming lane, as traffic keeps left), then to buses. Waiting raises it, a
 * little every second, and shrinks the gap a driver will take, so a side road edges out in the end:
 * nobody waits for ever. One that decides to go claims its path, and nobody crossing it goes until
 * it's through, so two can't set off into each other in the same moment.
 *
 * It only ever holds a vehicle outside the junction, at its line. Inside, vehicles just carry on.
 *
 * Where a divided road crosses another, the map has two crossings a few metres apart, with a lane
 * between them too short to stand in. Crossings joined by such short lanes are one junction here:
 * its lines are on the roads into the whole of it, and a way through runs over the lanes inside.
 */

export const JUNCTION_RULES = {
  /**
   * A road's line is where a nose on it is this far from every other lane of the junction, in
   * metres (a car's half width, twice, and a little), and then this much further back.
   */
  lineClear: 2.2,
  lineMargin: 0.6,
  /** Only this much of each lane into or out of a junction counts as part of it, in metres. */
  nearJunction: 14,
  /** Noses stop this far short of the line, and one this far past it is in the junction, in metres. */
  stopShort: 0.5,
  pastLine: 0.3,
  /** Two paths nearer than the two vehicles' half widths plus this, in metres, are in each other's way. */
  pathSlack: 0.4,
  /** The gap a driver wants in traffic with the right of way, in seconds; the least they'll take; and how much shorter it gets per second waited. */
  gap: 4,
  leastGap: 1.2,
  impatience: 0.3,
  /** A bus needs this much longer to get across, in seconds. */
  busGap: 1.5,
  /** How hard vehicles brake to stop at the line, comfortably and at the most, in m/s². */
  braking: 3,
  hardBraking: 7,
  /** Coming up to a junction from the smaller road, or to turn, a vehicle is down to this speed at the line, in m/s; straight over between equal streets, this. */
  cautionSpeed: 3.5,
  equalSpeed: 6,
  /** Room wanted past the junction beyond the vehicle's own length, in metres, and traffic there slower than this, in m/s, is a queue. */
  exitRoom: 1,
  queueSpeed: 1.5,
  /** Crossings joined by a lane shorter than this, in metres, are one junction. */
  joined: 16,
  /** Lanes turning less than this, in radians, go straight on; more than the second, they turn back. */
  straight: 0.5,
  turnBack: 2.6,
}

/** A way through a junction, over a run of lanes: the line it's drawn as, and which way it turns. */
type Movement = {
  id: number
  /** The lanes: the one in, any inside the junction, and the one out (if it's known that far ahead). */
  route: number[]
  /** From the line, through each corner, to clear of the junction: x, z pairs. */
  path: number[]
  /** 0 straight on, 1 left, 2 right, 3 back the way it came. */
  turn: 0 | 1 | 2 | 3
  /** The lane it leaves the junction by, or -1 if the route isn't known that far. */
  exit: number
  /** From the line to clear of the junction, in metres. */
  length: number
}

export type Junctions = {
  /** For each lane that runs into a junction: how far before its end its line is, in metres. 0 for the rest. */
  lineBack: Float32Array
  /** For each lane that runs out of a junction: how far along it a vehicle's tail is clear of the junction. 0 for the rest. */
  clearAt: Float32Array
  /** For each lane into a junction: 2 on the smaller road, 1 between equal streets, 0 on the bigger road or at lights. */
  care: Uint8Array
  /** For each lane into a junction or inside one: which junction. -1 for the rest. */
  junctionOf: Int32Array
  /** Whether each lane is inside a junction, between two of its crossings. */
  inside: Uint8Array
  movements: Map<string, Movement>
  /** How near two movements' paths come, in metres, by the pair. */
  apart: Map<number, number>
  /** Counts, for checking it (the headless run). */
  stats: { held: number; entered: number; forced: number }
}

/** A vehicle crossing a junction: which, its way through, how far it has gone since its line, and how far until it's clear. */
export type Crossing = { junction: number; movement: Movement; gone: number; span: number }

/** Finds the junctions among the lanes (three roads or more meeting), and where each road's line is. */
export function createJunctions(lanes: Lane[]): Junctions {
  const lineBack = new Float32Array(lanes.length)
  const clearAt = new Float32Array(lanes.length)
  const care = new Uint8Array(lanes.length)
  const junctionOf = new Int32Array(lanes.length).fill(-1)
  const inside = new Uint8Array(lanes.length)

  // Crossings: road points where three roads or more meet. The flyovers' lanes have no road points: nothing crosses up there.
  const roadsAt = new Map<number, Set<number>>()
  const meet = (node: number, other: number) => {
    const roads = roadsAt.get(node)
    if (roads) roads.add(other)
    else roadsAt.set(node, new Set([other]))
  }
  for (const lane of lanes) {
    if (lane.startNode < 0 || lane.endNode < 0) continue
    meet(lane.endNode, lane.startNode)
    meet(lane.startNode, lane.endNode)
  }
  const isCrossing = (node: number) => (roadsAt.get(node)?.size ?? 0) >= 3

  // Crossings joined by a short lane are one junction.
  const group = new Map<number, number>()
  const find = (node: number): number => {
    let root = node
    while (group.get(root) !== undefined && group.get(root) !== root) root = group.get(root) as number
    group.set(node, root)
    return root
  }
  for (const node of roadsAt.keys()) if (isCrossing(node)) group.set(node, node)
  for (const lane of lanes) {
    if (lane.length >= JUNCTION_RULES.joined || !group.has(lane.startNode) || !group.has(lane.endNode)) continue
    group.set(find(lane.startNode), find(lane.endNode))
  }

  type Junction = { arriving: number[]; leaving: number[] }
  const junctions = new Map<number, Junction>()
  /** The lanes inside each junction. */
  const within = new Map<number, number[]>()
  const junctionAt = (node: number) => {
    const root = find(node)
    let junction = junctions.get(root)
    if (!junction) junctions.set(root, (junction = { arriving: [], leaving: [] }))
    return junction
  }
  lanes.forEach((lane, index) => {
    const from = group.has(lane.startNode) ? find(lane.startNode) : -1
    const to = group.has(lane.endNode) ? find(lane.endNode) : -1
    if (from >= 0 && from === to) {
      lane.inJunction = true
      inside[index] = 1
      junctionOf[index] = from
      const list = within.get(from)
      if (list) list.push(index)
      else within.set(from, [index])
      return
    }
    if (to >= 0) {
      junctionAt(lane.endNode).arriving.push(index)
      junctionOf[index] = to
    }
    if (from >= 0) junctionAt(lane.startNode).leaving.push(index)
  })

  for (const [root, { arriving, leaving }] of junctions) {
    if (arriving.length === 0) continue
    const busiest = Math.max(...arriving.map((lane) => lanes[lane].weight ?? 1))
    const quietest = Math.min(...arriving.map((lane) => lanes[lane].weight ?? 1))
    // Each road's line is where a vehicle's nose is clear of every other lane of the junction: back
    // along the lane from its end, a step at a time, until nothing else passes within a vehicle's
    // width. On roads that meet at a slant that's further back than on ones that cross square.
    const others = [...arriving, ...leaving, ...within.get(root) ?? []]
    const isClear = (own: number, x: number, z: number) => {
      for (const other of others) {
        if (other === own) continue
        const { startX, startZ, endX, endZ } = lanes[other]
        // Only the part of it near the junction: 14 m of a lane coming in or going out.
        const near = JUNCTION_RULES.nearJunction / Math.max(JUNCTION_RULES.nearJunction, lanes[other].length)
        const comesIn = junctionOf[other] === root && !inside[other]
        const fromX = comesIn ? endX + (startX - endX) * near : startX
        const fromZ = comesIn ? endZ + (startZ - endZ) * near : startZ
        const toX = comesIn || inside[other] ? endX : startX + (endX - startX) * near
        const toZ = comesIn || inside[other] ? endZ : startZ + (endZ - startZ) * near
        if (pieceDistance(x, z, x, z, fromX, fromZ, toX, toZ) < JUNCTION_RULES.lineClear) return false
      }
      return true
    }
    for (const lane of arriving) {
      const { forwardX, forwardZ, endX, endZ, length } = lanes[lane]
      // A short lane keeps its line on itself, with a little of it left to stop in.
      const most = Math.max(0.5, length - 1)
      let back = 0.5
      while (back < most && !isClear(lane, endX - forwardX * back, endZ - forwardZ * back)) back += 0.5
      lineBack[lane] = Math.min(most, back + JUNCTION_RULES.lineMargin)
      care[lane] = lanes[lane].signal ? 0 : busiest === quietest ? 1 : (lanes[lane].weight ?? 1) < busiest ? 2 : 0
    }
    for (const lane of leaving) {
      const { forwardX, forwardZ, startX, startZ, length } = lanes[lane]
      let past = 0.5
      while (past < length && !isClear(lane, startX + forwardX * past, startZ + forwardZ * past)) past += 0.5
      clearAt[lane] = past + JUNCTION_RULES.lineMargin
    }
  }
  return { lineBack, clearAt, care, junctionOf, inside, movements: new Map(), apart: new Map(), stats: { held: 0, entered: 0, forced: 0 } }
}

/** Which way the path turns from one lane to another: 0 straight on, 1 left, 2 right, 3 back the way it came. */
function turnBetween(from: Lane, to: Lane): 0 | 1 | 2 | 3 {
  const cross = from.forwardX * to.forwardZ - from.forwardZ * to.forwardX
  const angle = Math.atan2(Math.abs(cross), from.forwardX * to.forwardX + from.forwardZ * to.forwardZ)
  if (angle < JUNCTION_RULES.straight) return 0
  if (angle > JUNCTION_RULES.turnBack) return 3
  // Left of the way it's going is (forwardZ, -forwardX).
  return to.forwardX * from.forwardZ - to.forwardZ * from.forwardX > 0 ? 1 : 2
}

const route: number[] = []

/**
 * The lanes of a vehicle's way through the junction ahead, into `route`: the lane in (`first`
 * lanes ahead of the one it's on), then on until one that leaves the junction, or three lanes
 * further. False if it has no way on.
 */
function findRoute(junctions: Junctions, vehicle: Vehicle, first: number, laneAhead: (vehicle: Vehicle, steps: number) => number): boolean {
  route.length = 0
  for (let steps = first; steps <= first + 3; steps++) {
    const lane = steps === 0 ? vehicle.lane : laneAhead(vehicle, steps)
    if (lane < 0) break
    route.push(lane)
    if (route.length > 1 && !junctions.inside[lane]) break
  }
  return route.length >= 2
}

/**
 * The side a vehicle indicates on its way to and through a junction: 1 left, -1 right, 0 for
 * straight on, and anywhere that isn't a junction (a bend in the road).
 */
export function indicatorFor(junctions: Junctions, lanes: Lane[], vehicle: Vehicle, laneAhead: (vehicle: Vehicle, steps: number) => number, reach: number): -1 | 0 | 1 {
  const side = (movement: Movement) => (movement.turn === 1 ? 1 : movement.turn === 0 ? 0 : -1)
  if (vehicle.crossing) return side(vehicle.crossing.movement)
  let first = -1
  if (junctions.lineBack[vehicle.lane] > 0) first = 0
  else {
    let ahead = lanes[vehicle.lane].length - vehicle.along
    for (let steps = 1; steps <= 3 && first < 0 && ahead < reach; steps++) {
      const next = laneAhead(vehicle, steps)
      if (next < 0 || junctions.inside[next]) break
      if (junctions.lineBack[next] > 0) first = steps
      ahead += lanes[next].length
    }
  }
  if (first < 0 || !findRoute(junctions, vehicle, first, laneAhead)) return 0
  return side(movementOf(junctions, lanes, route))
}

function movementOf(junctions: Junctions, lanes: Lane[], through: number[]): Movement {
  const key = through.join(',')
  const known = junctions.movements.get(key)
  if (known) return known

  const first = lanes[through[0]]
  const last = lanes[through[through.length - 1]]
  const exit = junctions.inside[through[through.length - 1]] ? -1 : through[through.length - 1]
  const back = junctions.lineBack[through[0]]
  const path = [first.endX - first.forwardX * back, first.endZ - first.forwardZ * back]
  let length = back
  for (let i = 0; i + 1 < through.length; i++) {
    const a = lanes[through[i]]
    const b = lanes[through[i + 1]]
    // Round the corner where the two lanes' lines cross, as the steering does (trafficLogic.ts'
    // `findCorner`); where they hardly turn, or cross far off, straight between their ends.
    const cross = a.forwardX * b.forwardZ - a.forwardZ * b.forwardX
    let cornerX = (a.endX + b.startX) / 2
    let cornerZ = (a.endZ + b.startZ) / 2
    if (Math.abs(cross) > 0.2) {
      const onA = ((b.startX - a.startX) * b.forwardZ - (b.startZ - a.startZ) * b.forwardX) / cross
      if (Math.abs(onA - a.length) < 12) {
        cornerX = a.startX + a.forwardX * onA
        cornerZ = a.startZ + a.forwardZ * onA
      }
    }
    path.push(cornerX, cornerZ)
    if (i > 0) length += a.length
  }
  const clear = exit >= 0 ? Math.min(junctions.clearAt[exit], last.length) : last.length
  path.push(last.startX + last.forwardX * clear, last.startZ + last.forwardZ * clear)
  length += clear
  const movement: Movement = { id: junctions.movements.size, route: [...through], path, turn: turnBetween(first, last), exit, length }
  junctions.movements.set(key, movement)
  return movement
}

/** The shortest distance between two straight pieces, a to b and c to d. */
function pieceDistance(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const toPiece = (px: number, pz: number, sx: number, sz: number, ex: number, ez: number) => {
    const lengthSquared = (ex - sx) ** 2 + (ez - sz) ** 2
    const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - sx) * (ex - sx) + (pz - sz) * (ez - sz)) / lengthSquared))
    return Math.hypot(px - sx - (ex - sx) * along, pz - sz - (ez - sz) * along)
  }
  const side = (px: number, pz: number, sx: number, sz: number, ex: number, ez: number) => (ex - sx) * (pz - sz) - (ez - sz) * (px - sx)
  // Crossing pieces touch; otherwise the nearest pair of points has an end of one of them in it.
  if (side(ax, az, cx, cz, dx, dz) * side(bx, bz, cx, cz, dx, dz) < 0 && side(cx, cz, ax, az, bx, bz) * side(dx, dz, ax, az, bx, bz) < 0) return 0
  return Math.min(toPiece(ax, az, cx, cz, dx, dz), toPiece(bx, bz, cx, cz, dx, dz), toPiece(cx, cz, ax, az, bx, bz), toPiece(dx, dz, ax, az, bx, bz))
}

/** How near two paths come, each a run of x, z pairs. */
function pathDistance(a: number[], b: number[]): number {
  let nearest = Infinity
  for (let i = 0; i + 3 < a.length; i += 2) {
    for (let j = 0; j + 3 < b.length; j += 2) {
      nearest = Math.min(nearest, pieceDistance(a[i], a[i + 1], a[i + 2], a[i + 3], b[j], b[j + 1], b[j + 2], b[j + 3]))
    }
  }
  return nearest
}

function movementsApart(junctions: Junctions, a: Movement, b: Movement): number {
  const key = a.id < b.id ? a.id * 1_000_000 + b.id : b.id * 1_000_000 + a.id
  let apart = junctions.apart.get(key)
  if (apart === undefined) junctions.apart.set(key, (apart = pathDistance(a.path, b.path)))
  return apart
}

const remaining: number[] = []

/** What's left of a crossing vehicle's path: from its tail (the whole of it is in the way), round the corners it hasn't turned yet, to clear of the junction. */
function pathLeft(vehicle: Vehicle, { movement }: Crossing): number[] {
  const { path, route: through } = movement
  remaining.length = 0
  remaining.push(vehicle.x - Math.sin(vehicle.heading) * vehicle.halfLength, vehicle.z - Math.cos(vehicle.heading) * vehicle.halfLength)
  const on = through.indexOf(vehicle.lane)
  // Its nose, if it's past the lanes it came through by; else the path's points from the next corner on.
  if (on < 0) remaining.push(vehicle.x + Math.sin(vehicle.heading) * vehicle.halfLength, vehicle.z + Math.cos(vehicle.heading) * vehicle.halfLength)
  else for (let i = (on + 1) * 2; i < path.length; i++) remaining.push(path[i])
  return remaining
}

/** Whether there's room for this vehicle just past the junction on the lane it leaves by, clear of the junction itself. */
function hasExitRoom(junctions: Junctions, lanes: Lane[], vehicle: Vehicle, exit: number, vehicles: Vehicle[]): boolean {
  if (exit < 0) return true
  const rules = JUNCTION_RULES
  const needed = junctions.clearAt[exit] + vehicle.halfLength * 2 + rules.exitRoom
  const lane = lanes[exit]
  for (const other of vehicles) {
    if (other === vehicle || other.lane === -1) continue
    // Anything moving off will be gone by the time this one is over; a wreck or a vehicle left standing won't be.
    const standing = other.body !== null || other.fallen !== null || other.taken === 'empty' || !!other.halt
    if (!standing && other.speed >= rules.queueSpeed) continue
    let tail = Infinity
    if (other.lane === exit) tail = other.along - other.halfLength
    else if (other.prevLane === exit && lane.next.includes(other.lane)) tail = lane.length + other.along - other.halfLength
    if (tail < needed) return false
  }
  return true
}

type Head = {
  vehicle: Vehicle
  place: number
  junction: number
  /** The lane it comes into the junction by: the one it's on, or its next. */
  from: number
  movement: Movement
  /** From its nose to its line, in metres. */
  toLine: number
  /** Not held by a red light, not stuck behind something, and with room to leave the junction: it would go if nothing crossed it. */
  wants: boolean
  priority: number
}

const heads: Head[] = []
const headOfLane = new Map<number, Head>()
const crossers: Vehicle[] = []

/**
 * Decides, for this step, who may drive into each junction. Sets on every vehicle `atLine` (it's
 * the front of a road into a junction, and not held by a light), `junctionSpeed` (the most it may
 * do just now: 0 at its line while it's held), `claim` and `crossing`. `laneAhead` is the lane a
 * vehicle will be on so many lanes after the one it's on (1, 2 or 3).
 */
export function planJunctions(
  junctions: Junctions,
  lanes: Lane[],
  vehicles: Vehicle[],
  signals: TrafficSignals,
  clock: number,
  laneAhead: (vehicle: Vehicle, steps: number) => number,
  dt: number,
) {
  const rules = JUNCTION_RULES
  heads.length = 0
  headOfLane.clear()
  crossers.length = 0

  vehicles.forEach((vehicle, place) => {
    vehicle.junctionSpeed = Infinity
    vehicle.atLine = false
    vehicle.heldBy = null
    // Thrown about, lying on its side, stopped for a reason of its own, or standing empty or driven by the player: not making up its mind.
    const driving = vehicle.lane !== -1 && !vehicle.body && !vehicle.fallen && !vehicle.halt && (!vehicle.taken || vehicle.taken === 'hailed')
    if (!driving) {
      vehicle.crossing = null
      vehicle.claim = false
      return
    }
    if (vehicle.crossing) {
      vehicle.crossing.gone += vehicle.speed * dt
      if (vehicle.crossing.gone > vehicle.crossing.span) vehicle.crossing = null
    }
    if (vehicle.crossing) {
      crossers.push(vehicle)
      return
    }
    const lane = lanes[vehicle.lane]
    const back = junctions.lineBack[vehicle.lane]
    if (back > 0) {
      if (!findRoute(junctions, vehicle, 0, laneAhead)) return
      const toLine = lane.length - back - vehicle.along - vehicle.halfLength
      const movement = movementOf(junctions, lanes, route)
      if (toLine < -rules.pastLine) {
        // Over its line: it's in the junction, whether it was let in or not.
        if (!vehicle.claim) junctions.stats.forced++
        junctions.stats.entered++
        vehicle.crossing = { junction: junctions.junctionOf[vehicle.lane], movement, gone: -toLine, span: movement.length + vehicle.halfLength * 2 }
        vehicle.claim = false
        vehicle.heldFor = 0
        crossers.push(vehicle)
        return
      }
      // The front of its road is the one that decides. Those behind follow it (the gap rules keep them back).
      const first = headOfLane.get(vehicle.lane)
      if (!first || toLine < first.toLine) {
        headOfLane.set(vehicle.lane, { vehicle, place, junction: junctions.junctionOf[vehicle.lane], from: vehicle.lane, movement, toLine, wants: false, priority: 0 })
      }
    } else if (junctions.inside[vehicle.lane]) {
      // Found inside a junction without having come in over a line (it has just appeared, or got up after a knock): it's crossing all the same.
      if (!findRoute(junctions, vehicle, 0, laneAhead)) return
      const through = [...route]
      const movement = movementOf(junctions, lanes, through)
      vehicle.crossing = { junction: junctions.junctionOf[vehicle.lane], movement, gone: 0, span: movement.length + lane.length + vehicle.halfLength * 2 }
      crossers.push(vehicle)
    } else {
      // Roads are made of short lanes, too short to stop in from speed: a lane or two back from the
      // lane that runs into the junction, a vehicle is already coming up to its line.
      let toLine = lane.length - vehicle.along - vehicle.halfLength
      for (let steps = 1; steps <= 2; steps++) {
        const into = laneAhead(vehicle, steps)
        if (into < 0 || junctions.inside[into]) return
        if (junctions.lineBack[into] === 0) {
          toLine += lanes[into].length
          continue
        }
        if (!findRoute(junctions, vehicle, steps, laneAhead)) return
        toLine += lanes[into].length - junctions.lineBack[into]
        const first = headOfLane.get(into)
        if (!first || toLine < first.toLine) {
          headOfLane.set(into, { vehicle, place, junction: junctions.junctionOf[into], from: into, movement: movementOf(junctions, lanes, route), toLine, wants: false, priority: 0 })
        }
        return
      }
    }
  })

  for (const head of headOfLane.values()) heads.push(head)
  // In the vehicles' own order, so the same two always settle a tie the same way.
  heads.sort((a, b) => a.place - b.place)
  for (const vehicle of vehicles) {
    if (vehicle.crossing || heads.some((head) => head.vehicle === vehicle)) continue
    vehicle.claim = false
    vehicle.heldFor = Math.max(0, (vehicle.heldFor ?? 0) - dt)
  }

  for (const head of heads) {
    const { vehicle } = head
    const lane = lanes[head.from]
    // A red light holds it already (trafficSignals.ts); it isn't about to go, so nobody waits for it.
    const red = lane.signal !== undefined && !vehicle.rebel && getLight(signals.junctions[lane.signal.junction], lane.signal.group, clock) !== 'green'
    vehicle.atLine = !red
    // Nor is one standing behind something in its way: it claims nothing until it can move.
    head.wants = !red && !vehicle.stalled && hasExitRoom(junctions, lanes, vehicle, head.movement.exit, vehicles)
    const weight = lane.weight ?? 1
    head.priority =
      (weight >= 10 ? 4 : weight >= 2 ? 2 : 0) +
      (3 - head.movement.turn) +
      (vehicle.kind === 'bus' ? 0.5 : 0) +
      Math.min(8, (vehicle.heldFor ?? 0) * 0.25) -
      head.place * 0.001
  }

  for (const head of heads) {
    const { vehicle, movement, toLine } = head
    if (!vehicle.atLine) {
      vehicle.claim = false
      continue
    }
    let held = !head.wants
    /** The vehicle it's waiting for, if it's one in particular. */
    let holder: Vehicle | null = null

    // Anything already in the junction whose way out crosses or joins this one's way through.
    if (!held) {
      for (const other of crossers) {
        const crossing = other.crossing
        if (!crossing || crossing.junction !== head.junction || crossing.movement.route[0] === head.from) continue
        if (pathDistance(movement.path, pathLeft(other, crossing)) < vehicle.radius + other.radius + rules.pathSlack) {
          held = true
          holder = other
          break
        }
      }
    }

    // Anything coming up another road whose way through crosses this one's.
    if (!held) {
      const wait = vehicle.heldFor ?? 0
      const gap = Math.max(rules.leastGap, rules.gap - rules.impatience * wait) + (vehicle.kind === 'bus' ? rules.busGap : 0)
      for (const other of heads) {
        if (other === head || other.junction !== head.junction || !other.wants) continue
        if (movementsApart(junctions, movement, other.movement) >= vehicle.radius + other.vehicle.radius + rules.pathSlack) continue
        const rival = other.vehicle
        // It has said it's going: its path is its own until it's through.
        if (rival.claim) {
          held = true
          holder = rival
        }
        // One that has the go-ahead keeps it; otherwise not across one that can't stop, or that has the right of way and is nearly there.
        else if (!vehicle.claim) {
          const cannotStop = rival.speed > 2 && other.toLine < (rival.speed * rival.speed) / (2 * rules.hardBraking) - 0.3
          const arrives = Math.max(0, other.toLine) / Math.max(rival.speed, 1.5)
          if (cannotStop || (other.priority > head.priority && arrives < gap)) held = true
        }
        if (held) break
      }
    }

    vehicle.claim = !held
    vehicle.heldBy = held ? holder : null
    if (held) {
      vehicle.heldFor = (vehicle.heldFor ?? 0) + dt
      junctions.stats.held += dt
      vehicle.junctionSpeed = Math.sqrt(2 * rules.braking * Math.max(0, toLine - rules.stopShort))
    } else {
      // Free to go, but a driver still comes up to a junction ready to stop, unless they're on the bigger road.
      const care = junctions.care[head.from]
      const atLine = care === 2 || (care === 1 && movement.turn !== 0) ? rules.cautionSpeed : care === 1 ? rules.equalSpeed : Infinity
      vehicle.junctionSpeed = Math.sqrt(atLine * atLine + 2 * rules.braking * Math.max(0, toLine))
    }
  }
}
