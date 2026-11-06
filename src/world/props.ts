import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { LineFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { clipToPlayArea } from './roadGeometry'
import type { ShopFront } from './shopFrontPlacement'
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

export type RoadsideProps = {
  /** Includes the trees in parks, which are added later. */
  trees: Prop[]
  lamps: Prop[]
  postPairs: PostPair[]
  parkedScooters: Prop[]
}

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
/** Parked scooters stand this far out from a shop's wall, in metres. */
const PARKING_DISTANCE = 2.1
const PARKED_SCOOTER_GAP = 1
const PARKED_SCOOTER_RADIUS = 0.35
const MAX_PARKED_PER_SHOP = 4
/** Lamp posts further apart than this don't get a cable between them, in metres. */
const MAX_CABLE_SPAN = 75

/** Mulberry32: a tiny random generator that gives the same numbers from the same seed. */
export function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export type RoadPiece = { road: number; start: GroundPoint; end: GroundPoint; width: number }

export function toRoadPieces(roads: LineFeature[]): RoadPiece[] {
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

export function distanceToPiece(x: number, z: number, { start, end }: RoadPiece): number {
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
  shopFronts: ShopFront[] = [],
): RoadsideProps {
  const random = createRandom(20261106)
  const pieces = toRoadPieces(roads)
  const placed: GroundPoint[] = []
  const props: RoadsideProps = { trees: [], lamps: [], postPairs: [], parkedScooters: [] }
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

  // Scooters left outside shops, kept off the road.
  const isParkingSpot = (x: number, z: number) =>
    !isNearBuilding(collisions, x, z, PARKED_SCOOTER_RADIUS + 0.1) &&
    pieces.every((piece) => distanceToPiece(x, z, piece) > piece.width / 2 + PARKED_SCOOTER_RADIUS)

  for (const front of shopFronts) {
    const outX = Math.sin(front.rotation)
    const outZ = Math.cos(front.rotation)
    const parked = Math.floor(random() * (MAX_PARKED_PER_SHOP + 1))

    for (let index = 0; index < parked; index++) {
      const across = (index - (parked - 1) / 2) * PARKED_SCOOTER_GAP
      const x = front.x + outX * PARKING_DISTANCE + outZ * across
      const z = front.z + outZ * PARKING_DISTANCE - outX * across
      if (!isParkingSpot(x, z)) continue

      // Not a post: a parked scooter is loose, so traffic handles it as a moving body.
      props.parkedScooters.push({
        x,
        z,
        // Some nose in and some back in, and none quite straight.
        rotation: front.rotation + (random() < 0.5 ? Math.PI : 0) + (random() - 0.5) * 0.3,
        variation: random(),
      })
    }
  }

  return props
}
