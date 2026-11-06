import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { LineFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { clipToPlayArea } from './roadGeometry'
import { lonLatToWorld, type GroundPoint } from './worldUtils'

export type Prop = {
  x: number
  z: number
  /** Height above the ground, for things that sit on a roof. */
  y?: number
  /** Which way it faces, in radians around Y. */
  rotation: number
  /** A 0 to 1 value used for size and colour differences. */
  variation: number
}

/** Two neighbouring lamp posts on the same road, which a cable can join. */
export type PostPair = { from: Prop; to: Prop }

export type RoadsideProps = { trees: Prop[]; lamps: Prop[]; postPairs: PostPair[] }

const PROP_SPACING = 13
const TREE_CHANCE = 0.55
const LAMP_EVERY = 4
const TREE_ROAD_GAP = 1.3
const LAMP_ROAD_GAP = 0.6
const TREE_TRUNK_RADIUS = 0.25
const LAMP_POST_RADIUS = 0.1
const TREE_BUILDING_GAP = 1.8
const LAMP_BUILDING_GAP = 0.5
const MIN_PROP_SPACING = 4
const ROAD_CLEARANCE = 0.7
/** Lamp posts further apart than this don't get a cable between them, in metres. */
const MAX_CABLE_SPAN = 75

/** Mulberry32: a tiny random generator that gives the same numbers from the same seed. */
function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

type RoadPiece = { road: number; start: GroundPoint; end: GroundPoint; width: number }

function toRoadPieces(roads: LineFeature[]): RoadPiece[] {
  const pieces: RoadPiece[] = []

  roads.forEach((road, roadIndex) => {
    const width = getRoadWidth(road)
    const points = road.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    for (let i = 0; i < points.length - 1; i++) {
      const clipped = clipToPlayArea(points[i], points[i + 1])
      if (clipped) pieces.push({ road: roadIndex, start: clipped[0], end: clipped[1], width })
    }
  })

  return pieces
}

function distanceToPiece(x: number, z: number, { start, end }: RoadPiece): number {
  const edgeX = end[0] - start[0]
  const edgeZ = end[1] - start[1]
  const lengthSquared = edgeX * edgeX + edgeZ * edgeZ
  const along =
    lengthSquared === 0 ? 0 : ((x - start[0]) * edgeX + (z - start[1]) * edgeZ) / lengthSquared
  const clamped = Math.max(0, Math.min(1, along))
  return Math.hypot(x - (start[0] + edgeX * clamped), z - (start[1] + edgeZ * clamped))
}

/**
 * Lines the roads with trees and lamps, skipping spots on a road or against a
 * building, then makes each one solid. The seed never changes, so the
 * neighbourhood looks the same on every visit.
 */
export function generateRoadsideProps(
  roads: LineFeature[],
  collisions: CollisionWorld,
): RoadsideProps {
  const random = createRandom(20261106)
  const pieces = toRoadPieces(roads)
  const placed: GroundPoint[] = []
  const props: RoadsideProps = { trees: [], lamps: [], postPairs: [] }
  const lastLampOnRoad = new Map<number, Prop>()

  const canPlace = (x: number, z: number, buildingGap: number) =>
    !isNearBuilding(collisions, x, z, buildingGap) &&
    pieces.every((piece) => distanceToPiece(x, z, piece) > piece.width / 2 + ROAD_CLEARANCE) &&
    placed.every(([px, pz]) => Math.hypot(px - x, pz - z) >= MIN_PROP_SPACING)

  let slot = 0

  for (const piece of pieces) {
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    const directionX = (piece.end[0] - piece.start[0]) / length
    const directionZ = (piece.end[1] - piece.start[1]) / length

    for (let along = PROP_SPACING / 2; along < length; along += PROP_SPACING) {
      slot++
      const side = slot % 2 === 0 ? 1 : -1
      const isLamp = slot % LAMP_EVERY === 0
      if (!isLamp && random() > TREE_CHANCE) continue

      const gap = isLamp ? LAMP_ROAD_GAP : TREE_ROAD_GAP
      const offset = (piece.width / 2 + ROAD_CLEARANCE + gap) * side
      const x = piece.start[0] + directionX * along + directionZ * offset
      const z = piece.start[1] + directionZ * along - directionX * offset

      if (!canPlace(x, z, isLamp ? LAMP_BUILDING_GAP : TREE_BUILDING_GAP)) continue

      placed.push([x, z])
      addPost(collisions, x, z, isLamp ? LAMP_POST_RADIUS : TREE_TRUNK_RADIUS)

      // A lamp's arm reaches back over the road.
      const rotation = isLamp ? Math.atan2(-directionZ * side, directionX * side) : random() * 6.28
      const prop = { x, z, rotation, variation: random() }
      if (!isLamp) {
        props.trees.push(prop)
        continue
      }

      props.lamps.push(prop)
      const previous = lastLampOnRoad.get(piece.road)
      if (previous && Math.hypot(previous.x - x, previous.z - z) <= MAX_CABLE_SPAN) {
        props.postPairs.push({ from: previous, to: prop })
      }
      lastLampOnRoad.set(piece.road, prop)
    }
  }

  return props
}
