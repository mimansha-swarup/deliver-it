import { getFootprintArea, hashString } from './buildingData'
import type { BuildingFeature, CivicUse, PointFeature, PolygonFeature } from './mapData'
import { isInsideOutline, lonLatToWorld, type GroundPoint, type LonLat } from './worldUtils'

/** `temple` covers every place of worship, drawn by Temples.tsx rather than as a plain building (see worship.ts). */
export type BuildingKind = 'house' | 'apartment' | 'shop' | 'office' | 'civic' | 'temple'

type Properties = PolygonFeature['properties']

/** A mapped place this close to a building belongs to it, in metres. Matches the awnings. */
const PLACE_REACH = 16

/** Footprints from the map, in square metres, used when nothing else says what a building is. */
const SMALL_HOME = 160
const LARGE_HOME = 420
/** In between, this share of buildings out of 100 are small blocks of flats. */
const FLATS_CHANCE = 25
/** A building this big in a commercial area is more likely offices than a row of shops. */
const OFFICE_BLOCK = 500

const BUILDING_TAGS: Record<string, BuildingKind> = {
  apartments: 'apartment',
  house: 'house',
  commercial: 'shop',
  retail: 'shop',
  office: 'office',
  school: 'civic',
  college: 'civic',
}

const CIVIC_PLACES = new Set([
  'school',
  'kindergarten',
  'college',
  'university',
  'hospital',
  'community_centre',
  'public_building',
])
const SHOP_AMENITIES = new Set([
  'restaurant',
  'fast_food',
  'cafe',
  'bar',
  'ice_cream',
  'pharmacy',
  'bank',
  'clinic',
  'dentist',
  'doctors',
])

/** When two places claim one building, the stronger clue wins: a school can have a canteen. */
const CLUE_STRENGTH: Record<BuildingKind, number> = {
  temple: 4,
  civic: 3,
  office: 2,
  shop: 1,
  apartment: 0,
  house: 0,
}

/** What a feature's own tags say it's used for, if anything. */
function kindFromUse({ amenity, healthcare, office, shop }: Properties): BuildingKind | undefined {
  if (CIVIC_PLACES.has(amenity ?? '') || healthcare === 'hospital') return 'civic'
  if (office) return 'office'
  if (shop || SHOP_AMENITIES.has(amenity ?? '')) return 'shop'
  if (healthcare) return 'shop'
  return undefined
}

function toOutline(ring: LonLat[]): GroundPoint[] {
  return ring.slice(0, -1).map((position): GroundPoint => {
    const [x, , z] = lonLatToWorld(position)
    return [x, z]
  })
}

function getCentre(outline: GroundPoint[]): GroundPoint {
  return [
    outline.reduce((sum, [x]) => sum + x, 0) / outline.length,
    outline.reduce((sum, [, z]) => sum + z, 0) / outline.length,
  ]
}

function distanceToLine([x, z]: GroundPoint, [ax, az]: GroundPoint, [bx, bz]: GroundPoint): number {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  const along = lengthSquared > 0 ? ((x - ax) * dx + (z - az) * dz) / lengthSquared : 0
  const part = Math.min(1, Math.max(0, along))
  return Math.hypot(x - (ax + part * dx), z - (az + part * dz))
}

/** How far a point is from an outline, in metres. Inside counts as zero. */
function distanceToOutline(outline: GroundPoint[], point: GroundPoint): number {
  if (isInsideOutline(outline, point[0], point[1])) return 0

  let nearest = Infinity
  outline.forEach((corner, index) => {
    const next = outline[(index + 1) % outline.length]
    nearest = Math.min(nearest, distanceToLine(point, corner, next))
  })
  return nearest
}

/** The size of the grid squares buildings are sorted into for `findKindsFromPlaces`, in metres. */
const PLACE_CELL = 48

/** OSM usually maps a shop as a dot beside its building. This joins each dot to one building. */
function findKindsFromPlaces(
  buildings: PolygonFeature[],
  outlines: GroundPoint[][],
  places: PointFeature[],
): Map<string, BuildingKind> {
  const kinds = new Map<string, BuildingKind>()
  // Each outline's box, so most buildings can be ruled out without measuring.
  const boxes = outlines.map((outline) => {
    const xs = outline.map(([x]) => x)
    const zs = outline.map(([, z]) => z)
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  })

  // The boxes sorted into grid squares: each building is listed in every square its box touches.
  const cells = new Map<number, number[]>()
  const cellOf = (value: number) => Math.floor(value / PLACE_CELL) + 2048
  boxes.forEach(([minX, maxX, minZ, maxZ], index) => {
    for (let cx = cellOf(minX); cx <= cellOf(maxX); cx++) {
      for (let cz = cellOf(minZ); cz <= cellOf(maxZ); cz++) {
        const list = cells.get(cx * 4096 + cz)
        if (list) list.push(index)
        else cells.set(cx * 4096 + cz, [index])
      }
    }
  })
  /** Every building whose box could be within reach of a point, each once, lowest number first. */
  const nearby = (x: number, z: number): number[] => {
    const found = new Set<number>()
    for (let cx = cellOf(x - PLACE_REACH); cx <= cellOf(x + PLACE_REACH); cx++) {
      for (let cz = cellOf(z - PLACE_REACH); cz <= cellOf(z + PLACE_REACH); cz++) {
        for (const index of cells.get(cx * 4096 + cz) ?? []) found.add(index)
      }
    }
    return [...found].sort((a, b) => a - b)
  }

  for (const place of places) {
    const kind = kindFromUse(place.properties)
    if (!kind) continue

    const [x, , z] = lonLatToWorld(place.geometry.coordinates)
    let nearest: PolygonFeature | undefined
    let nearestDistance = PLACE_REACH

    // Only the buildings in the grid squares within reach, in the map's own order, as going
    // through all twenty thousand for every place gave the same answer far more slowly.
    for (const index of nearby(x, z)) {
      const [minX, maxX, minZ, maxZ] = boxes[index]
      if (x < minX - nearestDistance || x > maxX + nearestDistance || z < minZ - nearestDistance || z > maxZ + nearestDistance) continue
      const distance = distanceToOutline(outlines[index], [x, z])
      if (distance >= nearestDistance) continue
      nearest = buildings[index]
      nearestDistance = distance
    }
    if (!nearest) continue

    const current = kinds.get(nearest.id)
    if (!current || CLUE_STRENGTH[kind] > CLUE_STRENGTH[current]) kinds.set(nearest.id, kind)
  }

  return kinds
}

type Zone = { outline: GroundPoint[]; use?: BuildingKind; civicUse?: CivicUse; commercial: boolean; box: [number, number, number, number] }

const SCHOOLS = new Set(['school', 'kindergarten', 'college', 'university'])
/** What a civic place is, from its tags, if the game draws that kind differently. */
function civicUseOf({ amenity, healthcare, building }: Properties): CivicUse | undefined {
  if (SCHOOLS.has(amenity ?? '') || SCHOOLS.has(building ?? '')) return 'school'
  if (amenity === 'hospital' || healthcare === 'hospital' || building === 'hospital') return 'hospital'
  return undefined
}

/** Areas that say something about the buildings on them, like a school's grounds. */
function findZones(areas: PolygonFeature[]): Zone[] {
  const zones = areas.map((area): Zone => {
    const outline = toOutline(area.geometry.coordinates[0])
    let box: Zone['box'] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const [x, z] of outline) box = [Math.min(box[0], x), Math.max(box[1], x), Math.min(box[2], z), Math.max(box[3], z)]
    return {
      outline,
      box,
      use: kindFromUse(area.properties),
      civicUse: civicUseOf(area.properties),
      commercial: area.properties.landuse === 'commercial',
    }
  })
  return zones.filter((zone) => zone.use || zone.commercial)
}

function kindFromZone(zones: Zone[], centre: GroundPoint, area: number): BuildingKind | undefined {
  // A point outside a zone's box is outside the zone: most are ruled out without walking its outline.
  const inside = zones.filter(({ outline, box }) => centre[0] >= box[0] && centre[0] <= box[1] && centre[1] >= box[2] && centre[1] <= box[3] && isInsideOutline(outline, centre[0], centre[1]))
  const named = inside.find((zone) => zone.use)
  if (named) return named.use
  if (inside.length === 0) return undefined
  return area >= OFFICE_BLOCK ? 'office' : 'shop'
}

/** The last resort, and the most common: homes, with bigger footprints holding more families. */
function kindFromSize(building: PolygonFeature, area: number): BuildingKind {
  if (area < SMALL_HOME) return 'house'
  if (area >= LARGE_HOME) return 'apartment'
  return hashString(building.id) % 100 < FLATS_CHANCE ? 'apartment' : 'house'
}

/**
 * Works out what each building is. Only a few are tagged on the map, so it goes
 * from the surest clue to the weakest: the building's own tags, then a mapped
 * place beside it, then the area it stands in, and finally its size.
 */
export function classifyBuildings(
  buildings: PolygonFeature[],
  places: PointFeature[],
  areas: PolygonFeature[],
): BuildingFeature[] {
  const outlines = buildings.map((building) => toOutline(building.geometry.coordinates[0]))
  const kindsFromPlaces = findKindsFromPlaces(buildings, outlines, places)
  const zones = findZones(areas)
  const civicPlaces = places.flatMap((place) => {
    const use = civicUseOf(place.properties)
    if (!use) return []
    const [x, , z] = lonLatToWorld(place.geometry.coordinates)
    return [{ use, at: [x, z] as GroundPoint }]
  })

  return buildings.map((building, index) => {
    const { properties, id } = building
    const area = getFootprintArea(building)
    const kind =
      BUILDING_TAGS[properties.building ?? ''] ??
      kindFromUse(properties) ??
      kindsFromPlaces.get(id) ??
      kindFromZone(zones, getCentre(outlines[index]), area) ??
      kindFromSize(building, area)

    if (kind !== 'civic') return { ...building, kind }
    // Which civic building: its own tags, a school or hospital mapped beside it, or the grounds it stands in.
    const outline = outlines[index]
    const centre = getCentre(outline)
    const civicUse =
      civicUseOf(properties) ??
      civicPlaces
        .map(({ use, at }) => ({ use, distance: distanceToOutline(outline, at) }))
        .filter(({ distance }) => distance < PLACE_REACH)
        .sort((a, b) => a.distance - b.distance)[0]?.use ??
      zones.find((zone) => zone.civicUse && isInsideOutline(zone.outline, centre[0], centre[1]))?.civicUse
    return { ...building, kind, civicUse }
  })
}
