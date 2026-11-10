import type { RoadGraph } from '../world/roadGraph'
import type { Lane } from './lanes'

export type SignalLight = 'green' | 'yellow' | 'red'

/** A junction with lights. Roads that face each other share a group, and get green together. */
export type SignalJunction = {
  node: number
  groupCount: number
  /** Seconds added to the clock, so that all the lights don't change at once. */
  offset: number
}

/** One pole, which faces the traffic coming up one road into a junction. */
export type SignalPost = {
  x: number
  z: number
  /** Which way the lights face, in radians around Y. */
  rotation: number
  junction: number
  group: number
  /** The line across the lane where traffic waits. */
  stopX: number
  stopZ: number
  stopWidth: number
}

export type TrafficSignals = {
  junctions: SignalJunction[]
  posts: SignalPost[]
  /** For each road point with lights: the junction, and the group of each road into it. */
  byNode: Map<number, { junction: number; stopBack: number; groupFrom: Map<number, number> }>
}

const SIGNAL_TIMING = {
  green: 10,
  yellow: 2.5,
  /** Every road waits on red for this long, so a junction can clear. */
  allRed: 1.5,
}
const SLOT_LENGTH = SIGNAL_TIMING.green + SIGNAL_TIMING.yellow + SIGNAL_TIMING.allRed

/** Roads narrower than this have no traffic lanes, so they get no lights. */
const MIN_ROAD_WIDTH = 5
/** A junction needs at least two roads of this width to justify lights, in metres. */
const MAIN_ROAD_WIDTH = 7
/** Lights closer together than this would feel silly, in metres. */
const MIN_JUNCTION_GAP = 130
/** Two roads this close to a straight line count as facing each other. */
const OPPOSITE = -0.8
/** How far back from the crossing road traffic stops, in metres. */
const STOP_MARGIN = 2
const POLE_FROM_KERB = 0.4

/** How hard a vehicle will brake for a yellow light. Harder than this, and it goes on through. */
const YELLOW_BRAKING = 4
/** Vehicles stop this far before the line, in metres, so that their noses stay behind it. */
const STOP_SHORT = 0.6
/** A vehicle this far past the line has already crossed it, in metres. */
const LINE_TOLERANCE = 1.5
/** How far ahead vehicles look for a stop line, in metres. */
const SIGNAL_LOOK_AHEAD = 34

type Arm = { to: number; x: number; z: number; roadWidth: number }

function findArms(graph: RoadGraph, node: number): Arm[] {
  const arms = new Map<number, Arm>()

  for (const { to, length, roadWidth } of graph.links[node]) {
    if (roadWidth < MIN_ROAD_WIDTH || length === 0 || arms.has(to)) continue
    arms.set(to, {
      to,
      x: (graph.xs[to] - graph.xs[node]) / length,
      z: (graph.zs[to] - graph.zs[node]) / length,
      roadWidth,
    })
  }
  return [...arms.values()]
}

/** Pairs up roads that face each other. Anything left over gets a turn of its own. */
function groupArms(arms: Arm[]): number[] {
  const groups = arms.map(() => -1)
  let count = 0

  arms.forEach((arm, index) => {
    if (groups[index] !== -1) return
    groups[index] = count

    const facing = arms.findIndex(
      (other, otherIndex) =>
        groups[otherIndex] === -1 && arm.x * other.x + arm.z * other.z < OPPOSITE,
    )
    if (facing !== -1) groups[facing] = count
    count++
  })
  return groups
}

/**
 * The map marks no signals, so this picks the junctions where they'd really be:
 * three or more roads, at least two of them main roads, and spaced well apart.
 */
export function createTrafficSignals(graph: RoadGraph): TrafficSignals {
  const candidates = graph.links
    .map((_, node) => ({ node, arms: findArms(graph, node) }))
    .filter(
      ({ arms }) =>
        arms.length >= 3 && arms.filter((arm) => arm.roadWidth >= MAIN_ROAD_WIDTH).length >= 2,
    )
    .sort((a, b) => getTotalWidth(b.arms) - getTotalWidth(a.arms))

  const signals: TrafficSignals = { junctions: [], posts: [], byNode: new Map() }
  const chosen: number[] = []

  for (const { node, arms } of candidates) {
    const isClear = chosen.every(
      (other) =>
        Math.hypot(graph.xs[node] - graph.xs[other], graph.zs[node] - graph.zs[other]) >=
        MIN_JUNCTION_GAP,
    )
    if (!isClear) continue
    chosen.push(node)

    const groups = groupArms(arms)
    const widest = Math.max(...arms.map((arm) => arm.roadWidth))
    const stopBack = widest / 2 + STOP_MARGIN
    const junction = signals.junctions.length
    const groupCount = Math.max(...groups) + 1

    signals.junctions.push({
      node,
      groupCount,
      offset: (junction * 7.3) % (groupCount * SLOT_LENGTH),
    })
    signals.byNode.set(node, {
      junction,
      stopBack,
      groupFrom: new Map(arms.map((arm, index) => [arm.to, groups[index]])),
    })

    arms.forEach((arm, index) => {
      // Traffic comes in along -arm. Its left, where the kerb is here, is (forwardZ, -forwardX).
      const leftX = -arm.z
      const leftZ = arm.x
      const baseX = graph.xs[node] + arm.x * stopBack
      const baseZ = graph.zs[node] + arm.z * stopBack
      const kerb = arm.roadWidth / 2 + POLE_FROM_KERB

      signals.posts.push({
        x: baseX + leftX * kerb,
        z: baseZ + leftZ * kerb,
        rotation: Math.atan2(arm.x, arm.z),
        junction,
        group: groups[index],
        stopX: baseX + leftX * (arm.roadWidth / 4),
        stopZ: baseZ + leftZ * (arm.roadWidth / 4),
        stopWidth: arm.roadWidth / 2,
      })
    })
  }

  return signals
}

function getTotalWidth(arms: Arm[]): number {
  return arms.reduce((total, arm) => total + arm.roadWidth, 0)
}

/** Works out what a road's light is showing right now. */
export function getLight(
  { groupCount, offset }: SignalJunction,
  group: number,
  clock: number,
): SignalLight {
  const time = (clock + offset) % (groupCount * SLOT_LENGTH)
  const slot = Math.floor(time / SLOT_LENGTH)
  if (slot !== group) return 'red'

  const intoSlot = time - slot * SLOT_LENGTH
  if (intoSlot < SIGNAL_TIMING.green) return 'green'
  return intoSlot < SIGNAL_TIMING.green + SIGNAL_TIMING.yellow ? 'yellow' : 'red'
}

/** Finds the nearest light that holds a vehicle, searching every way the road could go. */
function searchForStop(
  lanes: Lane[],
  laneIndex: number,
  distance: number,
  front: number,
  speed: number,
  signals: TrafficSignals,
  clock: number,
): number {
  const lane = lanes[laneIndex]
  if (distance - front >= SIGNAL_LOOK_AHEAD) return Infinity

  const signal = lane.signal
  if (signal) {
    const toLine = distance - signal.stopBack - front - STOP_SHORT
    if (toLine < -LINE_TOLERANCE) return Infinity

    const light = getLight(signals.junctions[signal.junction], signal.group, clock)
    if (light === 'green') return Infinity

    // Too close to stop comfortably on yellow means carrying on through.
    const stoppingDistance = (speed * speed) / (2 * YELLOW_BRAKING)
    if (light === 'yellow' && toLine < stoppingDistance) return Infinity
    return Math.max(0, toLine)
  }

  // A vehicle picks its turning at the last moment, so any road it might take counts.
  let nearest = Infinity
  for (const next of lane.next) {
    const further = distance + lanes[next].length
    nearest = Math.min(nearest, searchForStop(lanes, next, further, front, speed, signals, clock))
  }
  return nearest
}

/**
 * How far a vehicle can still travel before it must stop for a light, or
 * Infinity if nothing's stopping it. `along`, `front` and `speed` are its place
 * on its lane, the distance to its nose, and how fast it's going.
 */
export function findStopAhead(
  lanes: Lane[],
  laneIndex: number,
  along: number,
  front: number,
  speed: number,
  signals: TrafficSignals,
  clock: number,
): number {
  const distance = lanes[laneIndex].length - along
  return searchForStop(lanes, laneIndex, distance, front, speed, signals, clock)
}
