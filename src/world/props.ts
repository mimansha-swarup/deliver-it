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
  /** Which colour it takes from its palette. Left out, `variation` picks one. */
  tint?: number
  /** Which tree shape it uses. Left out, `variation` picks one. */
  kind?: number
  /** A size multiplier, on top of the difference `variation` makes. */
  size?: number
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
const TREE_CHANCE = 0.7
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

/**
 * Canopy colours. The first `GREEN_TINTS` are leaf greens, and the rest are
 * trees in flower: gulmohar, yellow tabebuia, pink tabebuia and jacaranda.
 */
export const CANOPY_HEX = [
  '#4f7a3a',
  '#5e8a3f',
  '#3f6d3b',
  '#6c9347',
  '#47803f',
  '#7a9c45',
  '#356339',
  '#588f4c',
  '#dc5127',
  '#ecc63a',
  '#ea8fb6',
  '#9b7ad2',
]
export const GREEN_TINTS = 8
const BLOSSOM = { gulmohar: 8, yellow: 9, pink: 10, jacaranda: 11 }
/** Tree shapes, as listed in foliage.ts. */
const SHAPE = { round: 0, tall: 1, wide: 2 }

/**
 * How one road is planted. HSR's roads were planted a species at a time, so a
 * whole road flowers together. `blossom` is the colour its flowering trees take.
 */
type Avenue = { blossom?: number; shape?: number; size: number }
const GREEN_AVENUE: Avenue = { size: 1 }
/** A road gets one of these by its name, so the mix is two in five green, three in five in flower. */
const AVENUES: Avenue[] = [
  GREEN_AVENUE,
  GREEN_AVENUE,
  GREEN_AVENUE,
  // Rain trees: all green, and big enough to meet over the road.
  { shape: SHAPE.wide, size: 1.3 },
  { blossom: BLOSSOM.pink, shape: SHAPE.round, size: 1.05 },
  { blossom: BLOSSOM.pink, shape: SHAPE.round, size: 1.05 },
  { blossom: BLOSSOM.pink, shape: SHAPE.wide, size: 1.1 },
  { blossom: BLOSSOM.yellow, shape: SHAPE.round, size: 1 },
  { blossom: BLOSSOM.gulmohar, shape: SHAPE.wide, size: 1.15 },
  { blossom: BLOSSOM.jacaranda, shape: SHAPE.tall, size: 1.1 },
]
/** On a flowering road, this share of the trees are in flower, in percent. */
const AVENUE_BLOOM = 72
/** Anywhere else, the odd tree is in flower. */
const STRAY_BLOOM = 5
/** Trees on roads at least this wide grow bigger, in metres. */
const WIDE_ROAD = 7
const WIDE_ROAD_SIZE = 1.2

/** Scrambles a whole number into another, the same way every time. */
export function scramble(value: number): number {
  let mixed = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b)
  mixed ^= mixed >>> 13
  mixed = Math.imul(mixed, 0xc2b2ae35)
  return (mixed ^ (mixed >>> 16)) >>> 0
}

/** A number for a road. Pieces of one named road share it, so they're planted alike. */
function roadSeed(road: LineFeature, index: number): number {
  const name = road.properties.name
  if (!name) return scramble(index + 1)
  let seed = 7
  for (let at = 0; at < name.length; at++) seed = Math.imul(seed, 31) + name.charCodeAt(at)
  return scramble(seed)
}

/** A tree that isn't on a flowering road: green, or now and then in flower. */
export function strayTint(seed: number): number {
  const mixed = scramble(seed)
  if (mixed % 100 < STRAY_BLOOM) return GREEN_TINTS + ((mixed >>> 8) % (CANOPY_HEX.length - GREEN_TINTS))
  return (mixed >>> 8) % GREEN_TINTS
}

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

/** Road pieces are sorted into squares this wide, in metres. */
const ROAD_CELL = 32

/**
 * Road pieces sorted into grid squares, so that a check only looks at the roads
 * nearby. With the whole of HSR there are over 9,000 pieces. Checking all of
 * them for every tree and lamp took most of a minute.
 */
export type RoadIndex = {
  pieces: RoadPiece[]
  cells: Map<number, number[]>
  /** Marks pieces already checked in this query, as a piece can sit in many squares. */
  seen: Uint32Array
  query: number
}

const roadCell = (value: number) => Math.floor(value / ROAD_CELL)
const roadCellKey = (cellX: number, cellZ: number) => (cellX + 5000) * 10000 + (cellZ + 5000)

export function indexRoadPieces(pieces: RoadPiece[]): RoadIndex {
  const cells = new Map<number, number[]>()
  pieces.forEach(({ start, end, width }, piece) => {
    const reach = width / 2
    for (let cellX = roadCell(Math.min(start[0], end[0]) - reach); cellX <= roadCell(Math.max(start[0], end[0]) + reach); cellX++) {
      for (let cellZ = roadCell(Math.min(start[1], end[1]) - reach); cellZ <= roadCell(Math.max(start[1], end[1]) + reach); cellZ++) {
        const key = roadCellKey(cellX, cellZ)
        const cell = cells.get(key)
        if (cell) cell.push(piece)
        else cells.set(key, [piece])
      }
    }
  })
  return { pieces, cells, seen: new Uint32Array(pieces.length), query: 0 }
}

/** Every road piece whose road surface could be within `reach` of a point, each once. Stops when `visit` returns true. */
function someRoadNear(index: RoadIndex, x: number, z: number, reach: number, visit: (piece: RoadPiece) => boolean): boolean {
  const query = ++index.query
  for (let cellX = roadCell(x - reach); cellX <= roadCell(x + reach); cellX++) {
    for (let cellZ = roadCell(z - reach); cellZ <= roadCell(z + reach); cellZ++) {
      for (const piece of index.cells.get(roadCellKey(cellX, cellZ)) ?? []) {
        if (index.seen[piece] === query) continue
        index.seen[piece] = query
        if (visit(index.pieces[piece])) return true
      }
    }
  }
  return false
}

/** True when a point is more than `gap` metres from the edge of every road. */
export function isClearOfRoads(index: RoadIndex, x: number, z: number, gap: number): boolean {
  return !someRoadNear(index, x, z, gap, (piece) => distanceToPiece(x, z, piece) <= piece.width / 2 + gap)
}

/**
 * Points sorted into grid squares, for checking quickly whether a spot is too
 * close to something already placed there.
 */
export class PointGrid {
  private cells = new Map<number, number[]>()
  private readonly size: number

  constructor(size: number) {
    this.size = size
  }

  add(x: number, z: number) {
    const key = roadCellKey(Math.floor(x / this.size), Math.floor(z / this.size))
    const cell = this.cells.get(key)
    if (cell) cell.push(x, z)
    else this.cells.set(key, [x, z])
  }

  /** True when any point is closer than `distance`. */
  hasWithin(x: number, z: number, distance: number): boolean {
    for (let cellX = Math.floor((x - distance) / this.size); cellX <= Math.floor((x + distance) / this.size); cellX++) {
      for (let cellZ = Math.floor((z - distance) / this.size); cellZ <= Math.floor((z + distance) / this.size); cellZ++) {
        const cell = this.cells.get(roadCellKey(cellX, cellZ))
        if (!cell) continue
        for (let i = 0; i < cell.length; i += 2) {
          if (Math.hypot(cell[i] - x, cell[i + 1] - z) < distance) return true
        }
      }
    }
    return false
  }
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
  const roadIndex = indexRoadPieces(pieces)
  const placed = new PointGrid(MIN_PROP_SPACING)
  const props: RoadsideProps = { trees: [], lamps: [], postPairs: [], parkedScooters: [] }
  const lastLampOnRoad = new Map<number, Prop>()
  const avenues = roads.map((road, index) => AVENUES[roadSeed(road, index) % AVENUES.length])

  const canPlace = (x: number, z: number, buildingGap: number) =>
    !isNearBuilding(collisions, x, z, buildingGap) &&
    isClearOfRoads(roadIndex, x, z, ROAD_CLEARANCE) &&
    !placed.hasWithin(x, z, MIN_PROP_SPACING)

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

      placed.add(x, z)
      addPost(collisions, x, z, isLamp ? LAMP_POST_RADIUS : TREE_TRUNK_RADIUS)

      // A lamp's arm reaches back over the road.
      const rotation = isLamp ? Math.atan2(-directionZ * side, directionX * side) : random() * 6.28
      const prop = { x, z, rotation, variation: random() }
      if (!isLamp) {
        const avenue = avenues[piece.road]
        const blooms = avenue.blossom !== undefined && scramble(slot) % 100 < AVENUE_BLOOM
        props.trees.push({
          ...prop,
          tint: blooms ? avenue.blossom : strayTint(slot),
          kind: avenue.shape,
          size: avenue.size * (piece.width >= WIDE_ROAD ? WIDE_ROAD_SIZE : 1),
        })
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
    isClearOfRoads(roadIndex, x, z, PARKED_SCOOTER_RADIUS)

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
