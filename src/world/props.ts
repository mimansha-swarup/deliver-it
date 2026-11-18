import { surfaceAllows } from './surfaceMap'
import { streetPresetOf } from './streetPresets'
import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { LineFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { clipToPlayArea } from './roadGeometry'
import type { ShopFront } from './shopFrontPlacement'
import { lonLatToWorld, type GroundPoint } from './worldUtils'
import { AVENUE_SPECIES, plantTree, SPECIES, type SpeciesName } from './treeSpecies'
import { TREE_SHAPE } from './foliage'

export type Prop = {
  x: number
  z: number
  /** Height above the ground, for things that sit on a roof. */
  y?: number
  /** Height above whatever ground it stands on (a raised footpath included), for things that sit on something, as a plant in a pot. */
  rise?: number
  /** Which way it faces, in radians around Y. */
  rotation: number
  /** A 0 to 1 value used for size and colour differences. */
  variation: number
  /** Which colour it takes from its palette. Left out, `variation` picks one. */
  tint?: number
  /** Which tree shape it uses. Left out, `variation` picks one. */
  kind?: number
  /** How wide it is, in metres, for things drawn to fit their space, such as kolams. Left out, it's the usual width. */
  width?: number
  /** A size multiplier, on top of the difference `variation` makes. */
  size?: number
  /** How far it leans from upright, in radians, towards a side set by `rotation` (trees). */
  lean?: number
}

/** Two neighbouring lamp posts on the same road, which a cable can join. */
export type PostPair = { from: Prop; to: Prop }

export type RoadsideProps = {
  /** Includes the trees in parks, which are added later. */
  trees: Prop[]
  lamps: Prop[]
  postPairs: PostPair[]
  parkedScooters: Prop[]
  /** Shrubs down the medians. Hedges in compounds come from the house kit. */
  bushes: Prop[]
  /** How many avenue arches and median trees went in, and arches refused, for the load timeline. */
  counts?: { archTrees: number; archRefused: number; medianTrees: number; shopTrees: number }
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
/** Shops with a scooter or two on the footpath outside, out of 1. */
const FOOTPATH_PARKING_SHARE = 0.3
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
  // Copper pod: a warmer gold than the tabebuia (darker reads as dead leaves once the leaf photo shades it).
  '#f2b82a',
]
export const GREEN_TINTS = 8
/** The odd tree off the avenues is in flower. */
const STRAY_BLOOM = 5
/** Trees on roads at least this wide grow bigger, in metres. */
const WIDE_ROAD = 7
const WIDE_ROAD_SIZE = 1.2

/**
 * Arching avenues: residential and main roads are lined both sides with big rain trees and
 * gulmohars, one every `ARCH_SPACING` metres a side, the two sides staggered. Each is turned to
 * face the road and leans into it, with the arch canopy (foliage.ts) reaching out over it, so the
 * two rows nearly meet over the middle.
 */
const ARCH_SPACING = 13
const ARCH_SPECIES: SpeciesName[] = ['rainTree', 'rainTree', 'rainTree', 'gulmohar']
const ARCH_LEAN: [number, number] = [0.06, 0.13]
/** The two sides' trees aren't quite opposite, nor quite square to the road. */
const ARCH_JITTER = 2.5
const ARCH_TURN = 0.3
/**
 * An avenue tree stands in a pit on the footpath just behind the kerb, this far out from the
 * road's edge, and needs only this much room from a wall: its canopy is high, over the road.
 */
const ARCH_ROAD_GAP = 0.85
const ARCH_BUILDING_GAP = 0.7
/** Trees down a main road's median, this far apart, and none this close to another road (a junction, where the median breaks). */
const MEDIAN_SPACING = 15
const MEDIAN_JUNCTION_CLEAR = 11
const MEDIAN_SPECIES: SpeciesName[] = ['neem', 'gulmohar', 'copperPod', 'gulmohar']
const MEDIAN_SIZE = 0.85
/** Shrubs between the median trees, this far apart along the median, in metres. */
const MEDIAN_SHRUB_SPACING = 4.5

/**
 * Shop streets get trees too, sparser: one every `SHOP_TREE_SPACING` metres a side, in a pit at the
 * kerb, with a smaller arch canopy leaning out over the road, high above the awnings. A tree never
 * stands in front of a shop's signboard: only between two shops' fronts, or past their ends, moved
 * along by up to `SHOP_TREE_SHIFT` metres to find such a gap.
 */
const SHOP_TREE_SPACING = 26
const SHOP_TREE_SPECIES: SpeciesName[] = ['neem', 'copperPod', 'rainTree', 'neem']
const SHOP_TREE_SIZE = 0.7
/** Leaning further out than an avenue's, so the canopy hangs over the road, not the shops' boards. */
const SHOP_TREE_LEAN: [number, number] = [0.12, 0.17]
const SHOP_TREE_SHIFT = [0, 1.5, -1.5, 3, -3, 4.5, -4.5]
/** How far in from each end of a shop's front its signboard reaches, in metres, which a trunk may stand in front of. */
const SIGN_END_MARGIN = 0.35

const isArchRoad = (road: LineFeature) => {
  const name = streetPresetOf(road)?.name
  return name === 'residential' || name === 'main'
}

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
 * How far a point is outside the nearest road's edge, in metres: negative on a
 * road. Roads further than `reach` aren't looked for, and then it returns `reach`.
 */
export function nearestRoadEdge(index: RoadIndex, x: number, z: number, reach: number): number {
  let nearest = reach
  someRoadNear(index, x, z, reach, (piece) => {
    nearest = Math.min(nearest, distanceToPiece(x, z, piece) - piece.width / 2)
    return false
  })
  return nearest
}

/** Calls `visit` for each road piece that might be within `reach` of a point. */
export function forEachRoadNear(index: RoadIndex, x: number, z: number, reach: number, visit: (piece: RoadPiece) => void) {
  someRoadNear(index, x, z, reach, (piece) => {
    visit(piece)
    return false
  })
}

/**
 * The road piece whose edge is nearest a point, and how far outside that edge
 * the point is (negative on the road), or null if none is within `reach`.
 */
export function nearestRoadPiece(
  index: RoadIndex,
  x: number,
  z: number,
  reach: number,
): { piece: RoadPiece; edge: number } | null {
  let nearest: { piece: RoadPiece; edge: number } | null = null
  someRoadNear(index, x, z, reach, (piece) => {
    const edge = distanceToPiece(x, z, piece) - piece.width / 2
    if (edge < reach && (!nearest || edge < nearest.edge)) nearest = { piece, edge }
    return false
  })
  return nearest
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
  /** Ground kept clear of trees, lamps and parked scooters, such as a petrol bunk's forecourt. */
  keepClear: (x: number, z: number) => boolean = () => false,
): RoadsideProps {
  const random = createRandom(20261106)
  const pieces = toRoadPieces(roads)
  const roadIndex = indexRoadPieces(pieces)
  const placed = new PointGrid(MIN_PROP_SPACING)
  const props: RoadsideProps = { trees: [], lamps: [], postPairs: [], parkedScooters: [], bushes: [] }
  props.counts = { archTrees: 0, archRefused: 0, medianTrees: 0, shopTrees: 0 }
  const lastLampOnRoad = new Map<number, Prop>()
  // HSR's roads were planted a species at a time, so a whole road is one kind of tree (treeSpecies.ts).
  const avenues = roads.map((road, index) => SPECIES[AVENUE_SPECIES[roadSeed(road, index) % AVENUE_SPECIES.length]])
  const arches = roads.map((road, index) => (isArchRoad(road) ? SPECIES[ARCH_SPECIES[roadSeed(road, index) % ARCH_SPECIES.length]] : null))

  // The ground must allow it too (surfaceMap.ts): a tree on open ground, a median or in a tree pit, a pole on a footpath.
  const canPlace = (x: number, z: number, buildingGap: number, what: 'tree' | 'pole') =>
    surfaceAllows(x, z, what) &&
    !isNearBuilding(collisions, x, z, buildingGap) &&
    !keepClear(x, z) &&
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
      // Arching avenues get their trees below; here only their lamps.
      if (!isLamp && (arches[piece.road] || random() > TREE_CHANCE)) continue

      const gap = isLamp ? LAMP_ROAD_GAP : TREE_ROAD_GAP
      const offset = (piece.width / 2 + ROAD_CLEARANCE + gap) * side
      const x = piece.start[0] + directionX * along + directionZ * offset
      const z = piece.start[1] + directionZ * along - directionX * offset

      if (!canPlace(x, z, isLamp ? LAMP_BUILDING_GAP : TREE_BUILDING_GAP, isLamp ? 'pole' : 'tree')) continue

      placed.add(x, z)
      addPost(collisions, x, z, isLamp ? LAMP_POST_RADIUS : TREE_TRUNK_RADIUS)

      // A lamp's arm reaches back over the road.
      const rotation = isLamp ? Math.atan2(-directionZ * side, directionX * side) : random() * 6.28
      const prop = { x, z, rotation, variation: random() }
      if (!isLamp) {
        props.trees.push(plantTree(avenues[piece.road], prop, slot, piece.width >= WIDE_ROAD ? WIDE_ROAD_SIZE : 1))
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

  // Arching avenues, both sides, after the lamps so the trees fit round them.
  let archRefused = 0
  for (const piece of pieces) {
    const species = arches[piece.road]
    if (!species) continue
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length < 1) continue
    const directionX = (piece.end[0] - piece.start[0]) / length
    const directionZ = (piece.end[1] - piece.start[1]) / length
    const offset = piece.width / 2 + ARCH_ROAD_GAP
    const size = piece.width >= WIDE_ROAD ? WIDE_ROAD_SIZE : 1
    for (const side of [1, -1]) {
      for (let along = (side > 0 ? 0.25 : 0.75) * ARCH_SPACING; along < length; along += ARCH_SPACING) {
        slot++
        const at = along + (random() - 0.5) * ARCH_JITTER
        const x = piece.start[0] + directionX * at + directionZ * offset * side
        const z = piece.start[1] + directionZ * at - directionX * offset * side
        if (!canPlace(x, z, ARCH_BUILDING_GAP, 'tree')) {
          archRefused++
          continue
        }
        placed.add(x, z)
        addPost(collisions, x, z, TREE_TRUNK_RADIUS)
        const tree = plantTree(species, { x, z }, slot, size)
        // Facing the road: the canopy's reach (+z in its own frame) points across it.
        tree.rotation = Math.atan2(-directionZ * side, directionX * side) + (random() - 0.5) * ARCH_TURN
        tree.lean = ARCH_LEAN[0] + (ARCH_LEAN[1] - ARCH_LEAN[0]) * random()
        tree.kind = TREE_SHAPE.arch
        props.trees.push(tree)
      }
    }
  }

  // Shop streets: sparser trees at the kerb, between the signboards.
  const fronts = new Map<number, ShopFront[]>()
  const FRONT_CELL = 16
  for (const front of shopFronts) {
    const key = roadCellKey(Math.floor(front.x / FRONT_CELL), Math.floor(front.z / FRONT_CELL))
    const cell = fronts.get(key)
    if (cell) cell.push(front)
    else fronts.set(key, [front])
  }
  /** Whether a trunk here would stand in front of a shop's signboard. */
  const hidesSign = (x: number, z: number) => {
    for (let cellX = Math.floor(x / FRONT_CELL) - 1; cellX <= Math.floor(x / FRONT_CELL) + 1; cellX++) {
      for (let cellZ = Math.floor(z / FRONT_CELL) - 1; cellZ <= Math.floor(z / FRONT_CELL) + 1; cellZ++) {
        for (const front of fronts.get(roadCellKey(cellX, cellZ)) ?? []) {
          const out = (x - front.x) * Math.sin(front.rotation) + (z - front.z) * Math.cos(front.rotation)
          const across = (x - front.x) * Math.cos(front.rotation) - (z - front.z) * Math.sin(front.rotation)
          if (out > -0.5 && out < 8 && Math.abs(across) < front.width / 2 - SIGN_END_MARGIN) return true
        }
      }
    }
    return false
  }
  let shopTrees = 0
  for (const piece of pieces) {
    const road = roads[piece.road]
    if (streetPresetOf(road)?.name !== 'shop') continue
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length < 1) continue
    const directionX = (piece.end[0] - piece.start[0]) / length
    const directionZ = (piece.end[1] - piece.start[1]) / length
    const offset = piece.width / 2 + ARCH_ROAD_GAP
    const species = SPECIES[SHOP_TREE_SPECIES[roadSeed(road, piece.road) % SHOP_TREE_SPECIES.length]]
    for (const side of [1, -1]) {
      for (let along = (side > 0 ? 0.3 : 0.8) * SHOP_TREE_SPACING; along < length; along += SHOP_TREE_SPACING) {
        slot++
        for (const shift of SHOP_TREE_SHIFT) {
          const at = along + shift
          if (at < 0 || at > length) continue
          const x = piece.start[0] + directionX * at + directionZ * offset * side
          const z = piece.start[1] + directionZ * at - directionX * offset * side
          if (hidesSign(x, z) || !canPlace(x, z, ARCH_BUILDING_GAP, 'tree')) continue
          placed.add(x, z)
          addPost(collisions, x, z, TREE_TRUNK_RADIUS)
          const tree = plantTree(species, { x, z }, slot, SHOP_TREE_SIZE)
          tree.rotation = Math.atan2(-directionZ * side, directionX * side) + (random() - 0.5) * ARCH_TURN
          tree.lean = SHOP_TREE_LEAN[0] + (SHOP_TREE_LEAN[1] - SHOP_TREE_LEAN[0]) * random()
          tree.kind = TREE_SHAPE.arch
          props.trees.push(tree)
          shopTrees++
          break
        }
      }
    }
  }

  props.counts.archTrees = props.trees.filter(({ kind }) => kind === TREE_SHAPE.arch).length - shopTrees
  props.counts.archRefused = archRefused
  props.counts.shopTrees = shopTrees

  // Trees down the median of a main road, where it's drawn: on the median, clear of junctions.
  for (const piece of pieces) {
    const road = roads[piece.road]
    const median = streetPresetOf(road)?.median
    if (!median || road.properties.oneway === 'yes' || piece.width < median.minRoadWidth) continue
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    const directionX = (piece.end[0] - piece.start[0]) / (length || 1)
    const directionZ = (piece.end[1] - piece.start[1]) / (length || 1)
    // Shrubs all down the median where it's drawn, round the trees.
    for (let along = MEDIAN_SHRUB_SPACING / 2; along < length; along += MEDIAN_SHRUB_SPACING) {
      const x = piece.start[0] + directionX * along
      const z = piece.start[1] + directionZ * along
      if (!surfaceAllows(x, z, 'bush') || keepClear(x, z) || placed.hasWithin(x, z, 1.2)) continue
      let nearJunction = false
      forEachRoadNear(roadIndex, x, z, MEDIAN_JUNCTION_CLEAR, (other) => {
        if (other.road !== piece.road && distanceToPiece(x, z, other) < other.width / 2 + MEDIAN_JUNCTION_CLEAR - 2) nearJunction = true
      })
      if (nearJunction) continue
      props.bushes.push({ x, z, rotation: Math.atan2(directionX, directionZ) + Math.PI / 2 + (random() - 0.5) * 0.4, variation: random(), size: 0.7 + random() * 0.3 })
    }
    for (let along = MEDIAN_SPACING / 2; along < length; along += MEDIAN_SPACING) {
      slot++
      const x = piece.start[0] + directionX * along
      const z = piece.start[1] + directionZ * along
      if (!surfaceAllows(x, z, 'tree') || placed.hasWithin(x, z, MIN_PROP_SPACING) || keepClear(x, z)) continue
      let nearJunction = false
      forEachRoadNear(roadIndex, x, z, MEDIAN_JUNCTION_CLEAR, (other) => {
        if (other.road !== piece.road && distanceToPiece(x, z, other) < other.width / 2 + MEDIAN_JUNCTION_CLEAR) nearJunction = true
      })
      if (nearJunction) continue
      placed.add(x, z)
      addPost(collisions, x, z, TREE_TRUNK_RADIUS)
      props.trees.push(plantTree(SPECIES[MEDIAN_SPECIES[roadSeed(road, piece.road) % MEDIAN_SPECIES.length]], { x, z }, slot, MEDIAN_SIZE))
      props.counts.medianTrees++
    }
  }

  // Scooters left outside shops, kept off the road.
  const isParkingSpot = (x: number, z: number) =>
    surfaceAllows(x, z, 'footpathBike') &&
    !isNearBuilding(collisions, x, z, PARKED_SCOOTER_RADIUS + 0.1) &&
    !keepClear(x, z) &&
    isClearOfRoads(roadIndex, x, z, PARKED_SCOOTER_RADIUS)

  for (const front of shopFronts) {
    const outX = Math.sin(front.rotation)
    const outZ = Math.cos(front.rotation)
    // How many the street has room and custom for (streetPresets.ts): more on a shop street.
    const near = nearestRoadPiece(roadIndex, front.x, front.z, 14)
    const most = (near && streetPresetOf(roads[near.piece.road])?.parkedPerShop) ?? MAX_PARKED_PER_SHOP
    // Most parked two-wheelers are at the kerb now (streetParking.ts); a few still stand on the footpath.
    const parked = random() < FOOTPATH_PARKING_SHARE ? 1 + Math.floor(random() * Math.min(2, most)) : 0

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
