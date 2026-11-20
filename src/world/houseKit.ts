import type { Door } from '../game/doorsteps'
import * as THREE from 'three'
import { POSTER_ASPECT, POSTER_COLUMNS, POSTER_COUNT, POSTER_ROWS } from './posters'
import { FLOOR_HEIGHT, getFloors, getKitColor, hashString, hasStilts } from './buildingData'
import { addWall, copyCollisionWorld, isNearBuilding, type CollisionWorld } from './collision'
import { chunkCentre, chunkKey } from './chunks'
import { FACADE_LOOKS } from './facadeTextures'
import type { BuildingFeature, CivicUse, LineFeature } from './mapData'
import { indexRoadPieces, isClearOfRoads, nearestRoadEdge, nearestRoadPiece, toRoadPieces, type Prop, type RoadIndex } from './props'
import { streetPresetOf } from './streetPresets'
import { KERB } from './surface'
import { isInsideOutline, isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

/**
 * The HSR house kit: what turns an extruded outline into a Bengaluru house.
 * Every house gets, in plain concrete and paint:
 * - a chajja (a thin concrete sunshade) over every window
 * - a balcony on each upper floor of the side facing the road, with a solid
 *   parapet, a dark metal rail and, on some, washing hung out
 * - a parapet wall around the terrace, and a staircase room ("headroom") on the
 *   roof with a door, with the black water tanks on top of it
 * - a front door, and, where there's room, a compound wall with pillars and a
 *   metal gate between the house and the pavement
 *
 * Shop buildings get the same kit above the street, as HSR's shops are mostly
 * the ground floor of a house: no door or compound wall, balconies from the
 * second floor up, and their road-facing wall split into shop units with piers
 * between them (see `ShopUnit`).
 *
 * It's all simple boxes, merged into one shape per map square, so a street of
 * houses costs a draw call or two. Chajjas are a separate layer, as there are
 * many of them and they only matter up close.
 */

// The painted windows (see paintHouse in facadeTextures.ts): one per bay, 1.6 m
// wide, from 0.9 m to 2.55 m above its floor.
const BAY = FACADE_LOOKS.house.bayWidth
const WINDOW_HALF_WIDTH = 0.8
const WINDOW_TOP = 2.55

const CHAJJA = { width: 2.0, depth: 0.5, thickness: 0.08, gap: 0.07 }
const BALCONY = { depth: 1.0, slab: 0.15, parapet: 0.95, wall: 0.1, minWidth: 2.4, maxWidth: 4.6 }
const PARAPET = { height: 0.9, thickness: 0.12 }
const HEADROOM = { width: 2.8, depth: 3.2, height: 2.5, slab: 0.12, overhang: 0.2 }
const DOOR = { width: 1.05, height: 2.15, frame: 0.1 }
/** The compound wall: how high, how thick, the gate's width, and its pillars. */
/** The piers between shop units, and how wide a unit tries to be, in metres. */
const SHOP = { pier: 0.32, pierDepth: 0.14, pierHeight: 3.95, unit: 4.2, minUnit: 2.6 }
/** Pavement this wide in front of a shop leaves room for a menu board. */
const MENU_BOARD = { minGap: 2.7, out: 1.05, chance: 45 }

/**
 * Blocks of flats. The painted bays (see paintApartment) are a balcony door
 * 2.2 m wide, topped 2.85 m above its floor. Out front, each bay gets a real
 * balcony; on the other walls, a sunshade over the door.
 */
const APARTMENT = {
  bay: FACADE_LOOKS.apartment.bayWidth,
  doorHalfWidth: 1.2,
  doorTop: 2.85,
  balconyHalfWidth: 1.5,
  balconyDepth: 1.1,
  chajjaWidth: 2.7,
  pillar: 0.45,
  pillarSpacing: 4.6,
  gridSpacing: 5.5,
  core: { width: 3.2, depth: 4.2 },
  room: { width: 3.8, depth: 4.8, height: 2.9 },
  gate: 4.2,
  plantChance: 40,
}
/** Bikes parked under the stilts stand this far apart, and this far in from the front, in metres. */
const STILT_BIKE = { gap: 0.85, in: 1.0 }
const STILT_CAR = { in: 2.5, halfLength: 2.1, minGap: 2.6, chance: 55 }
/** The floor under stilts: in the building's shade all day, so darker than the open ground. */
const STILT_FLOOR = { height: 0.06, color: new THREE.Color('#6e6c67') }
const PLANT_COLOR = new THREE.Color('#3f7d3a')
const POT_COLOR = new THREE.Color('#a4552f')
const CORE_DOOR_COLOR = new THREE.Color('#6b6e72')

const COMPOUND = { height: 1.4, thickness: 0.15, gate: 3.0, pillar: 0.38, pillarHeight: 1.7, pavement: 1.6 }
/** A plot's side walls run this far past the back of its house, in metres. */
const PLOT_WALL_BEYOND = 1.5
/** Too little room between house and pavement for a compound wall, and the most it ever stands out. */
/** Bougainvillea needs this much wall, in metres, and grows on this share of houses, in percent. */
const CREEPER = { minWall: 3.2, chance: 34 }
/**
 * Kolams: the share of houses with one, how wide one is at most, and the
 * smallest worth drawing, in metres. Each keeps this gap from the wall and the kerb.
 */
const KOLAM = { chance: 45, size: 1.5, smallest: 0.9, gap: 0.06 }
const MIN_YARD = 1.2
const MAX_YARD = 4
/** Walls shorter than this get nothing. */
const MIN_EDGE = 2
/** A wall with another building this close in front of it is out of sight. */
const HIDDEN_CHECK = { distance: 2.5, radius: 1.5 }
/** How far out from a wall to look for a road, in metres. */
const ROAD_SEARCH = 22
const WASHING_CHANCE = 35

/*
 * The building kit's choices, made per house from its id (see `chooseStyle`): which roof, which
 * balcony, whether it has an outside stair or tiled panels on its front. HSR mixes them freely.
 */
/** A Mangalore tile roof: pitch, overhang past the walls, and how many courses show per slope. */
const TILE_ROOF = { pitch: 0.42, overhang: 0.45, courses: 6, ridge: 0.12, minRectangular: 0.82, maxFloors: 2, maxArea: 180, chance: 30 }
const TILE_COLORS = ['#a24a32', '#b0573a', '#954433', '#a85e3f'].map((color) => new THREE.Color(color))
/** A sheet-metal shed on the terrace, on posts, its roof sloping one way. */
const SHED = { width: 3.2, depth: 2.6, low: 2.1, high: 2.6, post: 0.08, chance: 30 }
const SHED_COLORS = ['#3d6fa3', '#8c949b', '#4c8a8a', '#a8a39a'].map((color) => new THREE.Color(color))
/** An outside stair up a side wall to the first floor, for a separately let upstairs. */
const OUTER_STAIR = { width: 0.9, rise: 0.2, tread: 0.26, landing: 1.0, rail: 0.85, chance: 40, minFloors: 2 }
/** Balconies: a solid parapet (the default), or a metal grille on a low kerb. Share with a grille, out of 100. */
const GRILLE = { chance: 40, kerb: 0.2, bar: 0.035, spacing: 0.32 }
/** Elevation tiles: a band of stone or ceramic cladding up one side of the front. */
const CLADDING = { chance: 35, course: 0.6, minWidth: 0.9, maxWidth: 1.5 }
const CLADDING_COLORS: [string, string][] = [
  ['#8a8079', '#7a706a'], // grey slate
  ['#c9a678', '#b8956a'], // sandstone
  ['#a5553c', '#93492f'], // brick tile
  ['#d8d2c4', '#c7c0b0'], // pale ceramic
]

const RAIL_COLOR = new THREE.Color('#2b2d30')
const GATE_COLOR = new THREE.Color('#33373b')
const DOOR_COLOR = new THREE.Color('#5a3a24')
const DOOR_FRAME_COLOR = new THREE.Color('#e9e4d8')
const PILLAR_CAP_COLOR = new THREE.Color('#d9d4c8')
const HEADROOM_DOOR_COLOR = new THREE.Color('#4a4e52')
/** Washing on the line: saris, towels and shirts, in the bright colours they so often are. */
const WASHING_COLORS = ['#c62f5c', '#f2b705', '#2a7fc2', '#ffffff', '#e86a1c', '#3f9b5a', '#7b3fa0', '#e8e1cf'].map(
  (color) => new THREE.Color(color),
)

const edgeB = new THREE.Vector3()
const edgeC = new THREE.Vector3()

/*
 * Byte versions of normals and colours, written in a plain loop. `Int8Array.from(list, fn)` goes
 * through the iterator protocol and a callback per number, and building a square of the house
 * kit while riding spent most of its time there.
 */
function toNormalBytes(values: number[]): Int8Array {
  const bytes = new Int8Array(values.length)
  for (let i = 0; i < values.length; i++) bytes[i] = Math.round(values[i] * 127)
  return bytes
}

function toColorBytes(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    bytes[i] = Math.round((value < 0 ? 0 : value > 1 ? 1 : value) * 255)
  }
  return bytes
}

/** Collects triangles for one map square: positions, normals and colours, three per corner. */
class Builder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  /** A builder that isn't enabled ignores every shape, for working out where things go without their triangles. */
  readonly enabled: boolean

  constructor(enabled = true) {
    this.enabled = enabled
  }

  /**
   * A flat four-cornered face, given in order around its edge. A face only shows
   * from the side where its corners run anticlockwise. Map outlines run either
   * way round, so the order is checked against the way the face should point,
   * and turned round if it's wrong.
   */
  quad(points: THREE.Vector3[], normal: THREE.Vector3, color: THREE.Color) {
    if (!this.enabled) return
    const [a, b, c, d] = points
    const facing = edgeB.subVectors(b, a).cross(edgeC.subVectors(c, a)).dot(normal)
    if (facing >= 0) this.corners(a, b, c, a, c, d, normal, color)
    else this.corners(a, d, c, a, c, b, normal, color)
  }

  private corners(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3, p5: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color) {
    this.positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z, p5.x, p5.y, p5.z)
    for (let i = 0; i < 6; i++) {
      this.normals.push(normal.x, normal.y, normal.z)
      this.colors.push(color.r, color.g, color.b)
    }
  }

  /** A flat shape of any outline, lying level at `height`, facing up. */
  floor(outline: GroundPoint[], height: number, color: THREE.Color) {
    if (!this.enabled) return
    const contour = outline.map(([x, z]) => new THREE.Vector2(x, z))
    const up = new THREE.Vector3(0, 1, 0)
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const points = [a, b, c].map((index) => new THREE.Vector3(outline[index][0], height, outline[index][1]))
      const facing = edgeB.subVectors(points[1], points[0]).cross(edgeC.subVectors(points[2], points[0])).dot(up)
      for (const point of facing >= 0 ? points : points.reverse()) {
        this.positions.push(point.x, point.y, point.z)
        this.normals.push(0, 1, 0)
        this.colors.push(color.r, color.g, color.b)
      }
    }
  }

  /**
   * Normals and colours are stored as one byte per number, not four: a normal's
   * -1 to 1 as -127 to 127, a colour's 0 to 1 as 0 to 255. `normalized` tells the
   * GPU to turn them back. It halves the memory, which adds up over millions of corners.
   */
  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(toNormalBytes(this.normals), 3, true))
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(toColorBytes(this.colors), 3, true),
    )
    geometry.computeBoundingSphere()
    return geometry
  }
}

/** The dark of grime and water stains: a warm near-black, laid see-through over the paint. */
const STAIN = new THREE.Color('#241e18')

/**
 * Soft marks laid just off a wall: dark, and see-through by a different amount
 * at each corner, so they fade out. They darken whatever paint is under them,
 * so one colour does for every wall. Used for the shade under balconies and
 * sunshades (ambient occlusion, baked in) and streaks under AC units.
 */
class StainBuilder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  readonly enabled: boolean

  constructor(enabled = true) {
    this.enabled = enabled
  }

  /** A mark on a wall, from `alongFrom` to `alongTo` and `low` to `high`, as dark as `top` at its top and `bottom` at its foot. */
  onWall(wall: Wall, [alongFrom, alongTo]: [number, number], [low, high]: [number, number], [top, bottom]: [number, number]) {
    if (!this.enabled) return
    const out = 0.012
    const at = (along: number, height: number, alpha: number) => {
      this.positions.push(
        wall.start[0] + wall.alongX * along + wall.outX * out,
        height,
        wall.start[1] + wall.alongZ * along + wall.outZ * out,
      )
      this.normals.push(wall.outX, 0, wall.outZ)
      this.colors.push(STAIN.r, STAIN.g, STAIN.b, alpha)
    }
    // Facing out from the wall: anticlockwise seen from outside.
    const corners: [number, number, number][] = [
      [alongFrom, low, bottom],
      [alongTo, low, bottom],
      [alongTo, high, top],
      [alongFrom, low, bottom],
      [alongTo, high, top],
      [alongFrom, high, top],
    ]
    const first = new THREE.Vector3(wall.alongX * (alongTo - alongFrom), 0, wall.alongZ * (alongTo - alongFrom))
    const second = new THREE.Vector3(wall.alongX * (alongTo - alongFrom), high - low, wall.alongZ * (alongTo - alongFrom))
    const facesOut = first.cross(second).dot(new THREE.Vector3(wall.outX, 0, wall.outZ)) >= 0
    const ordered = facesOut ? corners : [corners[0], corners[2], corners[1], corners[3], corners[5], corners[4]]
    for (const [along, height, alpha] of ordered) at(along, height, alpha)
  }

  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(toNormalBytes(this.normals), 3, true))
    geometry.setAttribute('color', new THREE.BufferAttribute(toColorBytes(this.colors), 4, true))
    geometry.computeBoundingSphere()
    return geometry
  }
}

/** Paper posters on walls, each a quad showing one poster of the shared picture (posters.ts). */
class PosterBuilder {
  positions: number[] = []
  normals: number[] = []
  uvs: number[] = []
  readonly enabled: boolean

  constructor(enabled = true) {
    this.enabled = enabled
  }

  /** A poster on a wall, centred `along` it, its bottom at `low`, standing `out` off the wall's line. */
  onWall(wall: Wall, along: number, out: number, low: number, poster: number) {
    if (!this.enabled) return
    const width = POSTER.height * POSTER_ASPECT
    const column = poster % POSTER_COLUMNS
    const row = Math.floor(poster / POSTER_COLUMNS) % POSTER_ROWS
    const u = (x: number) => (column + x) / POSTER_COLUMNS
    const v = (y: number) => 1 - (row + 1 - y) / POSTER_ROWS
    // A slight tilt, as posters are pasted by hand.
    const tilt = ((poster * 37) % 7 - 3) * 0.01
    const point = (x: number, y: number): [number, number, number] => {
      const a = along + (x - 0.5) * width + (y - 0.5) * tilt
      const h = low + y * POSTER.height - (x - 0.5) * tilt
      return [wall.start[0] + wall.alongX * a + wall.outX * out, h, wall.start[1] + wall.alongZ * a + wall.outZ * out]
    }
    const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
    // Facing out from the wall.
    const first = new THREE.Vector3(...point(1, 0)).sub(new THREE.Vector3(...point(0, 0)))
    const second = new THREE.Vector3(...point(1, 1)).sub(new THREE.Vector3(...point(0, 0)))
    const facesOut = first.cross(second).dot(new THREE.Vector3(wall.outX, 0, wall.outZ)) >= 0
    const ordered = facesOut ? corners : [corners[0], corners[2], corners[1], corners[3], corners[5], corners[4]]
    for (const [x, y] of ordered) {
      this.positions.push(...point(x, y))
      this.normals.push(wall.outX, 0, wall.outZ)
      // Seen from the street the wall's "along" may run right to left; flip so the text reads.
      this.uvs.push(u(facesOut ? x : 1 - x), v(y))
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.computeBoundingSphere()
    return geometry
  }
}

const POSTER = { height: 0.7, low: 0.55 }
/** Out of 100: compound walls with a poster beside the gate, and those with pots on the wall either side. */
const POSTER_CHANCE = 50
const POT_CHANCE = 45
/** Out of 100: balconies with potted plants along them, and houses with pots either side of the door. */
const BALCONY_POT_CHANCE = 40
const DOORSTEP_POT_CHANCE = 55
/** Out of 100: compound yards with a hedge along the inside of the front wall; its bushes are this far apart, in metres. */
const HEDGE_CHANCE = 55
const HEDGE_SPACING = 1.5

/** An outdoor AC unit, on a bracket under a window sill, and its fan grille. */
const AC_UNIT = { width: 0.8, height: 0.55, depth: 0.3, low: 0.18, grille: 0.4 }
const AC_COLOR = new THREE.Color('#d9d9d4')
const GRILLE_COLOR = new THREE.Color('#3b3e43')
/**
 * About this share of house windows above the ground floor have an AC unit under
 * them, out of 100. The first share shows on Medium and High, the rest only on
 * High (the `fine` layer), so the street fills up with the quality setting.
 */
const AC_CHANCE = 12
const AC_CHANCE_HIGH = 20

/**
 * A wall of a house: where it starts, which way it runs (`along`), and which way
 * is out (`out`). Everything on it is placed by distance along, distance out and height.
 */
type Wall = {
  start: GroundPoint
  length: number
  alongX: number
  alongZ: number
  outX: number
  outZ: number
  /** Whether the street can see it, rather than a neighbour's wall right in front. */
  exposed: boolean
}

/** Reused by `box`, so building a square doesn't make dozens of vectors for every box. */
const BOX_CORNERS = Array.from({ length: 8 }, () => new THREE.Vector3())
const BOX_OUT = new THREE.Vector3()
const BOX_SIDE = new THREE.Vector3()
const BOX_BACK = new THREE.Vector3()
const BOX_UP = new THREE.Vector3(0, 1, 0)
const BOX_DOWN = new THREE.Vector3(0, -1, 0)

/**
 * A box against a wall, from `along` to `along + width`, from `out` to `out + depth`,
 * and from `low` to `high`. `back` leaves off the face against the wall, which nobody sees.
 */
function box(
  builder: Builder,
  wall: Wall,
  [alongFrom, alongTo]: [number, number],
  [outFrom, outTo]: [number, number],
  [low, high]: [number, number],
  color: THREE.Color,
  back = false,
) {
  // Planning only asks where things go; a builder that isn't enabled draws nothing, so skip the maths.
  if (!builder.enabled) return
  // The eight corners, worked out once into reused vectors (quad copies them straight away).
  for (let i = 0; i < 8; i++) {
    const along = i & 4 ? alongTo : alongFrom
    const out = i & 2 ? outTo : outFrom
    BOX_CORNERS[i].set(wall.start[0] + wall.alongX * along + wall.outX * out, i & 1 ? high : low, wall.start[1] + wall.alongZ * along + wall.outZ * out)
  }
  const outward = BOX_OUT.set(wall.outX, 0, wall.outZ)
  const sideways = BOX_SIDE.set(wall.alongX, 0, wall.alongZ)
  const up = BOX_UP

  // Corners named by (along, out, height): 0 is the low end, 1 the high end.
  const p = (a: 0 | 1, o: 0 | 1, h: 0 | 1) => BOX_CORNERS[a * 4 + o * 2 + h]

  builder.quad([p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1)], outward, color)
  builder.quad([p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)], sideways, color)
  builder.quad([p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)], BOX_BACK.copy(sideways).negate(), color)
  builder.quad([p(0, 0, 1), p(0, 1, 1), p(1, 1, 1), p(1, 0, 1)], up, color)
  builder.quad([p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0)], BOX_DOWN, color)
  if (back) builder.quad([p(1, 0, 0), p(0, 0, 0), p(0, 0, 1), p(1, 0, 1)], BOX_BACK.copy(outward).negate(), color)
}

function toWalls(outline: GroundPoint[], collisions: CollisionWorld): Wall[] {
  const walls: Wall[] = []
  outline.forEach((start, index) => {
    const end = outline[(index + 1) % outline.length]
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (length < MIN_EDGE) return
    const alongX = (end[0] - start[0]) / length
    const alongZ = (end[1] - start[1]) / length
    const middleX = (start[0] + end[0]) / 2
    const middleZ = (start[1] + end[1]) / 2
    // Out is whichever side isn't inside the house.
    const flip = isInsideOutline(outline, middleX + alongZ * 0.3, middleZ - alongX * 0.3) ? -1 : 1
    const outX = alongZ * flip
    const outZ = -alongX * flip
    const exposed = !isNearBuilding(
      collisions,
      middleX + outX * HIDDEN_CHECK.distance,
      middleZ + outZ * HIDDEN_CHECK.distance,
      HIDDEN_CHECK.radius,
    )
    walls.push({ start, length, alongX, alongZ, outX, outZ, exposed })
  })
  return walls
}

/**
 * Where the painted windows are along a wall, as distances from its start. The
 * walls are painted by distance along a world direction, not from each wall's
 * corner, so this works out the same positions the paint has.
 */
function windowCentres(wall: Wall, bayWidth = BAY, halfWidth = WINDOW_HALF_WIDTH): number[] {
  // The paint measures along (normal.z, -normal.x), in world X and Z (see applyFacadeMapping).
  const project = (x: number, z: number) => x * wall.outZ - z * wall.outX
  const from = project(wall.start[0], wall.start[1])
  const to = project(wall.start[0] + wall.alongX * wall.length, wall.start[1] + wall.alongZ * wall.length)
  const low = Math.min(from, to)
  const high = Math.max(from, to)

  const centres: number[] = []
  for (let bay = Math.ceil(low / bayWidth - 0.5); (bay + 0.5) * bayWidth <= high; bay++) {
    const centre = (bay + 0.5) * bayWidth
    const along = ((centre - from) / (to - from)) * wall.length
    if (along - halfWidth < 0.2 || along + halfWidth > wall.length - 0.2) continue
    centres.push(along)
  }
  return centres
}

/** How far out from the middle of a wall the road starts, or Infinity if there's no road that way. */
function distanceToRoad(wall: Wall, roads: RoadIndex): number {
  const middleX = wall.start[0] + wall.alongX * wall.length * 0.5
  const middleZ = wall.start[1] + wall.alongZ * wall.length * 0.5
  for (let out = 0.5; out <= ROAD_SEARCH; out += 0.5) {
    const x = middleX + wall.outX * out
    const z = middleZ + wall.outZ * out
    if (!isClearOfRoads(roads, x, z, 0)) return out
  }
  return Infinity
}

/** One shop's share of a shop building's front, for ShopFronts to fill. */
export type ShopUnit = {
  /** The middle of its front, on the wall. */
  x: number
  z: number
  rotation: number
  width: number
  /** A stable number for picking its kind of shop. */
  seed: number
  /** Where its chalk menu board stands, if it has one. */
  menuBoard?: GroundPoint
}

export type HouseKit = {
  /** The map squares that have kit in them, with their middles. */
  squares: { key: number; x: number; z: number }[]
  /**
   * Builds the shapes for one map square: balconies, parapets, roof rooms, doors
   * and compound walls in `main`, and the many small chajjas on their own, as
   * they're drawn only up close. Squares are built as the rider comes near.
   */
  buildSquare: (key: number) => {
    main: THREE.BufferGeometry
    chajjas: THREE.BufferGeometry
    stains: THREE.BufferGeometry
    posters: THREE.BufferGeometry
    /** Extra details only High draws: more AC units and pots. */
    fine: THREE.BufferGeometry
  }
  /** Water tanks, on the roof rooms. */
  tanks: Prop[]
  /** The shops along the fronts of shop buildings. */
  shopUnits: ShopUnit[]
  /** Bikes and cars parked under blocks of flats. They're out of reach, inside the building's footprint. */
  stiltParking: StiltVehicle[]
  /** Bougainvillea growing over compound walls. `y` is the top of the wall. */
  creepers: Prop[]
  /** Kolams drawn on the pavement outside gates. */
  kolams: Prop[]
  /** Bushes in a hedge along the inside of front compound walls. */
  hedges: Prop[]
  /** Each compound gate: its middle and width, in metres, so the kerb in front can be lowered for vehicles. */
  gates: Gate[]
  /** Every house's and block of flats' front door, for deliveries (game/doorsteps.ts). */
  doors: Door[]
}

/** `house`: a family house's gate, rather than a block of flats' or a school's. */
export type Gate = { x: number; z: number; width: number; house?: boolean }

/** `model`: for a car, which of the models drawing it offers (StiltParking's `carModels`); left out, the first. */
export type StiltVehicle = { x: number; z: number; rotation: number; variation: number; car: boolean; model?: number; detailed?: boolean }

/** A dark store's front, whose building is left as it is. */
type Skip = { x: number; z: number; rotation: number }

/**
 * Plans the kit for every house in play: where the tanks, shops, parked
 * vehicles, bougainvillea and kolams go. Compound walls are added to the
 * collision world, so it must run before anything that looks for clear ground
 * beside buildings, such as trees, lamps and parked scooters.
 *
 * The shapes themselves aren't built here. The whole of HSR has over 6 million
 * triangles of kit, far too much to keep in memory, so `buildSquare` builds one
 * map square at a time, as the rider comes near.
 */
export function planHouseKit(
  buildings: BuildingFeature[],
  roads: LineFeature[],
  collisions: CollisionWorld,
  skips: Skip[] = [],
): HouseKit {
  const roadIndex = indexRoadPieces(toRoadPieces(roads))
  // A square built later must come out exactly as planned now, so it looks at the world as it
  // is now, before compound walls, trees and lamps are added.
  const lookup = copyCollisionWorld(collisions)
  const idle = new Builder(false)
  const idleStains = new StainBuilder(false)
  const idlePosters = new PosterBuilder(false)
  const plan = dressBuildings(buildings, roads, roadIndex, lookup, skips, () => [idle, idle, idleStains, idlePosters, idle])

  for (const [start, end] of plan.compoundWalls) addWall(collisions, start, end, COMPOUND.thickness + 0.1)

  return {
    squares: [...plan.byChunk.keys()].map((key) => ({ key, ...chunkCentre(key) })),
    buildSquare: (key) => {
      const kit = new Builder()
      const shades = new Builder()
      const stains = new StainBuilder()
      const posters = new PosterBuilder()
      const fine = new Builder()
      dressBuildings(plan.byChunk.get(key) ?? [], roads, roadIndex, lookup, skips, () => [kit, shades, stains, posters, fine])
      return { main: kit.toGeometry(), chajjas: shades.toGeometry(), stains: stains.toGeometry(), posters: posters.toGeometry(), fine: fine.toGeometry() }
    },
    tanks: plan.tanks,
    shopUnits: plan.shopUnits,
    stiltParking: plan.stiltParking,
    creepers: plan.creepers,
    kolams: plan.kolams,
    hedges: plan.hedges,
    gates: plan.gates,
    doors: plan.doors,
  }
}

/**
 * Dresses each building: works out its front, door, balconies, shops and roof,
 * adds their shapes to the builders for its map square, and lists what else it
 * places. It gives the same answer every time for the same building.
 */
function dressBuildings(
  buildings: BuildingFeature[],
  roads: LineFeature[],
  roadIndex: RoadIndex,
  lookup: CollisionWorld,
  skips: Skip[],
  buildersFor: (key: number) => [kit: Builder, shades: Builder, stains: StainBuilder, posters: PosterBuilder, fine: Builder],
) {
  const byChunk = new Map<number, BuildingFeature[]>()
  const tanks: Prop[] = []
  const shopUnits: ShopUnit[] = []
  const stiltParking: StiltVehicle[] = []
  const creepers: Prop[] = []
  const kolams: Prop[] = []
  const hedges: Prop[] = []
  const gates: Gate[] = []
  const doors: Door[] = []
  // Compound walls go into the collision world only after every house is built, so one
  // house's wall can't make its neighbour think its own walls are hidden.
  const compoundWalls: [GroundPoint, GroundPoint][] = []

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    const isShop = building.kind === 'shop'
    const isApartment = building.kind === 'apartment'
    const civicUse = building.kind === 'civic' ? building.civicUse : undefined
    if ((building.kind !== 'house' && !isShop && !isApartment && !civicUse) || !isRingInPlayArea(ring)) continue

    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    if (
      isShop &&
      skips.some((skip) =>
        isInsideOutline(outline, skip.x - Math.sin(skip.rotation) * 0.5, skip.z - Math.cos(skip.rotation) * 0.5),
      )
    ) {
      continue
    }
    const walls = toWalls(outline, lookup)
    if (walls.length === 0) continue

    const hash = hashString(building.id)
    const paint = new THREE.Color(getKitColor(building))
    const shade = paint.clone().multiplyScalar(0.92)
    const floors = Math.max(1, Math.floor(getFloors(building)))
    const roof = floors * FLOOR_HEIGHT
    const style = chooseStyle(building.id, outline, floors, isShop, isApartment)
    const centreX = outline.reduce((sum, [x]) => sum + x, 0) / outline.length
    const centreZ = outline.reduce((sum, [, z]) => sum + z, 0) / outline.length
    const key = chunkKey(centreX, centreZ)
    const [kit, shades, stains, posters, fine] = buildersFor(key)
    const inSquare = byChunk.get(key)
    if (inSquare) inSquare.push(building)
    else byChunk.set(key, [building])


    // The front is the seen wall nearest a road, facing it. If none faces a road, the longest seen wall.
    let front: Wall | null = null
    let frontGap = Infinity
    for (const wall of walls) {
      if (!wall.exposed) continue
      const gap = distanceToRoad(wall, roadIndex)
      if (gap < frontGap || (gap === frontGap && wall.length > (front?.length ?? 0))) {
        front = wall
        frontGap = gap
      }
    }
    front ??= walls.reduce((longest, wall) => (wall.length > longest.length ? wall : longest))
    // A school or hospital gets its own front, and nothing of a house's.
    if (civicUse) {
      compoundWalls.push(...dressCivic(kit, walls, front, frontGap, roof, civicUse, gates))
      continue
    }

    // How the street it faces dresses its houses (streetPresets.ts): more washing and creepers on a quiet residential street.
    const facing = nearestRoadPiece(roadIndex, front.start[0] + front.alongX * front.length / 2 + front.outX, front.start[1] + front.alongZ * front.length / 2 + front.outZ, ROAD_SEARCH)
    const streetLook = (facing && streetPresetOf(roads[facing.piece.road])?.houses) ?? { washing: WASHING_CHANCE, creeper: CREEPER.chance }

    // ---- The front: door, balconies ----
    const frontWindows = windowCentres(front)
    const middle = front.length / 2
    const balconyCentre = frontWindows.length
      ? frontWindows.reduce((best, along) => (Math.abs(along - middle) < Math.abs(best - middle) ? along : best))
      : middle
    const balconyWidth = Math.min(BALCONY.maxWidth, Math.max(BALCONY.minWidth, front.length * 0.55))
    const balconyFrom = Math.max(0.15, balconyCentre - balconyWidth / 2)
    const balconyTo = Math.min(front.length - 0.15, balconyCentre + balconyWidth / 2)
    // A shop's first floor is above its signboards, so its balconies start a floor higher.
    const firstBalcony = isShop ? 2 : 1
    const hasBalconies = floors > firstBalcony && balconyTo - balconyFrom >= BALCONY.minWidth * 0.8

    // The door goes in a window bay towards one end, so it isn't hidden under the balconies.
    // A block of flats has its gate in the middle, wide enough for cars to drive in under the stilts.
    const doorAlong = isApartment
      ? front.length / 2
      : (frontWindows.find((along) => along < balconyFrom || along > balconyTo) ??
        (balconyFrom > DOOR.width + 0.4 ? balconyFrom / 2 : front.length * 0.25))
    // Where a delivery comes to: just outside the front door (a block of flats' is the middle of its front).
    const door: Door | null =
      !isShop && front.exposed
        ? {
            x: front.start[0] + front.alongX * doorAlong + front.outX * 0.6,
            z: front.start[1] + front.alongZ * doorAlong + front.outZ * 0.6,
            outX: front.outX,
            outZ: front.outZ,
            floors,
            apartment: isApartment,
            gate: null,
            area: rectangularity(outline).area,
          }
        : null
    if (door) doors.push(door)
    if (!isShop && !isApartment) {
      box(kit, front, [doorAlong - DOOR.width / 2 - DOOR.frame, doorAlong + DOOR.width / 2 + DOOR.frame], [0, 0.03], [0, DOOR.height + DOOR.frame], DOOR_FRAME_COLOR)
      box(kit, front, [doorAlong - DOOR.width / 2, doorAlong + DOOR.width / 2], [0.03, 0.06], [0, DOOR.height], DOOR_COLOR)
    }

    // ---- Shop units along the front, with a pier between each two ----
    if (isShop && front.exposed && frontGap < Infinity) {
      let count = Math.max(1, Math.round((front.length - SHOP.pier) / (SHOP.unit + SHOP.pier)))
      const widthFor = (units: number) => (front.length - (units + 1) * SHOP.pier) / units
      while (count > 1 && widthFor(count) < SHOP.minUnit) count--
      const width = widthFor(count)
      if (width >= SHOP.minUnit * 0.8) {
        const rotation = Math.atan2(front.outX, front.outZ)
        for (let unit = 0; unit <= count; unit++) {
          const at = unit * (width + SHOP.pier)
          box(kit, front, [at, at + SHOP.pier], [0, SHOP.pierDepth], [0, SHOP.pierHeight], shade, true)
          if (unit === count) break

          const centre = at + SHOP.pier + width / 2
          const seed = hashString(`${building.id}/${unit}`)
          const x = front.start[0] + front.alongX * centre
          const z = front.start[1] + front.alongZ * centre
          let menuBoard: GroundPoint | undefined
          if (frontGap >= MENU_BOARD.minGap && (seed >>> 5) % 100 < MENU_BOARD.chance) {
            const side = width * 0.3 * ((seed >>> 12) % 2 ? 1 : -1)
            menuBoard = [x + front.alongX * side + front.outX * MENU_BOARD.out, z + front.alongZ * side + front.outZ * MENU_BOARD.out]
          }
          shopUnits.push({ x, z, rotation, width, seed, menuBoard })
        }
      }
    }

    if (isApartment) {
      buildApartment(kit, shades, stains, { walls, front, floors, paint, shade, hash, outline, stilts: hasStilts(building), stiltParking, washing: streetLook.washing })
    }

    if (hasBalconies && !isApartment) {
      for (let floor = 1; floor < floors; floor++) {
        if (floor < firstBalcony) continue
        const level = floor * FLOOR_HEIGHT
        const span: [number, number] = [balconyFrom, balconyTo]
        box(kit, front, span, [0, BALCONY.depth], [level - BALCONY.slab, level], shade)
        stains.onWall(front, span, [level - BALCONY.slab - 1.1, level - BALCONY.slab], [0.6, 0])
        if (style.grille) {
          // A low kerb, posts at the ends, and metal bars (the bars only from Medium up).
          box(kit, front, span, [BALCONY.depth - BALCONY.wall, BALCONY.depth], [level, level + GRILLE.kerb], paint)
          for (const end of [balconyFrom, balconyTo - 0.06]) box(kit, front, [end, end + 0.06], [BALCONY.depth - 0.08, BALCONY.depth], [level, level + BALCONY.parapet], RAIL_COLOR)
          for (let along = balconyFrom + GRILLE.spacing; along < balconyTo - GRILLE.spacing / 2; along += GRILLE.spacing) {
            box(shades, front, [along, along + GRILLE.bar], [BALCONY.depth - 0.06, BALCONY.depth - 0.03], [level + GRILLE.kerb, level + BALCONY.parapet], RAIL_COLOR)
          }
        } else {
          box(kit, front, span, [BALCONY.depth - BALCONY.wall, BALCONY.depth], [level, level + BALCONY.parapet], paint)
          box(kit, front, [balconyFrom, balconyFrom + BALCONY.wall], [0, BALCONY.depth - BALCONY.wall], [level, level + BALCONY.parapet], paint)
          box(kit, front, [balconyTo - BALCONY.wall, balconyTo], [0, BALCONY.depth - BALCONY.wall], [level, level + BALCONY.parapet], paint)
        }
        // The metal rail along the top of the parapet.
        const railTop = level + BALCONY.parapet
        box(kit, front, span, [BALCONY.depth - 0.12, BALCONY.depth + 0.02], [railTop, railTop + 0.05], RAIL_COLOR)

        // Potted plants along the parapet on some balconies (Medium and High).
        if ((hash >>> (floor * 2 + 4)) % 100 < BALCONY_POT_CHANCE) {
          const pots = 2 + ((hash >>> (floor + 13)) % 3)
          for (let pot = 0; pot < pots; pot++) {
            const along = balconyFrom + 0.35 + ((pot + 0.5) / pots) * (balconyTo - balconyFrom - 0.7)
            const middle = BALCONY.depth - 0.25
            box(shades, front, [along - 0.12, along + 0.12], [middle - 0.12, middle + 0.12], [level, level + 0.22], POT_COLOR, true)
            box(shades, front, [along - 0.18, along + 0.18], [middle - 0.17, middle + 0.17], [level + 0.22, level + 0.55], PLANT_COLOR, true)
          }
        }

        // Washing hung over the rail on some balconies: two to four pieces in bright colours.
        if ((hash >>> (floor * 3)) % 100 < streetLook.washing) {
          const pieces = 2 + ((hash >>> (floor + 9)) % 3)
          for (let piece = 0; piece < pieces; piece++) {
            const along = balconyFrom + 0.3 + ((piece + 0.5) / pieces) * (balconyTo - balconyFrom - 0.6)
            const colour = WASHING_COLORS[(hash >>> (piece * 4 + floor)) % WASHING_COLORS.length]
            const drop = 0.55 + ((hash >>> (piece + floor * 5)) % 4) * 0.1
            box(kit, front, [along - 0.25, along + 0.25], [BALCONY.depth + 0.02, BALCONY.depth + 0.04], [railTop - drop, railTop + 0.02], colour, true)
          }
        }
      }
    }

    // ---- Chajjas over the windows ----
    for (const wall of walls) {
      if (!wall.exposed || isApartment) continue
      for (const along of windowCentres(wall)) {
        // A shop's ground floor is shop fronts, with no windows to shade.
        for (let floor = isShop ? 1 : 0; floor < floors; floor++) {
          // Balcony slabs already shade the windows under and beside them.
          const underBalcony =
            wall === front && hasBalconies && along > balconyFrom && along < balconyTo && floor < floors - 1
          if (underBalcony) continue
          const top = floor * FLOOR_HEIGHT + WINDOW_TOP + CHAJJA.gap
          box(shades, wall, [along - CHAJJA.width / 2, along + CHAJJA.width / 2], [0, CHAJJA.depth], [top, top + CHAJJA.thickness], shade)
          stains.onWall(wall, [along - CHAJJA.width / 2, along + CHAJJA.width / 2], [top - 0.5, top], [0.45, 0])

          // Now and then an AC unit under the sill, with water stains run down from it.
          const roll = (hash >>> ((Math.round(along * 7) + floor * 5) % 24)) % 100
          if (floor >= 1 && roll < AC_CHANCE_HIGH) {
            // The commonest show from Medium up; the rest only on High.
            const layer = roll < AC_CHANCE ? shades : fine
            const low = floor * FLOOR_HEIGHT + AC_UNIT.low
            const half = AC_UNIT.width / 2
            box(layer, wall, [along - half, along + half], [0, AC_UNIT.depth], [low, low + AC_UNIT.height], AC_COLOR)
            const g = AC_UNIT.grille / 2
            const middle = low + AC_UNIT.height / 2
            box(layer, wall, [along - g, along + g], [AC_UNIT.depth, AC_UNIT.depth + 0.01], [middle - g, middle + g], GRILLE_COLOR)
            // Streaks only under units every detailed setting shows, so none hangs under nothing.
            if (layer === shades) {
              stains.onWall(wall, [along - 0.06, along + 0.08], [low - 1.5, low], [0.45, 0])
              stains.onWall(wall, [along - half * 0.7, along + half * 0.6], [low - 0.8, low], [0.2, 0])
            }
          }
        }
      }
    }

    // ---- Elevation tiles up one side of the front, and an outside stair up a side wall ----
    if (kit.enabled && style.cladding && front.exposed) addCladding(kit, front, roof, doorAlong, style.cladding, hash)
    // Which end of the front the stair is at (-1 its start, 1 its end), so the compound wall takes it in.
    let stairEnd = 0
    if (style.outerStair) {
      const stair = addOuterStair(kit, shades, walls, front, outline, lookup, paint, shade)
      if (stair) {
        compoundWalls.push(...stair.solid)
        stairEnd = stair.end
      }
    }

    // ---- A Mangalore tile roof, on some older one- and two-storey houses ----
    const tiled = style.tileRoof !== null
    if (style.tileRoof && kit.enabled) addTileRoof(kit, outline, roof, paint, style.tileRoof)

    // ---- The roof: parapet, and the staircase room with the tanks on top ----
    for (const wall of tiled ? [] : walls) {
      box(kit, wall, [-PARAPET.thickness, wall.length + PARAPET.thickness], [-PARAPET.thickness, 0], [roof, roof + PARAPET.height], paint, true)
    }

    // Flats need a bigger room on the roof, for the lift as well as the stairs.
    const room = isApartment ? APARTMENT.room : HEADROOM
    // The staircase room sits towards the back of the roof, square to the front wall.
    const roomFits = (x: number, z: number) =>
      [-1, 1].every((sideA) =>
        [-1, 1].every((sideB) =>
          isInsideOutline(
            outline,
            x + front.alongX * sideA * (room.width / 2 + 0.3) + front.outX * sideB * (room.depth / 2 + 0.3),
            z + front.alongZ * sideA * (room.width / 2 + 0.3) + front.outZ * sideB * (room.depth / 2 + 0.3),
          ),
        ),
      )
    let roomAt: GroundPoint | null = null
    for (let back = 3; back >= 0 && !roomAt && !tiled; back -= 0.5) {
      for (const sideways of [0, -1.5, 1.5, -3, 3]) {
        const x = centreX - front.outX * back + front.alongX * sideways
        const z = centreZ - front.outZ * back + front.alongZ * sideways
        if (roomFits(x, z)) {
          roomAt = [x, z]
          break
        }
      }
    }

    if (roomAt) {
      // A wall-like frame for the room, centred on it, facing the same way as the front.
      const roomWall: Wall = {
        start: [
          roomAt[0] - front.alongX * (room.width / 2) - front.outX * (room.depth / 2),
          roomAt[1] - front.alongZ * (room.width / 2) - front.outZ * (room.depth / 2),
        ],
        length: room.width,
        alongX: front.alongX,
        alongZ: front.alongZ,
        outX: front.outX,
        outZ: front.outZ,
        exposed: true,
      }
      const top = roof + room.height
      box(kit, roomWall, [0, room.width], [0, room.depth], [roof, top], paint, true)
      box(kit, roomWall, [-HEADROOM.overhang, room.width + HEADROOM.overhang], [-HEADROOM.overhang, room.depth + HEADROOM.overhang], [top, top + HEADROOM.slab], shade, true)
      // The door, on the side facing the front of the house.
      box(kit, roomWall, [room.width / 2 - 0.45, room.width / 2 + 0.45], [room.depth, room.depth + 0.03], [roof, roof + 2], HEADROOM_DOOR_COLOR)

      // One or two black tanks on top, as on most Bengaluru homes.
      const tankY = top + HEADROOM.slab
      const variation = ((hash >>> 16) % 1000) / 1000
      const rotation = Math.atan2(front.outX, front.outZ)
      // A block of flats needs more water: three tanks in a row.
      const sides = isApartment ? [-1.1, 0, 1.1] : hash % 3 === 0 ? [-0.75, 0.75] : [0]
      for (const offset of sides) {
        tanks.push({
          x: roomAt[0] + front.alongX * offset,
          y: tankY,
          z: roomAt[1] + front.alongZ * offset,
          rotation,
          variation,
        })
      }
    }

    // A sheet-metal shed on some terraces, clear of the staircase room.
    if (kit.enabled && !tiled && style.shed) addRoofShed(kit, outline, front, roof, roomAt, room, style.shed)

    // ---- The compound wall and gate, between the house and the pavement ----
    const yard = Math.min(MAX_YARD, frontGap - COMPOUND.pavement)
    if (!isShop && yard >= MIN_YARD && front.exposed) {
      const out: [number, number] = [yard, yard + COMPOUND.thickness]
      const wallStart = -0.4 - (stairEnd === -1 ? OUTER_STAIR.width + 0.1 : 0)
      const wallEnd = front.length + 0.4 + (stairEnd === 1 ? OUTER_STAIR.width + 0.1 : 0)
      const gate = isApartment ? APARTMENT.gate : COMPOUND.gate
      const gateFrom = Math.max(wallStart + COMPOUND.pillar, doorAlong - gate / 2)
      const gateTo = Math.min(wallEnd - COMPOUND.pillar, gateFrom + gate)
      const wallColour = paint.clone().multiplyScalar(0.88)

      // Wall on either side of the gate, and the short walls back to the house at each end.
      for (const [from, to] of [
        [wallStart, gateFrom],
        [gateTo, wallEnd],
      ] as [number, number][]) {
        if (to - from > 0.1) box(kit, front, [from, to], out, [0, COMPOUND.height], wallColour, true)
      }
      for (const end of [wallStart, wallEnd - COMPOUND.thickness]) {
        box(kit, front, [end, end + COMPOUND.thickness], [0, yard], [0, COMPOUND.height], wallColour, true)
      }

      // Pillars either side of the gate, with a pale cap.
      for (const at of [gateFrom - COMPOUND.pillar, gateTo]) {
        const pillar: [number, number] = [at, at + COMPOUND.pillar]
        const pillarOut: [number, number] = [yard - 0.12, yard + COMPOUND.thickness + 0.12]
        box(kit, front, pillar, pillarOut, [0, COMPOUND.pillarHeight], wallColour, true)
        box(kit, front, [at - 0.05, at + COMPOUND.pillar + 0.05], [pillarOut[0] - 0.05, pillarOut[1] + 0.05], [COMPOUND.pillarHeight, COMPOUND.pillarHeight + 0.08], PILLAR_CAP_COLOR, true)
      }

      gates.push({
        x: front.start[0] + front.alongX * ((gateFrom + gateTo) / 2) + front.outX * yard,
        z: front.start[1] + front.alongZ * ((gateFrom + gateTo) / 2) + front.outZ * yard,
        width: gateTo - gateFrom,
        house: !isApartment,
      })
      if (door) door.gate = { x: gates[gates.length - 1].x, z: gates[gates.length - 1].z }

      // A poster on the street side of the wall, beside the gate, now and then.
      const wallFace = yard + COMPOUND.thickness + 0.006
      if ((hash >>> 3) % 100 < POSTER_CHANCE && gateFrom - wallStart > 1.2) {
        posters.onWall(front, gateFrom - COMPOUND.pillar - 0.55, wallFace, POSTER.low, (hash >>> 11) % POSTER_COUNT)
      }
      // Potted plants on the wall top either side of the gate: Medium shows most, High all.
      const potRoll = (hash >>> 5) % 100
      if (potRoll < POT_CHANCE) {
        const layer = potRoll < POT_CHANCE * 0.6 ? shades : fine
        const top = COMPOUND.height
        const middle = yard + COMPOUND.thickness / 2
        for (const at of [gateFrom - COMPOUND.pillar - 0.4, gateTo + COMPOUND.pillar + 0.15]) {
          if (at < wallStart + 0.2 || at + 0.25 > wallEnd - 0.2) continue
          box(layer, front, [at, at + 0.25], [middle - 0.12, middle + 0.12], [top, top + 0.2], POT_COLOR, true)
          box(layer, front, [at - 0.05, at + 0.3], [middle - 0.16, middle + 0.16], [top + 0.2, top + 0.48], PLANT_COLOR, true)
        }
      }

      // The gate itself: dark metal, a little shorter than the wall, with a rail across the middle.
      // A block of flats' stands open, its two leaves folded back inside: the delivery is to the
      // building's door behind it, and cars come and go under the stilts. A house's is shut (its bell is at the gate).
      const leaf = Math.min((gateTo - gateFrom) / 2, yard - 0.15)
      if (isApartment) {
        for (const [hinge, sign] of [[gateFrom, 1], [gateTo, -1]] as const) {
          const along: [number, number] = sign > 0 ? [hinge, hinge + 0.05] : [hinge - 0.05, hinge]
          box(kit, front, along, [yard - leaf, yard], [0.08, COMPOUND.height - 0.05], GATE_COLOR, true)
          box(kit, front, [along[0] - 0.02, along[1] + 0.02], [yard - leaf, yard], [0.65, 0.72], RAIL_COLOR, true)
        }
      } else {
        const gateOut: [number, number] = [yard + 0.04, yard + 0.09]
        box(kit, front, [gateFrom, gateTo], gateOut, [0.08, COMPOUND.height - 0.05], GATE_COLOR, true)
        box(kit, front, [gateFrom, gateTo], [gateOut[0] - 0.02, gateOut[1] + 0.02], [0.65, 0.72], RAIL_COLOR, true)
      }

      // Solid to the scooter, and to everything placed after this.
      const at = (along: number, outward: number): GroundPoint => [
        front.start[0] + front.alongX * along + front.outX * outward,
        front.start[1] + front.alongZ * along + front.outZ * outward,
      ]
      const middleOut = yard + COMPOUND.thickness / 2
      if (isApartment) {
        // Open at the gate: the wall either side of it, and the two leaves standing in from it.
        compoundWalls.push([at(wallStart, middleOut), at(gateFrom, middleOut)])
        compoundWalls.push([at(gateTo, middleOut), at(wallEnd, middleOut)])
        compoundWalls.push([at(gateFrom, yard - leaf), at(gateFrom, yard)])
        compoundWalls.push([at(gateTo, yard - leaf), at(gateTo, yard)])
      } else compoundWalls.push([at(wallStart, middleOut), at(wallEnd, middleOut)])
      compoundWalls.push([at(wallStart, 0), at(wallStart, yard)])
      compoundWalls.push([at(wallEnd, 0), at(wallEnd, yard)])

      // The plot's side walls carry on back past the house, so the passage beside it is closed
      // and the bike can't ride round into the plot behind. Only where the line is clear of the
      // house itself, any other building and any road, so a corner plot keeps its open side.
      const behind = Math.min(...outline.map(([x, z]) => (x - front.start[0]) * front.outX + (z - front.start[1]) * front.outZ)) - PLOT_WALL_BEYOND
      for (const end of [wallStart, wallEnd - COMPOUND.thickness]) {
        const middle = end + COMPOUND.thickness / 2
        const steps = Math.max(2, Math.ceil(-behind / 0.75))
        const samples = Array.from({ length: steps + 1 }, (_, i) => at(middle, (behind * i) / steps))
        const clear = samples.every(([x, z]) => !isInsideOutline(outline, x, z) && !isNearBuilding(lookup, x, z, 0.1) && isClearOfRoads(roadIndex, x, z, 0.8))
        if (!clear) continue
        box(kit, front, [end, end + COMPOUND.thickness], [behind, 0], [0, COMPOUND.height], wallColour, true)
        compoundWalls.push([at(middle, 0), at(middle, behind)])
      }

      // Bougainvillea over the longer stretch of wall, on about one house in three.
      const rotation = Math.atan2(front.outX, front.outZ)
      const stretches: [number, number][] = [
        [wallStart, gateFrom - COMPOUND.pillar],
        [gateTo + COMPOUND.pillar, wallEnd],
      ]
      const [from, to] = stretches[0][1] - stretches[0][0] > stretches[1][1] - stretches[1][0] ? stretches[0] : stretches[1]
      if (to - from >= CREEPER.minWall && (hash >>> 9) % 100 < streetLook.creeper) {
        const [x, z] = at((from + to) / 2, middleOut)
        creepers.push({ x, y: COMPOUND.height - 0.05, z, rotation, variation: ((hash >>> 3) % 1000) / 1000 })
      }

      // A hedge along the inside of the front wall, on either side of the gate, on about half the houses.
      if (yard >= MIN_YARD + 0.3 && (hash >>> 15) % 100 < HEDGE_CHANCE) {
        const inside = yard - 0.45
        for (const [from, to] of stretches) {
          const count = Math.floor((to - from - 0.3) / HEDGE_SPACING)
          for (let bush = 0; bush < count; bush++) {
            const [x, z] = at(from + 0.15 + (bush + 0.5) * ((to - from - 0.3) / count), inside)
            hedges.push({ x, z, rotation: rotation + Math.PI / 2, variation: ((hash >>> (bush % 20)) % 1000) / 1000, tint: (hash >>> 7) % 8, size: 0.85 + ((hash >>> (bush % 13)) % 30) / 100 })
          }
        }
      }

      // Pots either side of the front door, in the yard.
      if (!isApartment && (hash >>> 19) % 100 < DOORSTEP_POT_CHANCE) {
        for (const along of [doorAlong - DOOR.width / 2 - 0.4, doorAlong + DOOR.width / 2 + 0.15]) {
          box(shades, front, [along, along + 0.26], [0.2, 0.46], [0, 0.3], POT_COLOR, true)
          box(shades, front, [along - 0.05, along + 0.31], [0.15, 0.51], [0.3, 0.75], PLANT_COLOR, true)
        }
      }

      // A kolam on the pavement outside the gate, as is drawn fresh each morning. It's drawn
      // between the wall and the kerb, so it's as wide as the pavement there allows, and
      // left out where the pavement is too narrow, rather than running under the kerb.
      if (!isApartment && (hash >>> 14) % 100 < KOLAM.chance) {
        const gateMiddle = (gateFrom + gateTo) / 2
        const wallFace = yard + COMPOUND.thickness
        // Measured at its middle and both sides, as the road needn't run square to the wall.
        const room = (side: number) => {
          const [faceX, faceZ] = at(gateMiddle + (side * KOLAM.size) / 2, wallFace)
          return nearestRoadEdge(roadIndex, faceX, faceZ, KOLAM.size * 3)
        }
        const pavement = Math.min(room(-1), room(0), room(1)) - KERB.width - KOLAM.gap * 2
        const size = Math.min(KOLAM.size, pavement)
        if (size >= KOLAM.smallest) {
          const [x, z] = at(gateMiddle, wallFace + KOLAM.gap + size / 2)
          kolams.push({ x, z, rotation, variation: ((hash >>> 6) % 1000) / 1000, width: size })
        }
      }
    }
  }

  return { byChunk, tanks, shopUnits, stiltParking, creepers, kolams, hedges, compoundWalls, gates, doors }
}

type HouseStyle = {
  /** A tile roof's colour, or null for a flat terrace. */
  tileRoof: THREE.Color | null
  /** A terrace shed's colour, or null for none. */
  shed: THREE.Color | null
  grille: boolean
  outerStair: boolean
  /** Elevation tiles: [face colour, joint colour], or null for none. */
  cladding: [THREE.Color, THREE.Color] | null
}

/**
 * The house's pick from the kit, from its id, so it's the same on every visit. A separate hash
 * from the one the rest of the dressing uses, so adding the kit moved nothing that was there.
 */
function chooseStyle(id: string, outline: GroundPoint[], floors: number, isShop: boolean, isApartment: boolean): HouseStyle {
  const roll = (salt: string) => hashString(`${id}/${salt}`)
  const pick = <T,>(list: T[], salt: string) => list[roll(salt) % list.length]
  const house = !isShop && !isApartment
  const tileRoof = house && floors <= TILE_ROOF.maxFloors && roll('roof') % 100 < TILE_ROOF.chance && isSmallBox(outline)
  const [face, joint] = pick(CLADDING_COLORS, 'cladding colour')
  return {
    tileRoof: tileRoof ? pick(TILE_COLORS, 'tile colour') : null,
    shed: !tileRoof && !isApartment && roll('shed') % 100 < SHED.chance ? pick(SHED_COLORS, 'shed colour') : null,
    grille: roll('balcony') % 100 < GRILLE.chance,
    outerStair: house && floors >= OUTER_STAIR.minFloors && roll('stair') % 100 < OUTER_STAIR.chance,
    cladding: house && roll('cladding') % 100 < CLADDING.chance ? [new THREE.Color(face), new THREE.Color(joint)] : null,
  }
}

/** Whether a tile roof suits it: an old house's footprint, small and close to a rectangle. */
function isSmallBox(outline: GroundPoint[]): boolean {
  const { area, share } = rectangularity(outline)
  return area <= TILE_ROOF.maxArea && share >= TILE_ROOF.minRectangular
}

/** The outline's area, and its share of the smallest box round it, square to its longest wall: 1 for a rectangle. */
function rectangularity(outline: GroundPoint[]): { area: number; share: number } {
  const { width, depth } = boxAround(outline, longestEdge(outline))
  let area = 0
  outline.forEach(([x, z], i) => {
    const [nextX, nextZ] = outline[(i + 1) % outline.length]
    area += x * nextZ - nextX * z
  })
  return { area: Math.abs(area) / 2, share: Math.abs(area) / 2 / Math.max(width * depth, 1e-6) }
}

function longestEdge(outline: GroundPoint[]): [number, number] {
  let best: [number, number] = [1, 0]
  let bestLength = 0
  outline.forEach(([x, z], i) => {
    const [nextX, nextZ] = outline[(i + 1) % outline.length]
    const length = Math.hypot(nextX - x, nextZ - z)
    if (length > bestLength) {
      bestLength = length
      best = [(nextX - x) / length, (nextZ - z) / length]
    }
  })
  return best
}

/** The box round an outline, its sides along `[ax, az]` and square to it: a frame and its extents. */
function boxAround(outline: GroundPoint[], [ax, az]: [number, number]) {
  const bx = -az
  const bz = ax
  const as = outline.map(([x, z]) => x * ax + z * az)
  const bs = outline.map(([x, z]) => x * bx + z * bz)
  const [a0, a1, b0, b1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)]
  return { ax, az, bx, bz, a0, a1, b0, b1, width: a1 - a0, depth: b1 - b0 }
}

/**
 * A Mangalore tile roof: two slopes meeting at a ridge along the house's long side, past the walls
 * all round, in courses of two tones so the tiles read, with a ridge cap and plain gable ends.
 * Only on near-rectangular houses, as the box round the outline is what it covers.
 */
function addTileRoof(kit: Builder, outline: GroundPoint[], roof: number, color: THREE.Color, tile: THREE.Color) {
  const frame = boxAround(outline, longestEdge(outline))
  const { ax, az, bx, bz, a0, a1, b0, b1 } = frame
  const slope = Math.tan(TILE_ROOF.pitch)
  const half = (b1 - b0) / 2
  const middle = (b0 + b1) / 2
  const ridge = roof + half * slope
  const over = TILE_ROOF.overhang
  const point = (a: number, b: number, h: number) => new THREE.Vector3(ax * a + bx * b, h, az * a + bz * b)
  const heightAt = (b: number) => ridge - Math.abs(b - middle) * slope
  const dark = tile.clone().multiplyScalar(0.82)
  const under = tile.clone().multiplyScalar(0.45)

  for (const side of [-1, 1]) {
    const normal = new THREE.Vector3(bx * side * Math.sin(TILE_ROOF.pitch), Math.cos(TILE_ROOF.pitch), bz * side * Math.sin(TILE_ROOF.pitch))
    const eave = middle + side * (half + over)
    for (let course = 0; course < TILE_ROOF.courses; course++) {
      const from = middle + ((eave - middle) * course) / TILE_ROOF.courses
      const to = middle + ((eave - middle) * (course + 1)) / TILE_ROOF.courses
      kit.quad([point(a0 - over, from, heightAt(from)), point(a1 + over, from, heightAt(from)), point(a1 + over, to, heightAt(to)), point(a0 - over, to, heightAt(to))], normal, course % 2 ? dark : tile)
    }
    // The underside, seen from the street under the eaves.
    kit.quad([point(a0 - over, middle, ridge - 0.04), point(a1 + over, middle, ridge - 0.04), point(a1 + over, eave, heightAt(eave) - 0.04), point(a0 - over, eave, heightAt(eave) - 0.04)], normal.clone().negate(), under)
  }
  // Gable ends, in the house's paint: a triangle from the walls' top to the ridge.
  for (const [end, sign] of [[a0, -1], [a1, 1]] as const) {
    const normal = new THREE.Vector3(ax * sign, 0, az * sign)
    kit.quad([point(end, b0, roof), point(end, b1, roof), point(end, middle, ridge), point(end, middle, ridge)], normal, color)
  }
  // The ridge cap.
  const capFrame: Wall = { start: [ax * a0 + bx * middle, az * a0 + bz * middle], length: a1 - a0, alongX: ax, alongZ: az, outX: bx, outZ: bz, exposed: true }
  box(kit, capFrame, [-over, a1 - a0 + over], [-TILE_ROOF.ridge, TILE_ROOF.ridge], [ridge - 0.03, ridge + TILE_ROOF.ridge * 0.8], dark)
}

/** A sheet-metal shed on posts on the terrace, wherever it fits clear of the staircase room. */
function addRoofShed(kit: Builder, outline: GroundPoint[], front: Wall, roof: number, roomAt: GroundPoint | null, room: { width: number; depth: number }, color: THREE.Color) {
  const fits = (x: number, z: number) =>
    [-1, 1].every((a) => [-1, 1].every((b) => isInsideOutline(outline, x + front.alongX * a * (SHED.width / 2 + 0.25) + front.outX * b * (SHED.depth / 2 + 0.25), z + front.alongZ * a * (SHED.width / 2 + 0.25) + front.outZ * b * (SHED.depth / 2 + 0.25))))
  const clearOfRoom = (x: number, z: number) => !roomAt || Math.hypot(x - roomAt[0], z - roomAt[1]) > Math.hypot(room.width, room.depth) / 2 + Math.hypot(SHED.width, SHED.depth) / 2 + 0.2
  const xs = outline.map(([x]) => x)
  const zs = outline.map(([, z]) => z)
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2
  const centreZ = (Math.min(...zs) + Math.max(...zs)) / 2
  for (const forward of [2, 1, 0, -1, 3]) {
    for (const sideways of [-3, 3, -1.5, 1.5, 0]) {
      const x = centreX + front.outX * forward + front.alongX * sideways
      const z = centreZ + front.outZ * forward + front.alongZ * sideways
      if (!fits(x, z) || !clearOfRoom(x, z)) continue
      const frame: Wall = { ...front, start: [x - front.alongX * (SHED.width / 2) - front.outX * (SHED.depth / 2), z - front.alongZ * (SHED.width / 2) - front.outZ * (SHED.depth / 2)], length: SHED.width }
      const p = SHED.post
      for (const [a, b, top] of [[0, 0, SHED.low], [SHED.width - p, 0, SHED.low], [0, SHED.depth - p, SHED.high], [SHED.width - p, SHED.depth - p, SHED.high]]) {
        box(kit, frame, [a, a + p], [b, b + p], [roof, roof + top], RAIL_COLOR)
      }
      // The sheet, sloping down towards the front, seen from above and below.
      const at = (a: number, b: number, h: number) => new THREE.Vector3(frame.start[0] + frame.alongX * a + frame.outX * b, roof + h, frame.start[1] + frame.alongZ * a + frame.outZ * b)
      const corners = [at(-0.15, -0.15, SHED.low - 0.03), at(SHED.width + 0.15, -0.15, SHED.low - 0.03), at(SHED.width + 0.15, SHED.depth + 0.15, SHED.high + 0.03), at(-0.15, SHED.depth + 0.15, SHED.high + 0.03)]
      const tilt = Math.atan2(SHED.high - SHED.low, SHED.depth)
      const up = new THREE.Vector3(-front.outX * Math.sin(tilt), Math.cos(tilt), -front.outZ * Math.sin(tilt))
      kit.quad(corners, up, color)
      kit.quad(corners, up.clone().negate(), color.clone().multiplyScalar(0.6))
      return
    }
  }
}

/**
 * An outside stair up a side wall to the first floor, as on houses whose upstairs is let
 * separately: solid steps rising from the front end, a landing, and a stepped parapet on the open
 * side. Only on an open side wall with room for it. Returns the lines to make solid and which end
 * of the front it's at (-1 the start, 1 the end), or null where there's no room.
 */
function addOuterStair(kit: Builder, shades: Builder, walls: Wall[], front: Wall, outline: GroundPoint[], lookup: CollisionWorld, paint: THREE.Color, shade: THREE.Color): { solid: [GroundPoint, GroundPoint][]; end: -1 | 1 } | null {
  const steps = Math.round(FLOOR_HEIGHT / OUTER_STAIR.rise)
  const run = steps * OUTER_STAIR.tread + OUTER_STAIR.landing
  const width = OUTER_STAIR.width
  for (const wall of walls) {
    if (wall === front || !wall.exposed || wall.length < run + 0.6) continue
    // A side wall: square to the front.
    if (Math.abs(wall.alongX * front.alongX + wall.alongZ * front.alongZ) > 0.3) continue
    // Which end of it is at the front: the stair starts there and climbs towards the back.
    const outAt = (along: number) => (wall.start[0] + wall.alongX * along - front.start[0]) * front.outX + (wall.start[1] + wall.alongZ * along - front.start[1]) * front.outZ
    const fromFront = outAt(0) > outAt(wall.length)
    const start = 0.3
    const alongOf = (distance: number) => (fromFront ? distance : wall.length - distance)
    const at = (along: number, out: number): GroundPoint => [wall.start[0] + wall.alongX * along + wall.outX * out, wall.start[1] + wall.alongZ * along + wall.outZ * out]
    // Room beside it: nothing within a metre past the stair, and not into the outline.
    const clear = [0, 0.5, 1].every((share) => {
      const [x, z] = at(alongOf(start + run * share), width + 0.6)
      return !isNearBuilding(lookup, x, z, 0.5) && !isInsideOutline(outline, x, z)
    })
    if (!clear) continue

    const span = (from: number, to: number): [number, number] => {
      const [a, b] = [alongOf(start + from), alongOf(start + to)]
      return [Math.min(a, b), Math.max(a, b)]
    }
    for (let step = 0; step < steps; step++) {
      const top = (step + 1) * OUTER_STAIR.rise
      const tread = span(step * OUTER_STAIR.tread, (step + 1) * OUTER_STAIR.tread)
      box(kit, wall, tread, [0, width], [Math.max(0, top - 0.45), top], shade)
      // The parapet on the open side: from Medium up.
      box(shades, wall, tread, [width - 0.1, width], [top, top + OUTER_STAIR.rail], paint)
    }
    const landing = span(steps * OUTER_STAIR.tread, run)
    box(kit, wall, landing, [0, width], [FLOOR_HEIGHT - 0.15, FLOOR_HEIGHT], shade)
    box(kit, wall, landing, [width - 0.1, width], [FLOOR_HEIGHT, FLOOR_HEIGHT + OUTER_STAIR.rail], paint)
    // A post under the landing, and a door at the top.
    const [postFrom] = landing
    box(kit, wall, [postFrom + 0.1, postFrom + 0.35], [width - 0.3, width - 0.05], [0, FLOOR_HEIGHT - 0.15], shade)
    box(kit, wall, [landing[0] + 0.1, landing[1] - 0.1], [0, 0.03], [FLOOR_HEIGHT, FLOOR_HEIGHT + DOOR.height], DOOR_COLOR)
    const [lowEnd, highEnd] = span(0, run)
    const [middleX, middleZ] = at(wall.length / 2, 0)
    const alongFront = (middleX - front.start[0]) * front.alongX + (middleZ - front.start[1]) * front.alongZ
    return {
      solid: [
        [at(lowEnd, width), at(highEnd, width)],
        [at(fromFront ? lowEnd : highEnd, 0), at(fromFront ? lowEnd : highEnd, width)],
      ],
      end: alongFront < front.length / 2 ? -1 : 1,
    }
  }
  return null
}

/** Elevation tiles: a band of stone or ceramic up one end of the front, in courses, beside the door. */
function addCladding(kit: Builder, front: Wall, roof: number, doorAlong: number, [face, joint]: [THREE.Color, THREE.Color], hash: number) {
  const atEnd = doorAlong < front.length / 2
  // No wider than the plain wall before the first painted window at that end.
  const windows = windowCentres(front)
  const room = windows.length ? (atEnd ? front.length - Math.max(...windows) : Math.min(...windows)) - WINDOW_HALF_WIDTH - 0.15 : front.length / 3
  const width = Math.min(room, CLADDING.minWidth + (((hash >>> 7) % 100) / 100) * (CLADDING.maxWidth - CLADDING.minWidth))
  if (width < CLADDING.minWidth * 0.75) return
  // At whichever end is further from the door.
  const from = atEnd ? front.length - width - 0.05 : 0.05
  if (Math.abs(from + width / 2 - doorAlong) < width / 2 + DOOR.width) return
  for (let low = 0, course = 0; low < roof; low += CLADDING.course, course++) {
    box(kit, front, [from, from + width], [0, 0.04], [low, Math.min(roof, low + CLADDING.course - 0.02)], course % 2 ? joint : face)
  }
}

/** Schools and hospitals: a porch on pillars over the way in, and a parapet round the roof. */
const CIVIC = { porch: 6.5, porchDepth: 2.6, porchHeight: 3.6, slab: 0.25, pillar: 0.4, wall: 1.7, gate: 4.5 }
const CIVIC_PAINT = new THREE.Color('#e9e2d0')
/** A school's compound wall is painted in blocks: yellow, blue and white. */
const SCHOOL_WALL_COLORS = ['#e5c046', '#2f5d9e', '#f1ede2'].map((color) => new THREE.Color(color))
const SCHOOL_BLOCK = 1.4
const CROSS_RED = new THREE.Color('#c8262c')
const SIGN_WHITE = new THREE.Color('#f4f2ec')

/**
 * A school or hospital, told apart from the street: both get a porch on pillars over the way in
 * and a parapet. A school gets a compound wall painted in blocks, with a wide gate; a hospital a
 * red cross on a white board standing on its roof over the porch. Returns lines to make solid.
 */
function dressCivic(kit: Builder, walls: Wall[], front: Wall, frontGap: number, roof: number, use: CivicUse, gates: Gate[]): [GroundPoint, GroundPoint][] {
  const solid: [GroundPoint, GroundPoint][] = []
  const at = (along: number, out: number): GroundPoint => [front.start[0] + front.alongX * along + front.outX * out, front.start[1] + front.alongZ * along + front.outZ * out]
  for (const wall of walls) box(kit, wall, [-PARAPET.thickness, wall.length + PARAPET.thickness], [-PARAPET.thickness, 0], [roof, roof + PARAPET.height], CIVIC_PAINT, true)

  const middle = front.length / 2
  // The porch, if the pavement leaves room in front.
  const depth = Math.min(CIVIC.porchDepth, frontGap - 1.6)
  const width = Math.min(CIVIC.porch, front.length - 1)
  if (front.exposed && depth >= 1.6 && width >= 3) {
    const span: [number, number] = [middle - width / 2, middle + width / 2]
    box(kit, front, span, [0, depth], [CIVIC.porchHeight, CIVIC.porchHeight + CIVIC.slab], CIVIC_PAINT, true)
    for (const along of [span[0] + 0.1, span[1] - 0.1 - CIVIC.pillar]) {
      box(kit, front, [along, along + CIVIC.pillar], [depth - CIVIC.pillar - 0.1, depth - 0.1], [0, CIVIC.porchHeight], CIVIC_PAINT)
      solid.push([at(along + CIVIC.pillar / 2, depth - CIVIC.pillar), at(along + CIVIC.pillar / 2, depth - 0.15)])
    }
  }

  if (use === 'hospital' && front.exposed) {
    // The red cross, standing on the roof's front edge over the porch.
    const size = 1.9
    const low = roof + PARAPET.height
    box(kit, front, [middle - size / 2, middle + size / 2], [-0.35, -0.15], [low, low + size], SIGN_WHITE, true)
    const arm = size * 0.62
    const thick = size * 0.2
    const centre = low + size / 2
    box(kit, front, [middle - arm / 2, middle + arm / 2], [-0.15, -0.12], [centre - thick / 2, centre + thick / 2], CROSS_RED)
    box(kit, front, [middle - thick / 2, middle + thick / 2], [-0.15, -0.12], [centre - arm / 2, centre + arm / 2], CROSS_RED)
  }

  const yard = Math.min(MAX_YARD + 2, frontGap - COMPOUND.pavement)
  if (use === 'school' && front.exposed && yard >= MIN_YARD + 1) {
    // The compound wall, in painted blocks, with a wide gate in the middle.
    const out: [number, number] = [yard, yard + COMPOUND.thickness]
    const [from, to] = [-0.4, front.length + 0.4]
    const gateFrom = middle - CIVIC.gate / 2
    const gateTo = middle + CIVIC.gate / 2
    for (const [start, end] of [[from, gateFrom], [gateTo, to]] as [number, number][]) {
      for (let along = start, block = 0; along < end - 0.05; along += SCHOOL_BLOCK, block++) {
        box(kit, front, [along, Math.min(end, along + SCHOOL_BLOCK)], out, [0, CIVIC.wall], SCHOOL_WALL_COLORS[block % SCHOOL_WALL_COLORS.length], true)
      }
      solid.push([at(start, yard + COMPOUND.thickness / 2), at(end, yard + COMPOUND.thickness / 2)])
    }
    for (const end of [from, to - COMPOUND.thickness]) {
      box(kit, front, [end, end + COMPOUND.thickness], [0, yard], [0, CIVIC.wall], SCHOOL_WALL_COLORS[2], true)
      solid.push([at(end + COMPOUND.thickness / 2, 0), at(end + COMPOUND.thickness / 2, yard)])
    }
    for (const pillar of [gateFrom - COMPOUND.pillar, gateTo]) {
      box(kit, front, [pillar, pillar + COMPOUND.pillar], [yard - 0.12, yard + COMPOUND.thickness + 0.12], [0, CIVIC.wall + 0.3], SCHOOL_WALL_COLORS[2], true)
    }
    // The gate stands open: two leaves folded back against the wall inside.
    for (const [hinge, sign] of [[gateFrom, 1], [gateTo, -1]] as const) {
      box(kit, front, sign > 0 ? [hinge, hinge + 0.06] : [hinge - 0.06, hinge], [yard - CIVIC.gate / 2, yard], [0.08, CIVIC.wall - 0.1], GATE_COLOR, true)
    }
    const [x, z] = at(middle, yard)
    gates.push({ x, z, width: CIVIC.gate })
  }
  return solid
}

/** A square post standing at a point, its sides square to `facing`. */
function post(builder: Builder, facing: Wall, x: number, z: number, size: number, [low, high]: [number, number], color: THREE.Color) {
  const frame: Wall = { ...facing, start: [x, z], length: size }
  box(builder, frame, [-size / 2, size / 2], [-size / 2, size / 2], [low, high], color, true)
}

type ApartmentParts = {
  walls: Wall[]
  front: Wall
  floors: number
  paint: THREE.Color
  shade: THREE.Color
  hash: number
  outline: GroundPoint[]
  stilts: boolean
  stiltParking: StiltVehicle[]
  /** How often washing hangs over the balconies, in percent, from the street's preset. */
  washing: number
}

/**
 * The parts only a block of flats has: a balcony on every bay of the front,
 * sunshades over the doors on its other walls, and, on stilts, the open
 * parking floor with its pillars, the stair and lift core, and bikes and cars.
 */
function buildApartment(kit: Builder, shades: Builder, stains: StainBuilder, parts: ApartmentParts) {
  const { walls, front, floors, paint, shade, hash, outline, stilts, stiltParking } = parts

  // ---- Balconies, one per bay, on every floor of the front ----
  const centres = windowCentres(front, APARTMENT.bay, APARTMENT.balconyHalfWidth)
  centres.forEach((along, bay) => {
    for (let floor = 1; floor < floors; floor++) {
      const level = floor * FLOOR_HEIGHT
      const from = along - APARTMENT.balconyHalfWidth
      const to = along + APARTMENT.balconyHalfWidth
      const depth = APARTMENT.balconyDepth
      box(kit, front, [from, to], [0, depth], [level - BALCONY.slab, level], shade)
      // Shade on the wall under the slab. On stilts, the first floor's has no wall under it.
      if (!(stilts && floor === 1)) stains.onWall(front, [from, to], [level - BALCONY.slab - 1.1, level - BALCONY.slab], [0.6, 0])
      box(kit, front, [from, to], [depth - BALCONY.wall, depth], [level, level + BALCONY.parapet], paint)
      box(kit, front, [from, from + BALCONY.wall], [0, depth - BALCONY.wall], [level, level + BALCONY.parapet], paint)
      box(kit, front, [to - BALCONY.wall, to], [0, depth - BALCONY.wall], [level, level + BALCONY.parapet], paint)
      const railTop = level + BALCONY.parapet
      box(kit, front, [from, to], [depth - 0.12, depth + 0.02], [railTop, railTop + 0.05], RAIL_COLOR)

      // A potted plant on the parapet, or washing over it.
      const roll = (hash >>> ((bay * 5 + floor * 3) % 24)) % 100
      if (roll < APARTMENT.plantChance) {
        const at = from + 0.35 + (roll % 4) * 0.5
        box(kit, front, [at, at + 0.3], [depth - 0.4, depth - 0.12], [railTop, railTop + 0.22], POT_COLOR, true)
        box(kit, front, [at - 0.05, at + 0.35], [depth - 0.45, depth - 0.07], [railTop + 0.22, railTop + 0.5], PLANT_COLOR, true)
      } else if (roll > 100 - parts.washing) {
        const colour = WASHING_COLORS[roll % WASHING_COLORS.length]
        box(kit, front, [along - 0.3, along + 0.3], [depth + 0.02, depth + 0.04], [railTop - 0.7, railTop + 0.02], colour, true)
      }
    }
  })

  // ---- Sunshades over the doors on the other walls ----
  for (const wall of walls) {
    if (!wall.exposed || wall === front) continue
    for (const along of windowCentres(wall, APARTMENT.bay, APARTMENT.doorHalfWidth)) {
      for (let floor = 1; floor < floors; floor++) {
        const top = floor * FLOOR_HEIGHT + APARTMENT.doorTop + CHAJJA.gap
        box(shades, wall, [along - APARTMENT.chajjaWidth / 2, along + APARTMENT.chajjaWidth / 2], [0, CHAJJA.depth], [top, top + CHAJJA.thickness], shade)
        stains.onWall(wall, [along - APARTMENT.chajjaWidth / 2, along + APARTMENT.chajjaWidth / 2], [top - 0.55, top], [0.45, 0])
      }
    }
  }

  if (!stilts) return

  // ---- The stilt floor: a concrete slab, and pillars round the edge and through the middle ----
  kit.floor(outline, STILT_FLOOR.height, STILT_FLOOR.color)
  const pillarColor = shade.clone().multiplyScalar(0.95)
  const height: [number, number] = [0, FLOOR_HEIGHT]
  const frontPillars: number[] = []
  for (const wall of walls) {
    const count = Math.max(1, Math.ceil(wall.length / APARTMENT.pillarSpacing))
    for (let index = 0; index < count; index++) {
      const along = Math.min((index * wall.length) / count, wall.length - APARTMENT.pillar)
      box(kit, wall, [along, along + APARTMENT.pillar], [-APARTMENT.pillar, 0], height, pillarColor)
      if (wall === front) frontPillars.push(along + APARTMENT.pillar / 2)
    }
    if (wall === front) frontPillars.push(wall.length - APARTMENT.pillar / 2)
  }

  const inside = (x: number, z: number, margin: number) =>
    isInsideOutline(outline, x + margin, z) &&
    isInsideOutline(outline, x - margin, z) &&
    isInsideOutline(outline, x, z + margin) &&
    isInsideOutline(outline, x, z - margin)

  // A grid square to the front wall, starting from its first corner.
  const reach = 80
  for (let across = APARTMENT.gridSpacing; across < reach; across += APARTMENT.gridSpacing) {
    for (let along = APARTMENT.gridSpacing; along < front.length + reach; along += APARTMENT.gridSpacing) {
      const x = front.start[0] + front.alongX * (along - reach / 2) - front.outX * across
      const z = front.start[1] + front.alongZ * (along - reach / 2) - front.outZ * across
      if (inside(x, z, 1.5)) post(kit, front, x, z, APARTMENT.pillar, height, pillarColor)
    }
  }

  // The core: stairs and lift in a solid block at the back, with a grey door.
  const centreX = outline.reduce((sum, [x]) => sum + x, 0) / outline.length
  const centreZ = outline.reduce((sum, [, z]) => sum + z, 0) / outline.length
  for (let back = 4; back >= 0; back -= 1) {
    const x = centreX - front.outX * back
    const z = centreZ - front.outZ * back
    if (!inside(x, z, APARTMENT.core.depth / 2 + 0.3)) continue
    const core: Wall = {
      ...front,
      start: [
        x - front.alongX * (APARTMENT.core.width / 2) - front.outX * (APARTMENT.core.depth / 2),
        z - front.alongZ * (APARTMENT.core.width / 2) - front.outZ * (APARTMENT.core.depth / 2),
      ],
      length: APARTMENT.core.width,
    }
    box(kit, core, [0, APARTMENT.core.width], [0, APARTMENT.core.depth], height, paint, true)
    box(kit, core, [APARTMENT.core.width / 2 - 0.5, APARTMENT.core.width / 2 + 0.5], [APARTMENT.core.depth, APARTMENT.core.depth + 0.03], [0, 2.1], CORE_DOOR_COLOR)
    break
  }

  // ---- Parking: a car in some gaps between the front pillars, bikes in the rest ----
  const facingOut = Math.atan2(front.outX, front.outZ)
  const at = (along: number, depth: number): GroundPoint => [
    front.start[0] + front.alongX * along - front.outX * depth,
    front.start[1] + front.alongZ * along - front.outZ * depth,
  ]
  frontPillars.sort((a, b) => a - b)
  for (let gap = 0; gap < frontPillars.length - 1; gap++) {
    const from = frontPillars[gap] + APARTMENT.pillar / 2
    const to = frontPillars[gap + 1] - APARTMENT.pillar / 2
    const width = to - from
    if (width < 1) continue
    const roll = hashString(`${hash}/${gap}`)
    const middle = (from + to) / 2

    const [carX, carZ] = at(middle, STILT_CAR.in)
    const [carBackX, carBackZ] = at(middle, STILT_CAR.in + STILT_CAR.halfLength)
    if (width >= STILT_CAR.minGap && roll % 100 < STILT_CAR.chance && inside(carX, carZ, 1) && inside(carBackX, carBackZ, 0.3)) {
      // Cars go in nose first.
      stiltParking.push({ x: carX, z: carZ, rotation: facingOut + Math.PI, variation: ((roll >>> 8) % 1000) / 1000, car: true })
      continue
    }

    const bikes = Math.floor(width / STILT_BIKE.gap)
    for (let bike = 0; bike < bikes; bike++) {
      if ((roll >>> (bike * 3)) % 4 === 0) continue
      const along = from + (bike + 0.5) * (width / bikes)
      const [x, z] = at(along, STILT_BIKE.in)
      if (!inside(x, z, 0.5)) continue
      // Bikes are backed in, ready to ride out, or parked nose first, as people do.
      const turn = (roll >>> (bike + 11)) % 3 === 0 ? Math.PI : 0
      stiltParking.push({ x, z, rotation: facingOut + turn, variation: ((roll >>> (bike * 2 + 5)) % 1000) / 1000, car: false })
    }
  }
}
