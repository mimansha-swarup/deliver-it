import { ZEBRA_DEPTH, ZEBRA_GAP, type SignalPost } from '../traffic/trafficSignals'
import { addWall, isNearBuilding, type CollisionWorld } from './collision'
import type { Gate } from './houseKit'
import type { LineFeature, MapData } from './mapData'
import {
  createRandom,
  forEachRoadNear,
  indexRoadPieces,
  isClearOfRoads,
  nearestRoadEdge,
  toRoadPieces,
  type RoadIndex,
} from './props'
import { PAVEMENT_WIDTH } from './surface'
import { isInsideBounds, isInsideOutline, isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

/*
 * Fences, walls and barriers along HSR's streets (ART_DIRECTION.md), of the
 * kinds Bengaluru has:
 *
 * - `railing`: steel railings along the kerb into a signal junction, painted
 *   black and yellow like the kerbs, which keep people crossing at the zebra;
 * - parks: a low plinth with green iron railings (`parkRailing`), chain-link on
 *   concrete posts with barbed wire on top (`chainLink`, what BBMP's park and
 *   vacant-land tenders specify), or a plain tubular steel railing (`steelRailing`);
 * - mapped in OSM (`barrier=*`): boundary walls (`wall`), fences (`chainLink`, or
 *   `steelRailing` where tagged metal), stone retaining walls (`retaining`), metal
 *   crash barriers (`guardRail`) and concrete road dividers (`jersey`).
 *
 * - temple compounds walled in, painted in the red-ochre and white stripes
 *   (kaavi) that mark a temple's wall across South India (`templeWall`).
 *
 * All are solid, so the rider can't ride through them.
 */

export type FenceKind =
  | 'railing'
  | 'parkRailing'
  | 'chainLink'
  | 'steelRailing'
  | 'wall'
  | 'retaining'
  | 'guardRail'
  | 'jersey'
  | 'templeWall'

/** One straight stretch of fence. `variation` (0 to 1) picks a wall's colour. */
export type FenceRun = { from: GroundPoint; to: GroundPoint; kind: FenceKind; variation: number }

/** Fences are planned in panels about this long, in metres, and a panel is left out where it would be in the way. */
export const PANEL: Record<FenceKind, number> = {
  railing: 2,
  parkRailing: 2.5,
  chainLink: 3,
  steelRailing: 2.5,
  wall: 3,
  retaining: 3,
  guardRail: 4,
  jersey: 2,
  // One red-ochre or white stripe per panel.
  templeWall: 0.6,
}

const THICKNESS: Record<FenceKind, number> = {
  railing: 0.08,
  parkRailing: 0.26,
  chainLink: 0.14,
  steelRailing: 0.08,
  wall: 0.25,
  retaining: 0.4,
  guardRail: 0.15,
  jersey: 0.6,
  templeWall: 0.25,
}

/** The junction railing: how far it stands out from the road edge, where it starts back from the stop line, and how long it runs. */
const RAILING_FROM_EDGE = 0.35
const RAILING_START = 1.5
const RAILING_LENGTH = 16
/** A railing panel stays this close to its own road's edge, so it doesn't wander off where a road bends. */
const RAILING_EDGE_RANGE: [number, number] = [0.15, 0.8]
/** Railings keep this clear of a gate's edge, so cars and people can still get in. */
const GATE_CLEARANCE = 1

/** Park fences stand back from the road beyond the pavement. Where the mapped edge is closer, the fence moves in, up to this far. */
const PARK_ROAD_CLEARANCE = PAVEMENT_WIDTH + 0.3
const PARK_MAX_SHIFT = 6
const PATH_WIDTH = 2
/** Where a path comes through a park's edge, the fence leaves a gap this wide. */
const PARK_PATH_GAP = 3
/** Sides of a park longer than this get a gate in the middle, this wide. */
const PARK_GATE_SIDE = 40
const PARK_GATE_WIDTH = 3.5
/** How parks are fenced: their shares of the green railing, chain-link and steel railing. */
const PARK_STYLES: [FenceKind, number][] = [
  ['parkRailing', 0.5],
  ['chainLink', 0.3],
  ['steelRailing', 0.2],
]

/** What each OSM barrier becomes. */
function kindOfBarrier(barrier: LineFeature): FenceKind | null {
  const { barrier: type, fence_type: fenceType, material } = barrier.properties
  if (type === 'wall') return 'wall'
  if (type === 'retaining_wall') return 'retaining'
  if (type === 'guard_rail') return 'guardRail'
  if (type === 'jersey_barrier') return 'jersey'
  if (type === 'fence') return fenceType === 'metal' || material === 'metal' ? 'steelRailing' : 'chainLink'
  return null
}

type Panel = [GroundPoint, GroundPoint]

/** Joins panels that follow on from each other into longer runs, and adds each to the collision world. */
function joinPanels(panels: Panel[], kind: FenceKind, variation: number, collisions: CollisionWorld): FenceRun[] {
  const runs: FenceRun[] = []
  let current: FenceRun | null = null
  for (const [from, to] of panels) {
    if (current && current.to[0] === from[0] && current.to[1] === from[1]) {
      current.to = to
      continue
    }
    current = { from, to, kind, variation }
    runs.push(current)
  }
  for (const run of runs) addWall(collisions, run.from, run.to, THICKNESS[kind])
  return runs
}

/** Cuts a line into panels about `size` long, keeping those `keep` accepts. */
function cutIntoPanels(points: GroundPoint[], size: number, keep: (from: GroundPoint, to: GroundPoint, middle: GroundPoint) => boolean): Panel[] {
  const panels: Panel[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [startX, startZ] = points[i]
    const [endX, endZ] = points[i + 1]
    const length = Math.hypot(endX - startX, endZ - startZ)
    if (length < 0.3) continue
    const count = Math.max(1, Math.round(length / size))
    const at = (part: number): GroundPoint => [startX + ((endX - startX) * part) / count, startZ + ((endZ - startZ) * part) / count]
    for (let part = 0; part < count; part++) {
      const from = at(part)
      const to = at(part + 1)
      if (keep(from, to, at(part + 0.5))) panels.push([from, to])
    }
  }
  return panels
}

/** Railings along both kerbs on the way into each signal junction, starting just back from the stop line. */
export function planJunctionRailings(
  posts: SignalPost[],
  roads: RoadIndex,
  gates: Gate[],
  collisions: CollisionWorld,
  keepClear: (x: number, z: number) => boolean,
): FenceRun[] {
  const isNearGate = (x: number, z: number) =>
    gates.some((gate) => Math.hypot(gate.x - x, gate.z - z) < gate.width / 2 + GATE_CLEARANCE)
  const fits = ([x, z]: GroundPoint) => {
    const edge = nearestRoadEdge(roads, x, z, 2)
    return (
      edge > RAILING_EDGE_RANGE[0] &&
      edge < RAILING_EDGE_RANGE[1] &&
      !isNearGate(x, z) &&
      !keepClear(x, z) &&
      !isNearBuilding(collisions, x, z, 0.2)
    )
  }

  const panels: Panel[] = []
  for (const { crossX, crossZ, crossWidth, rotation } of posts) {
    // Away from the junction along the road, and across it.
    const awayX = Math.sin(rotation)
    const awayZ = Math.cos(rotation)
    const acrossX = Math.cos(rotation)
    const acrossZ = -Math.sin(rotation)
    for (const side of [-1, 1]) {
      const out = (crossWidth / 2 + RAILING_FROM_EDGE) * side
      const at = (along: number): GroundPoint => [crossX + awayX * along + acrossX * out, crossZ + awayZ * along + acrossZ * out]
      // From the far side of the zebra crossing, past the stop line, and back down the road.
      const start = ZEBRA_DEPTH / 2 + ZEBRA_GAP + RAILING_START
      for (let along = start; along + PANEL.railing <= start + RAILING_LENGTH; along += PANEL.railing) {
        const from = at(along)
        const to = at(along + PANEL.railing)
        if (fits(from) && fits(at(along + PANEL.railing / 2)) && fits(to)) panels.push([from, to])
      }
    }
  }
  return joinPanels(panels, 'railing', 0, collisions)
}

/** Whether the line from a to b crosses the line from c to d. */
function crosses(a: GroundPoint, b: GroundPoint, c: GroundPoint, d: GroundPoint): boolean {
  const side = (p: GroundPoint, q: GroundPoint, r: GroundPoint) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

/**
 * A fence round each park, on every side. Where the park's mapped edge runs
 * up to the road, the fence moves in behind the pavement. It opens where a path
 * crosses it, and has a gate halfway along long sides.
 */
export function planParkFences(data: MapData, roads: RoadIndex, collisions: CollisionWorld): FenceRun[] {
  const paths = indexRoadPieces(toRoadPieces(data.footways).map((piece) => ({ ...piece, width: PATH_WIDTH })))
  const random = createRandom(20261117)
  const runs: FenceRun[] = []

  data.parks.forEach((park) => {
    const roll = random()
    const variation = random()
    const ring = park.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) return
    let share = 0
    const kind = PARK_STYLES.find(([, part]) => (share += part) > roll)?.[0] ?? 'parkRailing'

    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    if (outline.length < 3) return

    // Moves a point on the edge inwards until it's clear of the road and its pavement.
    const settle = ([x, z]: GroundPoint, inX: number, inZ: number): GroundPoint | null => {
      let shift = 0
      for (let step = 0; step < 3; step++) {
        const need = PARK_ROAD_CLEARANCE - nearestRoadEdge(roads, x + inX * shift, z + inZ * shift, PARK_ROAD_CLEARANCE + 1)
        if (need <= 0.01) break
        shift += need
      }
      if (shift > PARK_MAX_SHIFT) return null
      return [x + inX * shift, z + inZ * shift]
    }

    const panels: Panel[] = []
    const closed = [...outline, outline[0]]
    for (let i = 0; i < closed.length - 1; i++) {
      const [startX, startZ] = closed[i]
      const [endX, endZ] = closed[i + 1]
      const length = Math.hypot(endX - startX, endZ - startZ)
      if (length < 0.5) continue
      // Inwards, whichever way round the outline runs.
      let inX = -(endZ - startZ) / length
      let inZ = (endX - startX) / length
      const middleX = (startX + endX) / 2
      const middleZ = (startZ + endZ) / 2
      if (!isInsideOutline(outline, middleX + inX * 0.5, middleZ + inZ * 0.5)) {
        inX = -inX
        inZ = -inZ
      }

      const count = Math.max(1, Math.round(length / PANEL[kind]))
      const at = (part: number): GroundPoint => [startX + ((endX - startX) * part) / count, startZ + ((endZ - startZ) * part) / count]
      const settled = Array.from({ length: count + 1 }, (_, part) => settle(at(part), inX, inZ))
      const hasGate = length > PARK_GATE_SIDE

      for (let part = 0; part < count; part++) {
        const from = settled[part]
        const to = settled[part + 1]
        if (!from || !to) continue
        const along = ((part + 0.5) / count) * length
        if (hasGate && Math.abs(along - length / 2) < PARK_GATE_WIDTH / 2 + PANEL[kind] / 2) continue
        const middle: GroundPoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
        let pathThrough = false
        forEachRoadNear(paths, middle[0], middle[1], PARK_PATH_GAP + PANEL[kind], (piece) => {
          if (pathThrough) return
          // A path crossing this panel, or ending right at it.
          if (crosses(from, to, piece.start, piece.end)) pathThrough = true
          else if (Math.hypot(piece.start[0] - middle[0], piece.start[1] - middle[1]) < PARK_PATH_GAP / 2) pathThrough = true
          else if (Math.hypot(piece.end[0] - middle[0], piece.end[1] - middle[1]) < PARK_PATH_GAP / 2) pathThrough = true
        })
        if (pathThrough) continue
        if (!isClearOfRoads(roads, middle[0], middle[1], PARK_ROAD_CLEARANCE - 0.2)) continue
        if (isNearBuilding(collisions, from[0], from[1], 0.3) || isNearBuilding(collisions, to[0], to[1], 0.3)) continue
        panels.push([from, to])
      }
    }
    runs.push(...joinPanels(panels, kind, variation, collisions))
  })
  return runs
}

/**
 * The walls, fences and barriers mapped in OSM. Boundary walls and fences keep
 * off roads and out of anything already built there, such as a compound wall
 * the house kit put up. Crash barriers and road dividers stand at the road's
 * edge or between its two halves, so they only keep off the carriageway itself.
 */
export function planMappedBarriers(barriers: LineFeature[], roads: RoadIndex, collisions: CollisionWorld): FenceRun[] {
  const random = createRandom(4471)
  const runs: FenceRun[] = []
  for (const barrier of barriers) {
    const variation = random()
    const kind = kindOfBarrier(barrier)
    if (!kind) continue
    const points = barrier.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    const onRoadEdge = kind === 'guardRail' || kind === 'jersey'
    const fits = ([x, z]: GroundPoint) =>
      !isInsideBounds(x, z, 2)
        ? false
        : onRoadEdge
        ? nearestRoadEdge(roads, x, z, 1) > -0.2
        : isClearOfRoads(roads, x, z, 0.3) && !isNearBuilding(collisions, x, z, THICKNESS[kind] / 2 + 0.05)
    const panels = cutIntoPanels(points, PANEL[kind], (from, to, middle) => fits(from) && fits(middle) && fits(to))
    runs.push(...joinPanels(panels, kind, variation, collisions))
  }
  return runs
}

/** A temple compound's wall leaves a gateway this wide, facing the nearest road. */
const TEMPLE_GATE = 3

/** The striped wall round each temple compound, open in a gateway on the side nearest the road. */
export function planTempleWalls(compounds: GroundPoint[][], roads: RoadIndex, collisions: CollisionWorld): FenceRun[] {
  const runs: FenceRun[] = []
  for (const compound of compounds) {
    const closed = [...compound, compound[0]]
    // The gateway: the point on the wall nearest a road.
    let gate = compound[0]
    let nearest = Infinity
    for (const [x, z] of cutIntoPanels(closed, 1, () => true).map(([from]) => from)) {
      const edge = nearestRoadEdge(roads, x, z, 60)
      if (edge < nearest) {
        nearest = edge
        gate = [x, z]
      }
    }
    const fits = ([x, z]: GroundPoint) =>
      isInsideBounds(x, z, 2) && isClearOfRoads(roads, x, z, 0.3) && !isNearBuilding(collisions, x, z, 0.2)
    const panels = cutIntoPanels(
      closed,
      PANEL.templeWall,
      (from, to, middle) => Math.hypot(middle[0] - gate[0], middle[1] - gate[1]) > TEMPLE_GATE / 2 && fits(from) && fits(to),
    )
    runs.push(...joinPanels(panels, 'templeWall', 0, collisions))
  }
  return runs
}
