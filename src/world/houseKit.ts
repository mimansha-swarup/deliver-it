import * as THREE from 'three'
import { FLOOR_HEIGHT, getFloors, getKitColor, hashString, hasStilts } from './buildingData'
import { addWall, copyCollisionWorld, isNearBuilding, type CollisionWorld } from './collision'
import { chunkCentre, chunkKey } from './chunks'
import { FACADE_LOOKS } from './facadeTextures'
import type { BuildingFeature, LineFeature } from './mapData'
import { indexRoadPieces, isClearOfRoads, toRoadPieces, type Prop, type RoadIndex } from './props'
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
const STILT_FLOOR = { height: 0.06, color: new THREE.Color('#8f8d88') }
const PLANT_COLOR = new THREE.Color('#3f7d3a')
const POT_COLOR = new THREE.Color('#a4552f')
const CORE_DOOR_COLOR = new THREE.Color('#6b6e72')

const COMPOUND = { height: 1.4, thickness: 0.15, gate: 3.0, pillar: 0.38, pillarHeight: 1.7, pavement: 1.6 }
/** Too little room between house and pavement for a compound wall, and the most it ever stands out. */
/** Bougainvillea needs this much wall, in metres, and grows on this share of houses, in percent. */
const CREEPER = { minWall: 3.2, chance: 34 }
/** How far out from the wall a kolam's middle is, and the share of houses with one. */
const KOLAM = { out: 0.95, chance: 45 }
const MIN_YARD = 1.2
const MAX_YARD = 4
/** Walls shorter than this get nothing. */
const MIN_EDGE = 2
/** A wall with another building this close in front of it is out of sight. */
const HIDDEN_CHECK = { distance: 2.5, radius: 1.5 }
/** How far out from a wall to look for a road, in metres. */
const ROAD_SEARCH = 22
const WASHING_CHANCE = 35

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
    const order = facing >= 0 ? [a, b, c, a, c, d] : [a, d, c, a, c, b]
    for (const point of order) {
      this.positions.push(point.x, point.y, point.z)
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
    geometry.setAttribute('normal', new THREE.BufferAttribute(Int8Array.from(this.normals, (value) => Math.round(value * 127)), 3, true))
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(Uint8Array.from(this.colors, (value) => Math.round(Math.min(1, Math.max(0, value)) * 255)), 3, true),
    )
    geometry.computeBoundingSphere()
    return geometry
  }
}

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

const corner = new THREE.Vector3()

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
  const point = (along: number, out: number, height: number) =>
    corner
      .set(
        wall.start[0] + wall.alongX * along + wall.outX * out,
        height,
        wall.start[1] + wall.alongZ * along + wall.outZ * out,
      )
      .clone()
  const outward = new THREE.Vector3(wall.outX, 0, wall.outZ)
  const sideways = new THREE.Vector3(wall.alongX, 0, wall.alongZ)
  const up = new THREE.Vector3(0, 1, 0)

  // Corners named by (along, out, height): 0 is the low end, 1 the high end.
  const p = (a: 0 | 1, o: 0 | 1, h: 0 | 1) =>
    point(a ? alongTo : alongFrom, o ? outTo : outFrom, h ? high : low)

  builder.quad([p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1)], outward, color)
  builder.quad([p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)], sideways, color)
  builder.quad([p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)], sideways.clone().negate(), color)
  builder.quad([p(0, 0, 1), p(0, 1, 1), p(1, 1, 1), p(1, 0, 1)], up, color)
  builder.quad([p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0)], up.clone().negate(), color)
  if (back) builder.quad([p(1, 0, 0), p(0, 0, 0), p(0, 0, 1), p(1, 0, 1)], outward.clone().negate(), color)
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
  buildSquare: (key: number) => { main: THREE.BufferGeometry; chajjas: THREE.BufferGeometry }
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
}

export type StiltVehicle = { x: number; z: number; rotation: number; variation: number; car: boolean }

/** The dark store's front, whose building is left as it is. */
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
  skip?: Skip,
): HouseKit {
  const roadIndex = indexRoadPieces(toRoadPieces(roads))
  // A square built later must come out exactly as planned now, so it looks at the world as it
  // is now, before compound walls, trees and lamps are added.
  const lookup = copyCollisionWorld(collisions)
  const idle = new Builder(false)
  const plan = dressBuildings(buildings, roadIndex, lookup, skip, () => [idle, idle])

  for (const [start, end] of plan.compoundWalls) addWall(collisions, start, end, COMPOUND.thickness + 0.1)

  return {
    squares: [...plan.byChunk.keys()].map((key) => ({ key, ...chunkCentre(key) })),
    buildSquare: (key) => {
      const kit = new Builder()
      const shades = new Builder()
      dressBuildings(plan.byChunk.get(key) ?? [], roadIndex, lookup, skip, () => [kit, shades])
      return { main: kit.toGeometry(), chajjas: shades.toGeometry() }
    },
    tanks: plan.tanks,
    shopUnits: plan.shopUnits,
    stiltParking: plan.stiltParking,
    creepers: plan.creepers,
    kolams: plan.kolams,
  }
}

/**
 * Dresses each building: works out its front, door, balconies, shops and roof,
 * adds their shapes to the builders for its map square, and lists what else it
 * places. It gives the same answer every time for the same building.
 */
function dressBuildings(
  buildings: BuildingFeature[],
  roadIndex: RoadIndex,
  lookup: CollisionWorld,
  skip: Skip | undefined,
  buildersFor: (key: number) => [kit: Builder, shades: Builder],
) {
  const byChunk = new Map<number, BuildingFeature[]>()
  const tanks: Prop[] = []
  const shopUnits: ShopUnit[] = []
  const stiltParking: StiltVehicle[] = []
  const creepers: Prop[] = []
  const kolams: Prop[] = []
  // Compound walls go into the collision world only after every house is built, so one
  // house's wall can't make its neighbour think its own walls are hidden.
  const compoundWalls: [GroundPoint, GroundPoint][] = []

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    const isShop = building.kind === 'shop'
    const isApartment = building.kind === 'apartment'
    if ((building.kind !== 'house' && !isShop && !isApartment) || !isRingInPlayArea(ring)) continue

    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    if (
      isShop &&
      skip &&
      isInsideOutline(outline, skip.x - Math.sin(skip.rotation) * 0.5, skip.z - Math.cos(skip.rotation) * 0.5)
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
    const centreX = outline.reduce((sum, [x]) => sum + x, 0) / outline.length
    const centreZ = outline.reduce((sum, [, z]) => sum + z, 0) / outline.length
    const key = chunkKey(centreX, centreZ)
    const [kit, shades] = buildersFor(key)
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
      buildApartment(kit, shades, { walls, front, floors, paint, shade, hash, outline, stilts: hasStilts(building), stiltParking })
    }

    if (hasBalconies && !isApartment) {
      for (let floor = 1; floor < floors; floor++) {
        if (floor < firstBalcony) continue
        const level = floor * FLOOR_HEIGHT
        const span: [number, number] = [balconyFrom, balconyTo]
        box(kit, front, span, [0, BALCONY.depth], [level - BALCONY.slab, level], shade)
        box(kit, front, span, [BALCONY.depth - BALCONY.wall, BALCONY.depth], [level, level + BALCONY.parapet], paint)
        box(kit, front, [balconyFrom, balconyFrom + BALCONY.wall], [0, BALCONY.depth - BALCONY.wall], [level, level + BALCONY.parapet], paint)
        box(kit, front, [balconyTo - BALCONY.wall, balconyTo], [0, BALCONY.depth - BALCONY.wall], [level, level + BALCONY.parapet], paint)
        // The metal rail along the top of the parapet.
        const railTop = level + BALCONY.parapet
        box(kit, front, span, [BALCONY.depth - 0.12, BALCONY.depth + 0.02], [railTop, railTop + 0.05], RAIL_COLOR)

        // Washing hung over the rail on some balconies: two to four pieces in bright colours.
        if ((hash >>> (floor * 3)) % 100 < WASHING_CHANCE) {
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
        }
      }
    }

    // ---- The roof: parapet, and the staircase room with the tanks on top ----
    for (const wall of walls) {
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
    for (let back = 3; back >= 0 && !roomAt; back -= 0.5) {
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

    // ---- The compound wall and gate, between the house and the pavement ----
    const yard = Math.min(MAX_YARD, frontGap - COMPOUND.pavement)
    if (!isShop && yard >= MIN_YARD && front.exposed) {
      const out: [number, number] = [yard, yard + COMPOUND.thickness]
      const wallStart = -0.4
      const wallEnd = front.length + 0.4
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

      // The gate itself: dark metal, a little shorter than the wall, with a rail across the middle.
      const gateOut: [number, number] = [yard + 0.04, yard + 0.09]
      box(kit, front, [gateFrom, gateTo], gateOut, [0.08, COMPOUND.height - 0.05], GATE_COLOR, true)
      box(kit, front, [gateFrom, gateTo], [gateOut[0] - 0.02, gateOut[1] + 0.02], [0.65, 0.72], RAIL_COLOR, true)

      // Solid to the scooter, and to everything placed after this.
      const at = (along: number, outward: number): GroundPoint => [
        front.start[0] + front.alongX * along + front.outX * outward,
        front.start[1] + front.alongZ * along + front.outZ * outward,
      ]
      const middleOut = yard + COMPOUND.thickness / 2
      compoundWalls.push([at(wallStart, middleOut), at(wallEnd, middleOut)])
      compoundWalls.push([at(wallStart, 0), at(wallStart, yard)])
      compoundWalls.push([at(wallEnd, 0), at(wallEnd, yard)])

      // Bougainvillea over the longer stretch of wall, on about one house in three.
      const rotation = Math.atan2(front.outX, front.outZ)
      const stretches: [number, number][] = [
        [wallStart, gateFrom - COMPOUND.pillar],
        [gateTo + COMPOUND.pillar, wallEnd],
      ]
      const [from, to] = stretches[0][1] - stretches[0][0] > stretches[1][1] - stretches[1][0] ? stretches[0] : stretches[1]
      if (to - from >= CREEPER.minWall && (hash >>> 9) % 100 < CREEPER.chance) {
        const [x, z] = at((from + to) / 2, middleOut)
        creepers.push({ x, y: COMPOUND.height - 0.05, z, rotation, variation: ((hash >>> 3) % 1000) / 1000 })
      }

      // A kolam on the pavement outside the gate, as is drawn fresh each morning.
      if (!isApartment && (hash >>> 14) % 100 < KOLAM.chance) {
        const [x, z] = at((gateFrom + gateTo) / 2, yard + COMPOUND.thickness + KOLAM.out)
        kolams.push({ x, z, rotation, variation: ((hash >>> 6) % 1000) / 1000 })
      }
    }
  }

  return { byChunk, tanks, shopUnits, stiltParking, creepers, kolams, compoundWalls }
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
}

/**
 * The parts only a block of flats has: a balcony on every bay of the front,
 * sunshades over the doors on its other walls, and, on stilts, the open
 * parking floor with its pillars, the stair and lift core, and bikes and cars.
 */
function buildApartment(kit: Builder, shades: Builder, parts: ApartmentParts) {
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
      } else if (roll > 100 - WASHING_CHANCE) {
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
