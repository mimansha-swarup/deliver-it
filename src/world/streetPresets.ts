import { hashString } from './buildingData'
import type { BuildingFeature, LineFeature, PointFeature } from './mapData'
import { createRandom, nearestRoadPiece, type RoadIndex } from './props'
import { isInsideBounds, lonLatToWorld, type GroundPoint } from './worldUtils'

/*
 * Street presets (ART_DIRECTION.md): 27th Main Road is the reference street,
 * and what was built for it is described here as data, in three kinds of
 * street, so the whole map can be dressed the same way:
 *
 * - shop street: a footpath of grey pavers with black and yellow kerbs,
 *   forecourts paved up to the shops, parked scooters, shopkeepers, customers
 *   and people walking past, and the signs glowing at night;
 * - residential street: a narrower footpath with plain grey kerbs, compound
 *   walls and gates, washing and creepers, tree pits, and far fewer people;
 * - main road: wider, taller painted kerbs, a median down the middle of a wide
 *   two-way road, buses, and more traffic.
 *
 * Each road gets one, from its OSM tags and what stands along it
 * (`assignStreetPresets`). Everything else asks `streetPresetOf(road)`.
 * Service roads and tracks get none, and keep the plain ground.
 */

export type StreetPresetName = 'shop' | 'residential' | 'main'

export type StreetPreset = {
  name: StreetPresetName
  /** How far the footpath reaches out from the road's edge, in metres, kerb included. */
  footpath: number
  kerb: {
    /** How high it stands above the road, and how wide its top is, in metres. */
    rise: number
    width: number
    /** Painted black and yellow, or bare grey concrete. */
    painted: boolean
  }
  /**
   * A raised median down the middle of a two-way road at least `minRoadWidth`
   * wide, or none. A dual carriageway, mapped as two one-way roads, gets its
   * median from the footpath paved into the gap between them.
   */
  median: { width: number; rise: number; minRoadWidth: number } | null
  /** Marks on the asphalt: one is tried every `every` metres, and this share of tries gets one. */
  marks: { every: number; share: number }
  /**
   * Share of gutter spots, every 1.4 m, with a drift of dry leaves. Each leaf is
   * two triangles, so across the whole map this is kept light: a drift every few
   * metres on a shop street, a stray few on a residential one.
   */
  leaves: number
  /** Whether shops get their forecourts paved up to the footpath. */
  forecourts: boolean
  /** People at the shops (shopPeoplePlacement.ts): shares of shops with each. */
  people: { keeper: number; customers: number; pair: number; walker: number }
  /** The most scooters parked outside a shop. */
  parkedPerShop: number
  /** House dressing (houseKit.ts), in percent of houses. */
  houses: { washing: number; creeper: number }
  /** How much more often traffic is placed on this street than on a residential one. */
  traffic: number
  /** Whether buses run here. */
  buses: boolean
}

export const STREET_PRESETS: Record<StreetPresetName, StreetPreset> = {
  shop: {
    name: 'shop',
    footpath: 3,
    kerb: { rise: 0.15, width: 0.2, painted: true },
    median: null,
    marks: { every: 4, share: 0.55 },
    leaves: 0.3,
    forecourts: true,
    people: { keeper: 0.5, customers: 1, pair: 0.16, walker: 0.35 },
    parkedPerShop: 4,
    houses: { washing: 30, creeper: 30 },
    traffic: 2,
    buses: false,
  },
  residential: {
    name: 'residential',
    footpath: 1.5,
    kerb: { rise: 0.12, width: 0.18, painted: false },
    median: null,
    marks: { every: 6, share: 0.4 },
    leaves: 0.06,
    forecourts: true,
    people: { keeper: 0.35, customers: 0.5, pair: 0.06, walker: 0.1 },
    parkedPerShop: 2,
    houses: { washing: 45, creeper: 60 },
    traffic: 1,
    buses: false,
  },
  main: {
    name: 'main',
    footpath: 3.2,
    kerb: { rise: 0.2, width: 0.3, painted: true },
    // Narrow enough to clear traffic, whose lanes run 1.4 m either side of the road's middle.
    median: { width: 1.0, rise: 0.25, minRoadWidth: 9 },
    marks: { every: 3, share: 0.6 },
    leaves: 0.12,
    forecourts: true,
    people: { keeper: 0.4, customers: 0.7, pair: 0.1, walker: 0.25 },
    parkedPerShop: 3,
    houses: { washing: 20, creeper: 25 },
    traffic: 10,
    buses: true,
  },
}

/** The widest footpath of any preset: how far out from a road to look for one. */
export const WIDEST_FOOTPATH = Math.max(...Object.values(STREET_PRESETS).map((preset) => preset.footpath))

/** OSM road classes of the main roads. */
const MAIN_ROADS = new Set(['motorway', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'])
/** Road classes that can be a shop street or a residential one. */
const STREET_ROADS = new Set(['tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street'])
/**
 * A street with at least this many shops per 100 m, counting both sides, is a
 * shop street. 27th Main has about 10; a residential street with a corner shop
 * or two has under 1.
 */
const SHOPS_PER_100M = 2.5
/** A shop counts for a road if it's within this distance of the road's line, in metres. */
const SHOP_REACH = 28

const presets = new WeakMap<LineFeature, StreetPreset>()
const seeds = new WeakMap<LineFeature, number>()

/** The road's preset, or null for service roads, tracks and anything off the map, which keep the plain ground. */
export function streetPresetOf(road: LineFeature): StreetPreset | null {
  return presets.get(road) ?? null
}

/**
 * A seed of the road's own: from its name, so every piece of a named street is
 * dressed alike, or from its id. The same street comes out the same on every
 * visit, and different streets come out differently.
 */
export function streetSeed(road: LineFeature): number {
  let seed = seeds.get(road)
  if (seed === undefined) {
    seed = hashString(road.properties.name ?? road.id)
    seeds.set(road, seed)
  }
  return seed
}

/** A seeded random of a road's own, mixed with `salt`, so each use of it on the street draws its own numbers. */
export function streetRandom(road: LineFeature, salt: number): () => number {
  return createRandom((streetSeed(road) ^ Math.imul(salt + 1, 2654435761)) >>> 0)
}

function toPoints(road: LineFeature): GroundPoint[] {
  return road.geometry.coordinates.map((position): GroundPoint => {
    const [x, , z] = lonLatToWorld(position)
    return [x, z]
  })
}

/** Points sorted into squares, for counting the ones near a line. */
class PointCells {
  private readonly cells = new Map<string, GroundPoint[]>()
  private readonly size: number
  constructor(points: GroundPoint[], size: number) {
    this.size = size
    for (const point of points) {
      const key = `${Math.floor(point[0] / size)},${Math.floor(point[1] / size)}`
      const list = this.cells.get(key)
      if (list) list.push(point)
      else this.cells.set(key, [point])
    }
  }
  /** Every point within `reach` of the segment from a to b, added to `found`. */
  collectNear(a: GroundPoint, b: GroundPoint, reach: number, found: Set<GroundPoint>) {
    const [minX, maxX] = [Math.min(a[0], b[0]) - reach, Math.max(a[0], b[0]) + reach]
    const [minZ, maxZ] = [Math.min(a[1], b[1]) - reach, Math.max(a[1], b[1]) + reach]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const lengthSquared = dx * dx + dz * dz || 1
    for (let cx = Math.floor(minX / this.size); cx <= Math.floor(maxX / this.size); cx++) {
      for (let cz = Math.floor(minZ / this.size); cz <= Math.floor(maxZ / this.size); cz++) {
        for (const point of this.cells.get(`${cx},${cz}`) ?? []) {
          const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared))
          if (Math.hypot(a[0] + dx * t - point[0], a[1] + dz * t - point[1]) <= reach) found.add(point)
        }
      }
    }
  }
}

function centreOf(building: BuildingFeature): GroundPoint {
  const ring = building.geometry.coordinates[0]
  let x = 0
  let z = 0
  for (const position of ring) {
    const [px, , pz] = lonLatToWorld(position)
    x += px
    z += pz
  }
  return [x / ring.length, z / ring.length]
}

/** Places on the map that are shops, or that look like one from the street. */
function isShopPlace({ properties }: PointFeature): boolean {
  return Boolean(properties.shop) || ['restaurant', 'fast_food', 'cafe', 'pharmacy', 'bank', 'ice_cream', 'clinic'].includes(properties.amenity ?? '')
}

export type StreetPresetSummary = Record<StreetPresetName, { roads: number; km: number }> & { plain: { roads: number; km: number } }

/** The biggest roads: a street with any of these in it is a main road, however many shops it has. */
const ARTERIAL_ROADS = new Set(['motorway', 'trunk', 'trunk_link', 'primary', 'primary_link'])

/**
 * Picks every road's preset, one per named street, so a street isn't one kind
 * for a block and another for the next (27th Main is mapped partly as a
 * secondary road and partly as a tertiary one, and is one shop street).
 * Unnamed roads are decided one by one.
 *
 * - A street with any arterial piece (motorway, trunk, primary) is a main road.
 * - Otherwise one with enough shops along it, counting shop buildings and
 *   mapped shops over its whole length, is a shop street.
 * - Otherwise one mostly of secondary roads is a main road, and the rest are
 *   residential.
 * Service roads, tracks and anything else keep the plain ground.
 */
export function assignStreetPresets(
  roads: LineFeature[],
  buildings: BuildingFeature[],
  places: PointFeature[],
  /** Debug: only these named streets get a preset, the rest the plain ground, as before the rollout. */
  only?: string[],
): StreetPresetSummary {
  // Only the map's own shops count: not ground floors this file turned into shops on an earlier build.
  const shops = [...buildings.filter((building) => building.kind === 'shop' && !turnedIntoShops.has(building) && !building.id.startsWith('infill/')).map(centreOf), ...places.filter(isShopPlace).map((place) => {
    const [x, , z] = lonLatToWorld(place.geometry.coordinates)
    return [x, z] as GroundPoint
  })]
  const cells = new PointCells(shops, 32)

  type Tally = { shops: Set<GroundPoint>; length: number; mainLength: number; arterial: boolean }
  const tallies = new Map<string, Tally>()
  const keyOf = (road: LineFeature) => road.properties.name ?? `#${road.id}`
  const lengths = new Map<LineFeature, number>()
  for (const road of roads) {
    const highway = road.properties.highway ?? ''
    const isMain = MAIN_ROADS.has(highway)
    if (!isMain && !STREET_ROADS.has(highway)) continue
    const tally = tallies.get(keyOf(road)) ?? { shops: new Set<GroundPoint>(), length: 0, mainLength: 0, arterial: false }
    tallies.set(keyOf(road), tally)
    tally.arterial ||= ARTERIAL_ROADS.has(highway)
    const points = toPoints(road)
    let length = 0
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]]
      if (!isInsideBounds((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue
      length += Math.hypot(b[0] - a[0], b[1] - a[1])
      cells.collectNear(a, b, SHOP_REACH, tally.shops)
    }
    tally.length += length
    if (isMain) tally.mainLength += length
    lengths.set(road, length)
  }

  const presetOfStreet = new Map<string, StreetPreset>()
  for (const [key, tally] of tallies) {
    const perHundred = tally.length > 0 ? (tally.shops.size / tally.length) * 100 : 0
    presetOfStreet.set(
      key,
      tally.arterial ? STREET_PRESETS.main
      : perHundred >= SHOPS_PER_100M ? STREET_PRESETS.shop
      : tally.mainLength > tally.length / 2 ? STREET_PRESETS.main
      : STREET_PRESETS.residential,
    )
  }

  const summary: StreetPresetSummary = {
    shop: { roads: 0, km: 0 },
    residential: { roads: 0, km: 0 },
    main: { roads: 0, km: 0 },
    plain: { roads: 0, km: 0 },
  }
  for (const road of roads) {
    let preset = presetOfStreet.get(keyOf(road)) ?? null
    const highway = road.properties.highway ?? ''
    if (!MAIN_ROADS.has(highway) && !STREET_ROADS.has(highway)) preset = null
    if (only && !only.includes(road.properties.name ?? '')) preset = null
    if (preset) presets.set(road, preset)
    else presets.delete(road)
    const entry = summary[preset?.name ?? 'plain']
    entry.roads++
    entry.km += (lengths.get(road) ?? 0) / 1000
  }
  return summary
}

/** Debug: the longest named streets of each preset, with their length in play, in metres. */
export function listStreets(roads: LineFeature[], count = 12): Record<StreetPresetName, string[]> {
  const lengths: Record<StreetPresetName, Map<string, number>> = { shop: new Map(), residential: new Map(), main: new Map() }
  for (const road of roads) {
    const preset = streetPresetOf(road)
    const name = road.properties.name
    if (!preset || !name) continue
    const points = toPoints(road)
    let length = 0
    for (let i = 0; i < points.length - 1; i++) {
      if (isInsideBounds((points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2)) {
        length += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
      }
    }
    lengths[preset.name].set(name, (lengths[preset.name].get(name) ?? 0) + length)
  }
  const top = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]).slice(0, count).map(([name, length]) => `${name}: ${Math.round(length)} m`)
  return { shop: top(lengths.shop), residential: top(lengths.residential), main: top(lengths.main) }
}

/** Buildings turned into shops here, which mustn't count as the map's own shops if the world is built again. */
const turnedIntoShops = new WeakSet<BuildingFeature>()

/** Share of the houses and flats fronting each kind of street that have shops on their ground floor. */
const GROUND_FLOOR_SHOPS: Partial<Record<StreetPresetName, number>> = { shop: 0.9, main: 0.8 }
/** A building fronts a street if its nearest corner is within this of the road's edge, in metres. */
const FRONTAGE_REACH = 9

/**
 * Puts shops on the ground floor of the houses and flats along shop streets
 * and main roads, as on 27th Main, where nearly every building has them. OSM
 * marks only some buildings as shops, which left most of a street like 24th
 * Main with plain house fronts. Each building's choice comes from a hash of its
 * id, so it never changes. Turns `kind` to 'shop' in place, so everything after
 * (the house kit, shop fronts, signs and shop people) treats it as one.
 * Returns how many were turned.
 */
export function addGroundFloorShops(buildings: BuildingFeature[], roads: LineFeature[], index: RoadIndex): number {
  let turned = 0
  for (const building of buildings) {
    if (building.kind !== 'house' && building.kind !== 'apartment') continue
    const ring = building.geometry.coordinates[0]
    let nearest: { edge: number; road: number } | null = null
    for (const position of ring) {
      const [x, , z] = lonLatToWorld(position)
      const near = nearestRoadPiece(index, x, z, FRONTAGE_REACH)
      if (near && (!nearest || near.edge < nearest.edge)) nearest = { edge: near.edge, road: near.piece.road }
    }
    if (!nearest) continue
    const preset = streetPresetOf(roads[nearest.road])
    const share = preset ? GROUND_FLOOR_SHOPS[preset.name] : undefined
    if (share === undefined || (hashString(`${building.id}:shop`) % 1000) / 1000 >= share) continue
    building.kind = 'shop'
    turnedIntoShops.add(building)
    turned++
  }
  return turned
}
