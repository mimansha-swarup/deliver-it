import { addPost, addWall, isNearBuilding, type CollisionWorld } from './collision'
import type { Gate, StiltVehicle } from './houseKit'
import type { LineFeature } from './mapData'
import type { Lane } from '../traffic/lanes'
import { createRandom, nearestRoadPiece, PointGrid, scramble, type RoadIndex, type RoadPiece } from './props'
import { Surface, worldSurface } from './surfaceMap'
import type { RoadGraph } from './roadGraph'
import { streetPresetOf, type StreetPresetName } from './streetPresets'
import { isInsideBounds, type GroundPoint } from './worldUtils'

/*
 * Parking along the kerb, as in HSR: cars and two-wheelers parallel to the road edge, on the road,
 * narrowing it. Most parked vehicles are here; only a few bikes still stand on the footpath
 * outside shops (props.ts).
 *
 * Traffic eases out around them (`markParkedOnLanes` below, `parkedLimit` in trafficLogic.ts),
 * into the middle of the road if it must, and waits when the way is blocked by oncoming traffic,
 * so a narrow street takes one side of parking and a wider one both. Cars are made solid (walls in the collision world), after the traffic lanes are built
 * so they don't make the lanes count as blocked; bikes are solid posts, made at the same time.
 */

/** Parked widths and lengths, in metres, and the gap left between neighbours. */
const CAR = { halfWidth: 0.9, length: 4.2, gap: 1.0 }
const BIKE = { halfWidth: 0.4, spacing: 1.05 }
/** From the road edge to the parked vehicle's side, in metres. */
const KERB_GAP = 0.15
/** Narrower roads aren't parked on; narrower than this, only one side is. In metres. */
const MIN_PARKING_WIDTH = 5
const BOTH_SIDES_WIDTH = 7

/** No parking this close to a junction, a gate or the ends of a road piece, in metres. */
const JUNCTION_CLEAR = 14
const GATE_CLEAR = 3.2
const PIECE_END_CLEAR = 6

/** How a kind of street is parked: chances per slot of a car, of a few bikes, out of 1. */
const DENSITY: Record<StreetPresetName | 'plain', { car: number; bikes: number }> = {
  shop: { car: 0.14, bikes: 0.22 },
  main: { car: 0.1, bikes: 0.12 },
  // Light: residential streets were widened so a scooter can turn, and parked cars would narrow them again.
  residential: { car: 0.04, bikes: 0.04 },
  plain: { car: 0.06, bikes: 0.05 },
}
/** A slot along the kerb, in metres: a car's length and its gap. */
const SLOT = CAR.length + CAR.gap
/** Car models, as StiltParking draws them: the index is a parked car's `model`. */
export const STREET_CAR_MODELS = ['hatchback', 'sedan', 'suv'] as const

export type StreetParking = {
  cars: StiltVehicle[]
  /**
   * Two-wheelers at the kerb. They stand still, drawn with the cars and solid as posts: there are
   * thousands, and the loose scooters that can be knocked about cost a little every frame each.
   */
  bikes: StiltVehicle[]
  /** Each car's length as a wall, to make solid once the traffic lanes exist. */
  walls: [GroundPoint, GroundPoint][]
  /** Spots refused, by why: for the debug report. */
  rejected: Record<string, number>
}

/** The surface map's cells are a metre: this much of a footprint may fall in a neighbouring cell. */
const CELL_SLACK = 0.75

export function planStreetParking({
  roads,
  pieces,
  graph,
  gates,
  collisions,
  keepClear,
  roadIndex,
}: {
  roads: LineFeature[]
  pieces: RoadPiece[]
  graph: RoadGraph
  gates: Gate[]
  collisions: CollisionWorld
  /** Ground kept clear, such as a petrol bunk's forecourt. */
  keepClear: (x: number, z: number) => boolean
  roadIndex: RoadIndex
}): StreetParking {
  const random = createRandom(20261118)
  const parking: StreetParking = { cars: [], bikes: [], walls: [], rejected: {} }
  const surface = worldSurface.map
  /** Counts why a spot was refused, for the debug report, and refuses it. */
  const reject = (why: string) => {
    parking.rejected[why] = (parking.rejected[why] ?? 0) + 1
    return false
  }
  // Junctions and gates in grids, so each spot only looks at those nearby.
  const junctions = new PointGrid(JUNCTION_CLEAR)
  graph.links.forEach((links, node) => {
    if (links.length >= 3) junctions.add(graph.xs[node], graph.zs[node])
  })
  const gateGrid = new PointGrid(GATE_CLEAR * 2)
  for (const gate of gates) gateGrid.add(gate.x, gate.z)
  const isFree = (x: number, z: number, room: number) =>
    isInsideBounds(x, z, 10) &&
    !junctions.hasWithin(x, z, JUNCTION_CLEAR) &&
    !gateGrid.hasWithin(x, z, GATE_CLEAR) &&
    !keepClear(x, z) &&
    !isNearBuilding(collisions, x, z, room)

  for (const piece of pieces) {
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length < PIECE_END_CLEAR * 2 + SLOT) continue
    const half = piece.width / 2
    // Too narrow to park on at all (service lanes, tracks), and on a narrow street only one side
    // is parked, chosen per road, leaving room for traffic to ease past (trafficLogic.ts).
    if (piece.width < MIN_PARKING_WIDTH) continue
    const oneSide = piece.width < BOTH_SIDES_WIDTH ? (scramble(piece.road + 1) % 2 === 0 ? 1 : -1) : 0
    const density = DENSITY[streetPresetOf(roads[piece.road])?.name ?? 'plain']
    const alongX = (piece.end[0] - piece.start[0]) / length
    const alongZ = (piece.end[1] - piece.start[1]) / length
    // A quarter turn to the left of along is (z, -x), as lanes.ts has it: the left side, where traffic keeps.
    const leftX = alongZ
    const leftZ = -alongX
    const heading = Math.atan2(alongX, alongZ)

    for (const side of [1, -1]) {
      if (oneSide !== 0 && side !== oneSide) continue
      for (let along = PIECE_END_CLEAR + SLOT / 2; along < length - PIECE_END_CLEAR - SLOT / 2; along += SLOT) {
        const roll = random()
        const point = (distance: number, offset: number): GroundPoint => [
          piece.start[0] + alongX * distance + leftX * offset * side,
          piece.start[1] + alongZ * distance + leftZ * offset * side,
        ]
        // Facing the way traffic on that side goes, mostly; now and then the other way.
        const facing = heading + (side === 1 ? 0 : Math.PI) + (random() < 0.15 ? Math.PI : 0)

        // At the outer kerb only: the whole footprint on drawn road, and footpath (not more road
        // or a median) beyond the kerb, and this road the nearest one (no overlapping road).
        const atOuterKerb = (distance: number, offset: number, halfLength: number, halfWidth: number) => {
          if (!surface) return true
          // Corners inset by a cell, as the map is a metre to a cell and the kerb side sits on its edge.
          const inLength = Math.max(0, halfLength - CELL_SLACK)
          const inWidth = Math.max(0, halfWidth - CELL_SLACK)
          for (const [d, o] of [[0, 0], [-inLength, -inWidth], [inLength, -inWidth], [-inLength, inWidth], [inLength, inWidth]]) {
            const [px, pz] = point(distance + d, offset + o)
            if (surface.at(px, pz) !== Surface.Road) return reject('off the road')
          }
          for (const beyond of [1, 2.5, 4]) {
            const [px, pz] = point(distance, half + beyond)
            const ground = surface.at(px, pz)
            if (ground === Surface.Road || ground === Surface.Median) return reject('inner edge or median')
          }
          const [cx, cz] = point(distance, offset)
          const nearest = nearestRoadPiece(roadIndex, cx, cz, half + 2)
          if (nearest && nearest.piece.road !== piece.road && nearest.edge < -0.2) return reject('overlapping road')
          return true
        }

        if (roll < density.car) {
          const offset = half - KERB_GAP - CAR.halfWidth
          const [x, z] = point(along, offset)
          if (!isFree(x, z, CAR.halfWidth + 0.2) || !atOuterKerb(along, offset, CAR.length / 2, CAR.halfWidth)) continue
          parking.cars.push({ x, z, rotation: facing + (random() - 0.5) * 0.04, variation: random(), car: true, model: scramble(Math.round(x * 7) ^ Math.round(z * 3)) % STREET_CAR_MODELS.length })
          parking.walls.push([point(along - CAR.length / 2, offset), point(along + CAR.length / 2, offset)])
        } else if (roll < density.car + density.bikes) {
          // Two to four bikes in a row along the kerb, as outside a shop or a house.
          const count = 2 + Math.floor(random() * 3)
          const offset = half - KERB_GAP - BIKE.halfWidth
          for (let bike = 0; bike < count; bike++) {
            const [x, z] = point(along + (bike - (count - 1) / 2) * BIKE.spacing, offset)
            if (!isFree(x, z, BIKE.halfWidth + 0.15) || !atOuterKerb(along + (bike - (count - 1) / 2) * BIKE.spacing, offset, 0.9, BIKE.halfWidth)) continue
            parking.bikes.push({ x, z, rotation: facing + (random() - 0.5) * 0.25, variation: random(), car: false })
          }
        }
      }
    }
  }
  return parking
}

/** Makes parked cars and bikes solid to the rider: each car a wall as wide as itself, each bike a post. */
export function addParkedCarWalls(collisions: CollisionWorld, parking: StreetParking) {
  for (const [start, end] of parking.walls) addWall(collisions, start, end, CAR.halfWidth * 2)
  for (const { x, z } of parking.bikes) addPost(collisions, x, z, BIKE.halfWidth)
}

/** The grid cell lanes are sorted into for `markParkedOnLanes`, in metres. */
const LANE_CELL = 40

/** Kept between a passing vehicle's side and a parked one's, in metres. */
const PASSING_MARGIN = 0.2

/**
 * Tells each road lane where vehicles are parked at its kerb, so traffic eases out around them
 * (`parkedLimit` in trafficLogic.ts). Something parked counts for a lane when it's beside the
 * lane on its left (kerb) side and pokes into the space a vehicle on it would use.
 */
export function markParkedOnLanes(lanes: Lane[], parked: { x: number; z: number; halfWidth: number; halfLength: number }[]) {
  // Lanes in a grid by the box round each, so a parked vehicle only looks at the lanes nearby.
  const byCell = new Map<number, number[]>()
  const cellOf = (value: number) => Math.floor(value / LANE_CELL)
  const keyOf = (cellX: number, cellZ: number) => (cellX + 5000) * 10000 + (cellZ + 5000)
  lanes.forEach((lane, index) => {
    lane.parked = undefined
    for (let cellX = cellOf(Math.min(lane.startX, lane.endX) - 6); cellX <= cellOf(Math.max(lane.startX, lane.endX) + 6); cellX++) {
      for (let cellZ = cellOf(Math.min(lane.startZ, lane.endZ) - 6); cellZ <= cellOf(Math.max(lane.startZ, lane.endZ) + 6); cellZ++) {
        const key = keyOf(cellX, cellZ)
        const cell = byCell.get(key)
        if (cell) cell.push(index)
        else byCell.set(key, [index])
      }
    }
  })
  for (const item of parked) {
    for (const index of byCell.get(keyOf(cellOf(item.x), cellOf(item.z))) ?? []) {
      const lane = lanes[index]
      const offsetX = item.x - lane.startX
      const offsetZ = item.z - lane.startZ
      const along = offsetX * lane.forwardX + offsetZ * lane.forwardZ
      // Left of the lane is positive, as traffic's `shift` has it.
      const side = offsetX * lane.forwardZ - offsetZ * lane.forwardX
      if (along < -item.halfLength || along > lane.length + item.halfLength) continue
      if (side < 0 || side > 4) continue
      const edge = side - item.halfWidth - PASSING_MARGIN
      if (edge > 2) continue
      ;(lane.parked ??= []).push({ from: along - item.halfLength - 1, to: along + item.halfLength + 1, edge })
    }
  }
}

/** What traffic needs to know of a parked car or bike: where, and how big. */
export function parkedFootprints(parking: StreetParking) {
  return [
    ...parking.cars.map(({ x, z }) => ({ x, z, halfWidth: CAR.halfWidth, halfLength: CAR.length / 2 })),
    ...parking.bikes.map(({ x, z }) => ({ x, z, halfWidth: BIKE.halfWidth, halfLength: 0.95 })),
  ]
}
