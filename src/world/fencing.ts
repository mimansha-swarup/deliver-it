import { ZEBRA_DEPTH, ZEBRA_GAP, type SignalPost } from '../traffic/trafficSignals'
import { addWall, isNearBuilding, type CollisionWorld } from './collision'
import type { Gate } from './houseKit'
import { barrierLine, BoundaryPlanner, type BoundaryReport } from './boundaries'
import type { LineFeature, MapData } from './mapData'
import {
  createRandom,
  nearestRoadEdge,
  type RoadIndex,
} from './props'
import { isRingInPlayArea, lonLatToWorld, type GroundPoint, type LonLat } from './worldUtils'

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

/** How parks are fenced: their shares of the green railing, chain-link and steel railing. */
const PARK_STYLES: [FenceKind, number][] = [
  ['parkRailing', 0.5],
  ['chainLink', 0.3],
  ['steelRailing', 0.2],
]

/** What each OSM barrier becomes. */
export function kindOfBarrier(barrier: LineFeature): FenceKind | null {
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

/** Railings along both kerbs on the way into each signal junction, starting just back from the stop line. */
export function planJunctionRailings(
  posts: SignalPost[],
  roads: RoadIndex,
  gates: Gate[],
  collisions: CollisionWorld,
  keepClear: (x: number, z: number) => boolean,
): FenceRun[] {
  // Gates sorted into squares: there are thousands, and every railing panel asks about them.
  const GATE_CELL = 16
  const gateCells = new Map<string, Gate[]>()
  for (const gate of gates) {
    const key = `${Math.floor(gate.x / GATE_CELL)},${Math.floor(gate.z / GATE_CELL)}`
    const list = gateCells.get(key)
    if (list) list.push(gate)
    else gateCells.set(key, [gate])
  }
  const isNearGate = (x: number, z: number) => {
    const cx = Math.floor(x / GATE_CELL)
    const cz = Math.floor(z / GATE_CELL)
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        if ((gateCells.get(`${i},${j}`) ?? []).some((gate) => Math.hypot(gate.x - x, gate.z - z) < gate.width / 2 + GATE_CLEARANCE)) return true
      }
    }
    return false
  }
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

/** OSM tags of land whose grounds are walled: schools and colleges. */
const WALLED_GROUNDS = new Set(['school', 'college', 'kindergarten', 'university'])
/** A petrol bunk's wall leaves its front open: no panel this close to the road's edge, in metres. */
const BUNK_OPEN_FRONT = 5

const ring = (coordinates: LonLat[]): GroundPoint[] =>
  coordinates.slice(0, -1).map((position): GroundPoint => {
    const [x, , z] = lonLatToWorld(position)
    return [x, z]
  })

/**
 * Every boundary as a closed loop that stops at the footpath (boundaries.ts): temple compounds,
 * plots left walled where a building was taken off the road, school grounds, parks and the
 * sides and back of petrol bunks; then OSM's mapped walls and fences, joined up and kept off
 * the footpath, where no loop already runs.
 */
export function planBoundaries(
  data: MapData,
  roads: RoadIndex,
  collisions: CollisionWorld,
  { temples, plots, bunks }: { temples: GroundPoint[][]; plots: GroundPoint[][]; bunks: GroundPoint[][] },
): { runs: FenceRun[]; report: BoundaryReport } {
  const planner = new BoundaryPlanner(data.footways, roads, collisions)
  const runs: FenceRun[] = []
  for (const outline of temples) runs.push(...planner.loop({ outline, kind: 'templeWall', variation: 0 }))
  plots.forEach((outline, i) => runs.push(...planner.loop({ outline, kind: 'wall', variation: (i % 7) / 7 })))
  const random = createRandom(20261117)
  for (const area of data.areas) {
    if (!WALLED_GROUNDS.has(area.properties.amenity ?? '') || !isRingInPlayArea(area.geometry.coordinates[0])) continue
    runs.push(...planner.loop({ outline: ring(area.geometry.coordinates[0]), kind: 'wall', variation: random() }))
  }
  for (const park of data.parks) {
    const roll = random()
    const variation = random()
    if (!isRingInPlayArea(park.geometry.coordinates[0])) continue
    let share = 0
    const kind = PARK_STYLES.find(([, part]) => (share += part) > roll)?.[0] ?? 'parkRailing'
    runs.push(...planner.loop({ outline: ring(park.geometry.coordinates[0]), kind, variation }))
  }
  bunks.forEach((outline, i) => runs.push(...planner.loop({ outline, kind: 'wall', variation: (i % 5) / 5, openWithin: BUNK_OPEN_FRONT })))

  // OSM's mapped lines, by kind.
  const byKind = new Map<FenceKind, GroundPoint[][]>()
  for (const barrier of data.barriers) {
    const kind = kindOfBarrier(barrier)
    if (!kind) continue
    const lines = byKind.get(kind) ?? []
    lines.push(barrierLine(barrier))
    byKind.set(kind, lines)
  }
  const mappedRandom = createRandom(4471)
  for (const [kind, lines] of byKind) runs.push(...planner.mapped(lines, kind, mappedRandom(), kind === 'guardRail' || kind === 'jersey'))
  return { runs, report: planner.report }
}
