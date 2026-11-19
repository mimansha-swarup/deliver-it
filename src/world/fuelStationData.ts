import { addPost, addWall, isNearBuilding, type CollisionWorld } from './collision'
import type { StiltVehicle } from './houseKit'
import type { LineFeature, PolygonFeature } from './mapData'
import { indexRoadPieces, isClearOfRoads, toRoadPieces, type RoadIndex, type RoadPiece } from './props'
import { isInsideBounds, lonLatToWorld, type GroundPoint } from './worldUtils'

/**
 * Petrol bunks, at the real spots of HSR's real ones (positions given by the
 * project's owner). Like the shops, each oil company has a made-up name and
 * look, as the game shows no real brand.
 */
export type FuelBrand = {
  name: string
  /** The canopy's band and the price sign. */
  primary: string
  /** Lettering and trim. */
  secondary: string
  lettering: string
}

export const FUEL_BRANDS = {
  surya: { name: 'Surya Fuels', primary: '#f26b1d', secondary: '#13306b', lettering: '#ffffff' },
  kaveri: { name: 'Kaveri Petroleum', primary: '#ffd200', secondary: '#0b4ea2', lettering: '#0b4ea2' },
  hampi: { name: 'Hampi Petro', primary: '#c62828', secondary: '#1a3d8f', lettering: '#ffffff' },
  coral: { name: 'Coral Energy', primary: '#00897b', secondary: '#e0f2f1', lettering: '#ffffff' },
} satisfies Record<string, FuelBrand>

export type FuelBrandId = keyof typeof FUEL_BRANDS
export const FUEL_BRAND_IDS = Object.keys(FUEL_BRANDS) as FuelBrandId[]

/** Where each bunk is. Two more, on Haralur Road, are east of the map's edge, so they aren't here. */
export const FUEL_STATIONS: { brand: FuelBrandId; lat: number; lng: number }[] = [
  { brand: 'surya', lat: 12.9213445, lng: 77.6446954 }, // Ring Road, Agara
  { brand: 'kaveri', lat: 12.9198926, lng: 77.6514319 }, // 27th Main, Sector 1
  { brand: 'hampi', lat: 12.9152994, lng: 77.6383183 }, // MCHS Layout, Sector 4
  { brand: 'coral', lat: 12.9088526, lng: 77.6440919 }, // 23rd Cross, Sector 3
  { brand: 'surya', lat: 12.90729, lng: 77.644684 }, // 19th Main, Sector 2
  { brand: 'kaveri', lat: 12.9207969, lng: 77.6208416 }, // Hosur Road, Madiwala
]

/** A bunk as placed: its canopy's middle and size, and the road it opens onto. */
export type FuelStation = {
  brand: FuelBrandId
  x: number
  z: number
  /** Along the road, and away from it towards the back of the forecourt, as unit vectors. */
  alongX: number
  alongZ: number
  outX: number
  outZ: number
  /** The canopy's size: along the road, and back from it, in metres. */
  length: number
  depth: number
  /** How far the road's edge is in front of the canopy's middle, in metres: the forecourt runs up to it. */
  front: number
  /**
   * How much further the forecourt runs past the canopy's end away from the price sign, in metres:
   * a paved yard with the bunk's office and the air stand, where there's room. 0 where there isn't.
   */
  yard: number
  /** Which end the yard is at: -1 away from the price sign, 1 past it. */
  yardSide: number
}

/** A canopy with no roof on the map, in metres: along the road, and back from it. */
const DEFAULT_CANOPY = { length: 14, depth: 9 }
/** A roof from the map sets the canopy's size, within these limits. */
const CANOPY_LIMITS = { length: [8, 24], depth: [6, 15] }
export const CANOPY = { height: 4.8, thickness: 0.7 }
/** A canopy with no roof on the map starts this far back from the road's edge, behind the pavement. */
const SETBACK = 3.5
/** Pillars stand this far in from the canopy's corners. */
export const PILLAR_INSET = 1.2
export const PILLAR_RADIUS = 0.22
/** The pump islands, each this long and wide. */
export const ISLAND = { length: 3.6, width: 0.9 }
/** The tall price sign, by the road at one end of the forecourt. */
export const PYLON = { height: 6.5, width: 1.6, panel: 2.6 }
/** If a canopy with no roof on the map would hit a building, it may slide along the road by up to this much. */
const SLIDES = [0, 4, -4, 8, -8, 12, -12]
/** A roof this close to the mapped spot is the bunk's canopy, in metres. */
const ROOF_REACH = 35

/**
 * A bunk's own driveways are mapped as narrow roads, so it faces the nearest
 * road at least this wide, if there's one this close; otherwise the nearest of any.
 */
const MAIN_ROAD_WIDTH = 6
const MAIN_ROAD_REACH = 70

/** The road piece nearest a point, of those at least `minWidth` wide, the long way: there are only a few bunks. */
function nearestPiece(pieces: RoadPiece[], x: number, z: number, minWidth = 0) {
  let best: { piece: RoadPiece; distance: number; along: number } | null = null
  for (const piece of pieces) {
    if (piece.width < minWidth) continue
    const [ax, az] = piece.start
    const [bx, bz] = piece.end
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1) continue
    const along = Math.max(0, Math.min(length, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / length))
    const distance = Math.hypot(x - (ax + ((bx - ax) * along) / length), z - (az + ((bz - az) * along) / length))
    if (!best || distance < best.distance) best = { piece, distance, along }
  }
  return best
}

/** True if the whole canopy stands clear of buildings. Checked at points across it. */
function isClear(collisions: CollisionWorld, station: FuelStation): boolean {
  for (let i = -2; i <= 2; i++) {
    for (let j = -1; j <= 1; j++) {
      const [x, z] = spotOf(station, (i / 2) * (station.length / 2), j * (station.depth / 2))
      if (isNearBuilding(collisions, x, z, 0.6)) return false
    }
  }
  return true
}

const clamp = (value: number, [low, high]: number[]) => Math.min(high, Math.max(low, value))

/** A roof's corners on the ground, in world x and z. */
function roofPoints(roof: PolygonFeature): GroundPoint[] {
  return roof.geometry.coordinates[0].map((position) => {
    const [x, , z] = lonLatToWorld(position)
    return [x, z] as GroundPoint
  })
}

/**
 * Puts each bunk by its nearest main road, facing it. Where the map has its
 * canopy (a `roof`, see `MapData.fuelRoofs`), the canopy goes exactly there, at
 * that size. Where it doesn't, it goes behind the pavement at the mapped spot,
 * sliding along the road if a building is in the way. Its pillars, pump islands
 * and sign pole are made solid.
 */
export function placeFuelStations(
  roads: LineFeature[],
  roofs: PolygonFeature[],
  collisions: CollisionWorld,
  /** More bunks, at spots the infill found on long gaps beside main roads (infillPlots.ts). */
  extra: { lat: number; lng: number }[] = [],
): FuelStation[] {
  const pieces = toRoadPieces(roads)
  const stations: FuelStation[] = []
  const roofCorners = roofs.map(roofPoints)

  const spots = [...FUEL_STATIONS, ...extra.map((spot, i) => ({ ...spot, brand: FUEL_BRAND_IDS[i % FUEL_BRAND_IDS.length] }))]
  for (const { brand, lat, lng } of spots) {
    const [x, , z] = lonLatToWorld([lng, lat])
    if (!isInsideBounds(x, z, 20)) continue

    // Its roof: the nearest one to the mapped spot, if any is close enough.
    let roof: GroundPoint[] | null = null
    let roofDistance = ROOF_REACH
    for (const corners of roofCorners) {
      const middleX = corners.reduce((sum, [px]) => sum + px, 0) / corners.length
      const middleZ = corners.reduce((sum, [, pz]) => sum + pz, 0) / corners.length
      const distance = Math.hypot(middleX - x, middleZ - z)
      if (distance < roofDistance) {
        roof = corners
        roofDistance = distance
      }
    }
    const [spotX, spotZ] = roof
      ? [roof.reduce((sum, [px]) => sum + px, 0) / roof.length, roof.reduce((sum, [, pz]) => sum + pz, 0) / roof.length]
      : [x, z]

    const main = nearestPiece(pieces, spotX, spotZ, MAIN_ROAD_WIDTH)
    const nearest = main && main.distance < MAIN_ROAD_REACH ? main : nearestPiece(pieces, spotX, spotZ)
    if (!nearest) continue
    const { piece, along, distance } = nearest
    const [ax, az] = piece.start
    const [bx, bz] = piece.end
    const length = Math.hypot(bx - ax, bz - az)
    const alongX = (bx - ax) / length
    const alongZ = (bz - az) / length
    // Away from the road, on the spot's side of it.
    const side = (spotX - ax) * alongZ - (spotZ - az) * alongX >= 0 ? 1 : -1
    const outX = alongZ * side
    const outZ = -alongX * side

    if (roof) {
      // The roof's extent along the road and away from it sets the canopy's size.
      const alongs = roof.map(([px, pz]) => (px - spotX) * alongX + (pz - spotZ) * alongZ)
      const outs = roof.map(([px, pz]) => (px - spotX) * outX + (pz - spotZ) * outZ)
      const roofLength = clamp(Math.max(...alongs) - Math.min(...alongs), CANOPY_LIMITS.length)
      const roofDepth = clamp(Math.max(...outs) - Math.min(...outs), CANOPY_LIMITS.depth)
      stations.push({ brand, x: spotX, z: spotZ, alongX, alongZ, outX, outZ, length: roofLength, depth: roofDepth, front: distance - piece.width / 2, yard: 0, yardSide: -1 })
      continue
    }

    const footX = ax + alongX * along
    const footZ = az + alongZ * along
    const { length: canopyLength, depth } = DEFAULT_CANOPY
    // At the mapped spot, or further back if that's too close to the road for the canopy to fit.
    const toMiddle = Math.max(piece.width / 2 + SETBACK + depth / 2, distance)
    for (const slide of SLIDES) {
      const station: FuelStation = {
        brand,
        x: footX + alongX * slide + outX * toMiddle,
        z: footZ + alongZ * slide + outZ * toMiddle,
        alongX,
        alongZ,
        outX,
        outZ,
        length: canopyLength,
        depth,
        front: toMiddle - piece.width / 2,
        yard: 0,
        yardSide: -1,
      }
      if (!isClear(collisions, station)) continue
      stations.push(station)
      break
    }
  }

  // A bunk's own driveways are mapped as narrow roads; the yard may pave over them, not over a street.
  const roadIndex = indexRoadPieces(pieces.filter(({ width }) => width >= YARD_STREET_WIDTH))
  for (const station of stations) {
    // The yard: as long as fits clear of buildings and other roads, if at least the office fits.
    // At whichever end has room for the longer one, so an empty plot beside the bunk becomes its yard.
    for (const side of [-1, 1]) {
      const yard = YARD_TRIES.find((tried) => isYardClear(station, tried, side, collisions, roadIndex)) ?? 0
      if (yard > station.yard) {
        station.yard = yard
        station.yardSide = side
      }
    }
    for (const [along, out] of pillarSpots(station)) addPost(collisions, ...spotOf(station, along, out), PILLAR_RADIUS + 0.1)
    for (const along of islandSpots(station)) {
      // Each island as two posts, end to end.
      for (const end of [-1, 1]) addPost(collisions, ...spotOf(station, along + end * (ISLAND.length / 4), 0), ISLAND.width / 2 + 0.1)
    }
    addPost(collisions, ...spotOf(station, ...pylonSpot(station)), 0.25)
    for (const vehicle of pumpVisitors(station).vehicles) {
      const along = vehicle.car ? 1.7 : 0.7
      addWall(
        collisions,
        [vehicle.x - Math.sin(vehicle.rotation) * along, vehicle.z - Math.cos(vehicle.rotation) * along],
        [vehicle.x + Math.sin(vehicle.rotation) * along, vehicle.z + Math.cos(vehicle.rotation) * along],
        vehicle.car ? 1.7 : 0.7,
      )
    }
    const office = officeOf(station)
    if (office) addWall(collisions, spotOf(station, office.along - office.length / 2, office.out), spotOf(station, office.along + office.length / 2, office.out), office.depth)
  }
  return stations
}

/** Roads at least this wide are streets, which a yard keeps off; narrower ones are driveways, in metres. */
const YARD_STREET_WIDTH = 4.5
/** Yard lengths tried, longest first. */
const YARD_TRIES = [18, 14, 10, 7]
/** The bunk's office in the yard: along the road, back from it and high, in metres. */
export const OFFICE = { length: 5, depth: 3.4, height: 3.1 }

/** Where the forecourt ends along the road: [the yard's end, the sign's end], from the canopy's middle. */
export function forecourtEnds(station: FuelStation): [number, number] {
  const end = station.length / 2 + FORECOURT_SIDES
  return station.yardSide < 0 ? [-(end + station.yard), end] : [-end, end + station.yard]
}

/** The far end of the yard, along the road from the canopy's middle. */
export function yardEnd(station: FuelStation): number {
  const [start, end] = forecourtEnds(station)
  return station.yardSide < 0 ? start : end
}

/** Whether a yard this long beside the canopy is clear of buildings and of other roads. */
function isYardClear(station: FuelStation, yard: number, side: number, collisions: CollisionWorld, roads: RoadIndex): boolean {
  const from = station.length / 2 + FORECOURT_SIDES
  const back = station.depth / 2 + FORECOURT_BACK
  for (let along = from; along <= from + yard; along += 1.5) {
    // From behind the footpath (up to 3.2 m wide): the forecourt in front of that is open to the road anyway.
    for (let out = -station.front + 3.5; out <= back; out += 1.5) {
      const [x, z] = spotOf(station, along * side, out)
      if (isNearBuilding(collisions, x, z, 0.4) || !isClearOfRoads(roads, x, z, 0.5)) return false
    }
  }
  return true
}

/** The office, at the back of the yard, or null with no yard. Its middle, along and out from the canopy's middle. */
export function officeOf(station: FuelStation): { along: number; out: number; length: number; depth: number } | null {
  if (station.yard < OFFICE.length + 1) return null
  const back = station.depth / 2 + FORECOURT_BACK
  return { along: yardEnd(station) - station.yardSide * (OFFICE.length / 2 + 0.6), out: back - OFFICE.depth / 2 - 0.3, length: OFFICE.length, depth: OFFICE.depth }
}

/**
 * Who's at the pumps: a car filling up beside the first island and a scooter at the last (both
 * still: they stand as parked vehicles do), and the attendant at the car's tank.
 */
export function pumpVisitors(station: FuelStation): { vehicles: StiltVehicle[]; attendants: { x: number; z: number; heading: number }[] } {
  const islands = islandSpots(station)
  const facing = Math.atan2(station.alongX, station.alongZ)
  const seed = Math.abs(Math.round(station.x * 13 + station.z * 7))
  const carAt = spotOf(station, islands[0], ISLAND.width / 2 + 1.35)
  const bikeAt = spotOf(station, islands[islands.length - 1] + 0.4, -(ISLAND.width / 2 + 0.75))
  const attendant = spotOf(station, islands[0] + 0.9, ISLAND.width / 2 + 0.2)
  // The staff's vehicles in the yard, in front of the office: a car and two bikes.
  const staff: StiltVehicle[] = []
  const office = officeOf(station)
  if (office) {
    const toYard = -station.yardSide
    const outward = Math.atan2(-station.outX, -station.outZ)
    const [cx, cz] = spotOf(station, office.along + toYard * 0.4, office.out - office.depth / 2 - 2.6)
    staff.push({ x: cx, z: cz, rotation: outward + Math.PI / 2, variation: (seed % 71) / 71, car: true, model: (seed + 1) % 3 })
    for (const step of [0, 1]) {
      const [bx, bz] = spotOf(station, office.along - toYard * (office.length / 2 - 0.5 - step * 0.9), office.out - office.depth / 2 - 1)
      staff.push({ x: bx, z: bz, rotation: outward, variation: ((seed + step * 13) % 83) / 83, car: false })
    }
  }
  return {
    vehicles: [
      { x: carAt[0], z: carAt[1], rotation: facing, variation: (seed % 97) / 97, car: true, model: seed % 3 },
      { x: bikeAt[0], z: bikeAt[1], rotation: facing + Math.PI, variation: (seed % 89) / 89, car: false },
      ...staff,
    ],
    // Facing the car, to the island's side.
    attendants: [{ x: attendant[0], z: attendant[1], heading: Math.atan2(station.outX, station.outZ) }],
  }
}

/** A point on a bunk's forecourt, `along` the road and `out` from the canopy's middle, as world x and z. */
export function spotOf(station: FuelStation, along: number, out: number): [number, number] {
  return [station.x + station.alongX * along + station.outX * out, station.z + station.alongZ * along + station.outZ * out]
}

export function pillarSpots(station: FuelStation): [number, number][] {
  const along = station.length / 2 - PILLAR_INSET
  const out = station.depth / 2 - PILLAR_INSET
  return [
    [-along, -out],
    [along, -out],
    [-along, out],
    [along, out],
  ]
}

/** Two pump islands, or three under a long canopy, spread evenly along it. */
export function islandSpots(station: FuelStation): number[] {
  const count = station.length >= 18 ? 3 : 2
  return Array.from({ length: count }, (_, i) => ((i + 1) / (count + 1) - 0.5) * station.length)
}

/**
 * The sign stands at one end of the forecourt, just behind the pavement (or
 * halfway to the canopy, if the canopy is nearer the road than that).
 */
export function pylonSpot(station: FuelStation): [number, number] {
  const behindPavement = Math.min(-station.front + SETBACK - 0.3, -station.depth / 2 - 0.3)
  return [station.length / 2 + 1.5, Math.max(behindPavement, -station.front + 1.2)]
}

/** How far past the canopy's edge still counts as at the pumps, in metres. */
const PUMP_REACH = 1.5

/** The bunk whose canopy is over this spot, or null if none is. */
export function bunkAt(stations: FuelStation[], x: number, z: number): FuelStation | null {
  for (const station of stations) {
    const dx = x - station.x
    const dz = z - station.z
    const along = dx * station.alongX + dz * station.alongZ
    const out = dx * station.outX + dz * station.outZ
    if (Math.abs(along) <= station.length / 2 + PUMP_REACH && Math.abs(out) <= station.depth / 2 + PUMP_REACH) return station
  }
  return null
}

/** Room left round a forecourt for riding in and out: to each side of the canopy, and behind it, in metres. */
const FORECOURT_SIDES = 3
const FORECOURT_BACK = 1

/**
 * True on any bunk's forecourt: from the road's edge to just behind the canopy,
 * and a little past each end, where the price sign stands. Trees, lamps and
 * parked scooters keep off it, so the way to the pumps stays open.
 */
export function isOnForecourt(stations: FuelStation[], x: number, z: number): boolean {
  return stations.some((station) => {
    const dx = x - station.x
    const dz = z - station.z
    const along = dx * station.alongX + dz * station.alongZ
    const out = dx * station.outX + dz * station.outZ
    const [start, end] = forecourtEnds(station)
    return (
      along >= start &&
      along <= end &&
      out >= -station.front &&
      out <= station.depth / 2 + FORECOURT_BACK
    )
  })
}

/** A bunk's forecourt as an outline: the same ground as `isOnForecourt`, for the surface map. */
export function forecourtOutline(station: FuelStation): [number, number][] {
  const at = (along: number, out: number): [number, number] => [
    station.x + station.alongX * along + station.outX * out,
    station.z + station.alongZ * along + station.outZ * out,
  ]
  const [start, end] = forecourtEnds(station)
  const back = station.depth / 2 + FORECOURT_BACK
  return [at(start, -station.front), at(end, -station.front), at(end, back), at(start, back)]
}

/**
 * A tyre puncture shop on open ground beside a bunk, as there so often is: a tin shed, tyres
 * stacked out front, a few vehicles waiting and the mechanic. `along` and `out` are its middle
 * from the canopy's middle; it faces the road.
 */
export type TyreShop = { station: FuelStation; along: number; out: number }

/** The shop's lot, along the road and back from it, in metres. */
export const TYRE_LOT = { length: 11, depth: 8 }

/**
 * Finds open ground for a tyre shop beside each bunk: the nearest spot, along the road either way
 * past the forecourt, where the whole lot is open ground on the surface map and clear of buildings.
 */
export function findTyreShops(stations: FuelStation[], isOpen: (x: number, z: number) => boolean, collisions: CollisionWorld): TyreShop[] {
  const shops: TyreShop[] = []
  for (const station of stations) {
    const [start, end] = forecourtEnds(station)
    // Behind the footpath, which can be 4.5 m wide where a bunk's apron meets it.
    const out = -station.front + 5.5 + TYRE_LOT.depth / 2
    found: for (let gap = 2; gap <= 40; gap += 2) {
      for (const side of [-1, 1]) {
        const along = side < 0 ? start - gap - TYRE_LOT.length / 2 : end + gap + TYRE_LOT.length / 2
        let clear = true
        for (let a = -TYRE_LOT.length / 2; a <= TYRE_LOT.length / 2 && clear; a += 1) {
          for (let o = -TYRE_LOT.depth / 2; o <= TYRE_LOT.depth / 2 && clear; o += 1) {
            const [x, z] = spotOf(station, along + a, out + o)
            if (!isOpen(x, z) || isNearBuilding(collisions, x, z, 0.3)) clear = false
          }
        }
        if (!clear) continue
        shops.push({ station, along, out })
        break found
      }
    }
  }
  for (const shop of shops) {
    const back = shop.out + TYRE_LOT.depth / 2 - 1.8
    addWall(collisions, spotOf(shop.station, shop.along - 2.2, back), spotOf(shop.station, shop.along + 2.2, back), 3.2)
    for (const vehicle of tyreShopVisitors(shop).vehicles) addPost(collisions, vehicle.x, vehicle.z, vehicle.car ? 1.1 : 0.4)
  }
  return shops
}

/** Who's at a tyre shop: two cars and a few bikes waiting in front, and the mechanic. */
export function tyreShopVisitors(shop: TyreShop): { vehicles: StiltVehicle[]; mechanic: { x: number; z: number; heading: number } } {
  const { station } = shop
  const facing = Math.atan2(station.alongX, station.alongZ)
  const front = shop.out - TYRE_LOT.depth / 2 + 1.4
  const seed = Math.abs(Math.round(station.x * 5 + station.z * 11))
  const at = (along: number, out: number) => spotOf(station, shop.along + along, out)
  const car = (along: number, model: number): StiltVehicle => {
    const [x, z] = at(along, front)
    return { x, z, rotation: facing + (seed % 2 ? Math.PI : 0), variation: ((seed + model) % 50) / 50, car: true, model }
  }
  const bike = (along: number, turn: number): StiltVehicle => {
    const [x, z] = at(along, front + 2.6)
    return { x, z, rotation: Math.atan2(station.outX, station.outZ) + turn, variation: ((seed * 3 + along * 10) % 50) / 50, car: false }
  }
  const [mx, mz] = at(-1.2, front + 3.3)
  return {
    vehicles: [car(-3.2, seed % 3), bike(1.2, 0.2), bike(2.3, -0.15), bike(3.4, 0.3)],
    mechanic: { x: mx, z: mz, heading: Math.atan2(-station.outX, -station.outZ) },
  }
}

/**
 * Where a bunk's EV charger stands: just past the canopy's end, on the end away from its yard and
 * office, level with the pumps. An electric pulls up beside it.
 */
export function chargerSpot(station: FuelStation): { x: number; z: number; rotation: number } {
  const end = (station.yard > 0 ? -station.yardSide : 1) * (station.length / 2 + 1.1)
  return { x: station.x + station.alongX * end, z: station.z + station.alongZ * end, rotation: Math.atan2(-station.outX, -station.outZ) }
}

/** How near a charger an electric must stop to plug in, in metres. */
const CHARGER_REACH = 4.2

/** The bunk whose EV charger is in reach of this spot, or null. */
export function chargerAt(stations: FuelStation[], x: number, z: number): FuelStation | null {
  for (const station of stations) {
    const spot = chargerSpot(station)
    if (Math.hypot(spot.x - x, spot.z - z) <= CHARGER_REACH) return station
  }
  return null
}
