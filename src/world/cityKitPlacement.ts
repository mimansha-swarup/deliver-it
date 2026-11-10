import { FLOOR_HEIGHT, getFloors, hashString } from './buildingData'
import type { BuildingKind } from './buildingKinds'
import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { BuildingFeature, LineFeature } from './mapData'
import { distanceToPiece, toRoadPieces } from './props'
import type { ShopFront } from './shopFrontPlacement'
import { isInsideOutline, isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

export type KitPiece =
  | 'Metal_FullWindow'
  | 'Metal_FirstFloor_Window'
  | 'Metal_FirstFloor_Wall'
  | 'Brick_Window_Square_Single'
  | 'Brick_Plain_3_noWear'
  | 'Cornice_Metal_Center'
  | 'Cornice_Trim_Center'
  | 'Cornice_Brick_Center'
  | 'Metal_Column_Center'
  | 'DoorFrame_Metal_Single'
  | 'DoorFrame_Wooden'
  | 'Prop_Planter_Single'

export type KitPlacement = {
  piece: KitPiece
  x: number
  y: number
  z: number
  rotation: number
  scaleX: number
  scaleY: number
  scaleZ: number
  /** The quality level that first shows this piece. */
  detail: 0 | 1 | 2
  /** Whether its windows are on at night. */
  lit: boolean
}

type Style = {
  cornice: KitPiece
  door: KitPiece
  /** Pieces for the street level and the floors above, or none to keep the painted wall. */
  ground?: KitPiece[]
  upper?: KitPiece[]
}

const STYLES: Partial<Record<BuildingKind, Style>> = {
  apartment: { cornice: 'Cornice_Brick_Center', door: 'DoorFrame_Wooden' },
  civic: { cornice: 'Cornice_Trim_Center', door: 'DoorFrame_Wooden' },
  shop: {
    cornice: 'Cornice_Trim_Center',
    door: 'DoorFrame_Metal_Single',
    ground: ['Metal_FirstFloor_Window', 'Metal_FirstFloor_Window', 'Metal_FirstFloor_Wall'],
    upper: ['Brick_Window_Square_Single', 'Brick_Plain_3_noWear'],
  },
  office: {
    cornice: 'Cornice_Metal_Center',
    door: 'DoorFrame_Metal_Single',
    ground: ['Metal_FirstFloor_Window'],
    upper: ['Metal_FullWindow'],
  },
}

/** The kit's pieces are this size, in metres. */
const PIECE_WIDTH = 2
const PIECE_HEIGHT = 3
/** Kit walls are built backwards from their front, so they're moved out by their own depth. */
const WALL_DEPTH = 0.22
const CORNICE_HEIGHT = 0.6
const CORNICE_GAP = 0.12
/** Walls shorter than this are left as they are. */
const MIN_EDGE = 2
/** A wall facing another building this close is out of sight, so it gets nothing. */
const SPACE_CHECK_DISTANCE = 2.5
const SPACE_CHECK_RADIUS = 1.5
/** Pieces this close to an awning would swallow it and its sign. */
const AWNING_CLEARANCE = 3.5
const LIT_CHANCE = 45
const PLANTER_SCALE = 0.45
const PLANTER_GAP = 0.65
const PLANTER_RADIUS = 0.6
const PLANTER_SPREAD = 2
const PLANTER_ROAD_CLEARANCE = 1.2

type Edge = {
  start: GroundPoint
  end: GroundPoint
  length: number
  normalX: number
  normalZ: number
  /** How many pieces fit, and each one's width. They stretch a little to fill the wall. */
  count: number
  width: number
  rotation: number
}

function findEdges(outline: GroundPoint[], collisions: CollisionWorld): Edge[] {
  const edges: Edge[] = []

  outline.forEach((start, index) => {
    const end = outline[(index + 1) % outline.length]
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (length < MIN_EDGE) return

    const middleX = (start[0] + end[0]) / 2
    const middleZ = (start[1] + end[1]) / 2
    const sideX = (end[1] - start[1]) / length
    const sideZ = -(end[0] - start[0]) / length
    const flip = isInsideOutline(outline, middleX + sideX * 0.3, middleZ + sideZ * 0.3) ? -1 : 1
    const normalX = sideX * flip
    const normalZ = sideZ * flip

    const checkX = middleX + normalX * SPACE_CHECK_DISTANCE
    const checkZ = middleZ + normalZ * SPACE_CHECK_DISTANCE
    if (isNearBuilding(collisions, checkX, checkZ, SPACE_CHECK_RADIUS)) return

    const count = Math.max(1, Math.floor(length / PIECE_WIDTH))
    edges.push({
      start,
      end,
      length,
      normalX,
      normalZ,
      count,
      width: length / count,
      rotation: Math.atan2(normalX, normalZ),
    })
  })

  return edges
}

/** A point along a wall, `out` metres in front of it. `slot` counts pieces from the start. */
function pointOnEdge(edge: Edge, slot: number, out: number): GroundPoint {
  const along = ((slot + 0.5) * edge.width) / edge.length
  return [
    edge.start[0] + (edge.end[0] - edge.start[0]) * along + edge.normalX * out,
    edge.start[1] + (edge.end[1] - edge.start[1]) * along + edge.normalZ * out,
  ]
}

/** Lines the top of a wall with a cornice, so the building stops ending in a sharp box edge. */
function placeCornice(placed: KitPlacement[], edge: Edge, piece: KitPiece, height: number, gap: number) {
  for (let slot = 0; slot < edge.count; slot++) {
    const [x, z] = pointOnEdge(edge, slot, gap)
    placed.push({
      piece,
      x,
      y: height - CORNICE_HEIGHT / 2,
      z,
      rotation: edge.rotation,
      scaleX: edge.width / PIECE_WIDTH,
      scaleY: CORNICE_HEIGHT,
      scaleZ: 1,
      detail: 1,
      lit: false,
    })
  }
}

/** Builds a wall from pieces, floor by floor, leaving a slot for a door and room for awnings. */
function placeWall(
  placed: KitPlacement[],
  id: string,
  edge: Edge,
  style: Style,
  floors: number,
  doorSlot: number | undefined,
  shopFronts: ShopFront[],
) {
  const { ground, upper } = style
  if (!ground || !upper) return

  for (let floor = 0; floor < floors; floor++) {
    const pieces = floor === 0 ? ground : upper

    for (let slot = 0; slot < edge.count; slot++) {
      if (floor === 0 && slot === doorSlot) continue

      const [x, z] = pointOnEdge(edge, slot, WALL_DEPTH)

      // Awnings and signs reach up into the first floor, so both floors stay clear.
      const nearAwning = shopFronts.some(
        (front) => Math.hypot(front.x - x, front.z - z) < AWNING_CLEARANCE,
      )
      if (floor <= 1 && nearAwning) continue

      // Pieces are chosen by column, so a window stays above a window.
      placed.push({
        piece: pieces[slot % pieces.length],
        x,
        y: floor * FLOOR_HEIGHT,
        z,
        rotation: edge.rotation,
        scaleX: edge.width / PIECE_WIDTH,
        scaleY: FLOOR_HEIGHT / PIECE_HEIGHT,
        scaleZ: 1,
        detail: 2,
        lit: hashString(`${id}/${floor}/${slot}`) % 100 < LIT_CHANCE,
      })
    }
  }
}

/** Covers the seam where two kit walls meet at a corner. */
function placeCorner(placed: KitPlacement[], edge: Edge, floors: number) {
  for (const [x, z] of [edge.start, edge.end]) {
    for (let floor = 0; floor < floors; floor++) {
      placed.push({
        piece: 'Metal_Column_Center',
        x: x + edge.normalX * WALL_DEPTH * 0.5,
        y: floor * FLOOR_HEIGHT,
        z: z + edge.normalZ * WALL_DEPTH * 0.5,
        rotation: edge.rotation,
        scaleX: 1,
        scaleY: FLOOR_HEIGHT / PIECE_HEIGHT,
        scaleZ: 1,
        detail: 2,
        lit: false,
      })
    }
  }
}

/**
 * Decides where each piece of the city kit goes. It walks around each building's
 * real outline, so everything follows the map, and skips walls nobody can see.
 * Solid planters are added to the collision world, so call this before the props.
 */
export function placeCityKit(
  buildings: BuildingFeature[],
  roads: LineFeature[],
  collisions: CollisionWorld,
  shopFronts: ShopFront[],
): KitPlacement[] {
  const placed: KitPlacement[] = []
  const roadPieces = toRoadPieces(roads)

  for (const building of buildings) {
    const style = STYLES[building.kind]
    const ring = building.geometry.coordinates[0]
    if (!style || !isRingInPlayArea(ring)) continue

    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    const edges = findEdges(outline, collisions)
    if (edges.length === 0) continue

    const floors = Math.floor(getFloors(building))
    const height = floors * FLOOR_HEIGHT
    const hasWalls = Boolean(style.ground)
    const front = edges.reduce((longest, edge) => (edge.length > longest.length ? edge : longest))
    const doorSlot = Math.floor(front.count / 2)

    for (const edge of edges) {
      const gap = hasWalls ? WALL_DEPTH : CORNICE_GAP
      placeCornice(placed, edge, style.cornice, height, gap)
      if (!hasWalls) continue

      placeWall(placed, building.id, edge, style, floors, edge === front ? doorSlot : undefined, shopFronts)
      placeCorner(placed, edge, floors)
    }

    const [doorX, doorZ] = pointOnEdge(front, doorSlot, WALL_DEPTH)
    placed.push({
      piece: style.door,
      x: doorX,
      y: 0,
      z: doorZ,
      rotation: front.rotation,
      scaleX: 1,
      scaleY: FLOOR_HEIGHT / PIECE_HEIGHT,
      scaleZ: 1,
      detail: 1,
      lit: false,
    })

    // One planter beside the door, if there's a spot that's clear of the road and of awnings.
    const across = PLANTER_SPREAD / front.width
    const [x, z] = pointOnEdge(front, doorSlot + across, PLANTER_GAP)
    const isClear =
      !isNearBuilding(collisions, x, z, PLANTER_RADIUS) &&
      roadPieces.every(
        (piece) => distanceToPiece(x, z, piece) > piece.width / 2 + PLANTER_ROAD_CLEARANCE,
      ) &&
      shopFronts.every((shop) => Math.hypot(shop.x - x, shop.z - z) > AWNING_CLEARANCE)
    if (!isClear) continue

    addPost(collisions, x, z, PLANTER_RADIUS)
    placed.push({
      piece: 'Prop_Planter_Single',
      x,
      y: 0,
      z,
      rotation: front.rotation,
      scaleX: PLANTER_SCALE,
      scaleY: 1,
      scaleZ: PLANTER_SCALE,
      detail: 0,
      lit: false,
    })
  }

  return placed
}
