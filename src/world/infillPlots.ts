import { addFootprint, addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { BuildingFeature, LineFeature, PolygonFeature } from './mapData'
import { isClearOfRoads, type RoadIndex, type RoadPiece } from './props'
import type { ConstructionSite } from './sitePlacement'
import type { StiltVehicle } from './houseKit'
import { streetPresetOf, streetRandom, type StreetPresetName } from './streetPresets'
import type { PlaceOfWorship } from './worship'
import { isInsideBounds, isInsideOutline, lonLatToWorld, WORLD_ORIGIN, type GroundPoint, type LonLat } from './worldUtils'

/*
 * Filling the empty plots beside the streets (ART_DIRECTION.md: a street with
 * life in it; no bare fields along the road). OSM maps only some of HSR's
 * buildings, so long stretches of road had nothing beside them but red soil.
 * Each preset street's sides are walked, and wherever a plot's worth of ground
 * beside the footpath is clear of buildings, roads, parks and the like, it's
 * built on, as such a street would be:
 *
 * - residential: houses, set back behind a compound wall (houseKit.ts gives them
 *   walls, gates and tanks), some with a car in the yard; now and then a
 *   building site instead;
 * - shop streets: buildings with shops on the ground floor;
 * - main roads: shops and showrooms, now and then a hoarding on a gap, and,
 *   where a long gap allows, a petrol pump or a small roadside temple.
 *
 * The buildings are added to the map's own list, so every part of the world
 * that dresses, draws and makes solid the map's buildings treats them alike.
 * Each choice is seeded from the street and the spot, so a street is filled the
 * same way on every visit.
 */

/** A hoarding on two posts, facing the road. */
export type Hoarding = { x: number; z: number; rotation: number; width: number; poster: number }

export type Infill = {
  buildings: BuildingFeature[]
  sites: ConstructionSite[]
  parkedCars: StiltVehicle[]
  hoardings: Hoarding[]
  /** Spots for the extra petrol pumps, as the fuel station list has them. */
  pumps: { lat: number; lng: number }[]
  shrines: PlaceOfWorship[]
}

type PlotRule = {
  /** Along the road, and back from it, in metres: [smallest, largest]. */
  width: [number, number]
  depth: [number, number]
  /** Behind the footpath's far edge, in metres. */
  setback: number
  /** Gap between neighbouring buildings, in metres: [smallest, largest]. */
  gap: [number, number]
  floors: [number, number]
}

const RULES: Record<StreetPresetName, PlotRule> = {
  // Set back 3 m: room for a yard behind a compound wall, and a car in it.
  residential: { width: [8.5, 12], depth: [11, 14], setback: 3, gap: [0.8, 2], floors: [1, 3] },
  shop: { width: [7, 10], depth: [11, 15], setback: 0.5, gap: [0.2, 0.8], floors: [2, 3] },
  main: { width: [8, 12], depth: [12, 16], setback: 0.6, gap: [0.2, 1], floors: [2, 4] },
}

/** A house on a narrow strip stands behind a yard this deep, in metres: room for the compound wall and gate. */
const NARROW_YARD = 1.5
/** Shallower plots tried, in metres, where a full one doesn't fit in front of a building further back. */
const SHALLOWER: Record<StreetPresetName, number[]> = { residential: [9, 8, 6.5], shop: [9, 7, 6], main: [9, 7, 6] }
/** Shares of residential plots that become a building site, and of houses with a car in the yard. */
const SITE_SHARE = 0.07
const CAR_SHARE = 0.35
/** On a main road: shares of plots left as a gap with a hoarding at the front. */
const HOARDING_SHARE = 0.08
/** A petrol pump or a temple needs a gap this long, and one is placed at most this often along a main road, in metres. */
const PUMP_GAP = 34
const PUMP_SPACING = 900
const SHRINE_SPACING = 700
/** Land the map gives these uses is left alone. */
const BUILDABLE_LAND = new Set(['residential', 'commercial', 'retail', 'industrial', 'construction'])
const METRES_PER_DEGREE = 111_320
const LON_SCALE = Math.cos((WORLD_ORIGIN.lat * Math.PI) / 180)

/** The inverse of `lonLatToWorld`. */
function worldToLonLat([x, z]: GroundPoint): LonLat {
  return [WORLD_ORIGIN.lon + x / (METRES_PER_DEGREE * LON_SCALE), WORLD_ORIGIN.lat - z / METRES_PER_DEGREE]
}

function toOutline(feature: PolygonFeature): GroundPoint[] {
  return feature.geometry.coordinates[0].map((position): GroundPoint => {
    const [x, , z] = lonLatToWorld(position)
    return [x, z]
  })
}

/** Outlines sorted into squares by their boxes, for asking quickly whether a point is inside one. */
class OutlineGrid {
  private readonly cells = new Map<number, GroundPoint[][]>()
  private static readonly CELL = 64
  add(outline: GroundPoint[]) {
    const xs = outline.map((p) => p[0])
    const zs = outline.map((p) => p[1])
    for (let cx = Math.floor(Math.min(...xs) / OutlineGrid.CELL); cx <= Math.floor(Math.max(...xs) / OutlineGrid.CELL); cx++) {
      for (let cz = Math.floor(Math.min(...zs) / OutlineGrid.CELL); cz <= Math.floor(Math.max(...zs) / OutlineGrid.CELL); cz++) {
        const key = (cx + 1000) * 2000 + (cz + 1000)
        const list = this.cells.get(key)
        if (list) list.push(outline)
        else this.cells.set(key, [outline])
      }
    }
  }
  contains(x: number, z: number): boolean {
    return (this.cells.get((Math.floor(x / OutlineGrid.CELL) + 1000) * 2000 + (Math.floor(z / OutlineGrid.CELL) + 1000)) ?? []).some((outline) => isInsideOutline(outline, x, z))
  }
}

/** The map's data is kept between builds of the world in the dev server: it's filled once, and the same infill given again. */
const filled = new WeakMap<BuildingFeature[], Infill>()

/**
 * Finds the empty plots along every preset street and fills them. Adds the new
 * buildings to `buildings` (and to `collisions`, as they're placed, so no two
 * overlap), and returns everything else for the parts that draw it.
 */
export function fillEmptyPlots(
  buildings: BuildingFeature[],
  roads: LineFeature[],
  pieces: RoadPiece[],
  index: RoadIndex,
  collisions: CollisionWorld,
  keepOut: { parks: PolygonFeature[]; areas: PolygonFeature[]; fuel: { lat: number; lng: number }[]; worship: PlaceOfWorship[] },
): Infill {
  const done = filled.get(buildings)
  if (done) {
    // Their footprints go into this build's collision world too.
    for (const building of done.buildings) addFootprint(collisions, building.geometry.coordinates[0].slice(0, -1).map((p) => { const [x, , z] = lonLatToWorld(p); return [x, z] as GroundPoint }))
    return done
  }
  const infill: Infill = { buildings: [], sites: [], parkedCars: [], hoardings: [], pumps: [], shrines: [] }
  filled.set(buildings, infill)

  const out = new OutlineGrid()
  for (const park of keepOut.parks) out.add(toOutline(park))
  for (const area of keepOut.areas) {
    if (!BUILDABLE_LAND.has(area.properties.landuse ?? '') || area.properties.amenity || area.properties.leisure) out.add(toOutline(area))
  }
  const fuelSpots = keepOut.fuel.map(({ lat, lng }) => lonLatToWorld([lng, lat]))
  const worshipSpots = keepOut.worship.flatMap((place) => (place.point ? [place.point] : []))
  const lastPump: GroundPoint[] = []
  const lastShrine: GroundPoint[] = [...worshipSpots]

  const testGround = (x: number, z: number) =>
    isInsideBounds(x, z, 4) &&
    !isNearBuilding(collisions, x, z, 0.6) &&
    isClearOfRoads(index, x, z, 1.2) &&
    !out.contains(x, z) &&
    fuelSpots.every(([fx, , fz]) => Math.hypot(fx - x, fz - z) > 45)
  // The plot sizes tried at one spot share most of their test points, so each point's answer is
  // kept, on a 25 cm grid, until something is built (which can change it).
  let known = new Map<number, boolean>()
  const isFree = (x: number, z: number) => {
    const key = (Math.round(x * 4) + 40000) * 80000 + (Math.round(z * 4) + 40000)
    let free = known.get(key)
    if (free === undefined) {
      free = testGround(x, z)
      known.set(key, free)
    }
    return free
  }
  const forget = () => {
    known = new Map()
  }

  if (import.meta.env.DEV) {
    // Debug: why a spot is or isn't built on.
    ;(window as unknown as { __deliverItInfill?: unknown }).__deliverItInfill = infill
    ;(window as unknown as { __deliverItInfillWhy?: unknown }).__deliverItInfillWhy = (x: number, z: number) => ({
      inside: isInsideBounds(x, z, 4),
      clearOfBuildings: !isNearBuilding(collisions, x, z, 0.6),
      clearOfRoads: isClearOfRoads(index, x, z, 1.2),
      outsideKeptLand: !out.contains(x, z),
      awayFromFuel: fuelSpots.every(([fx, , fz]) => Math.hypot(fx - x, fz - z) > 45),
    })
  }
  pieces.forEach((piece, pieceNumber) => {
    const road = roads[piece.road]
    const preset = streetPresetOf(road)
    if (!preset) return
    const rule = RULES[preset.name]
    const dx = piece.end[0] - piece.start[0]
    const dz = piece.end[1] - piece.start[1]
    const length = Math.hypot(dx, dz)
    if (length < 2) return
    const along: GroundPoint = [dx / length, dz / length]
    const random = streetRandom(road, pieceNumber * 7919 + 17)

    for (const side of [1, -1]) {
      // Out from the road on this side: a quarter turn from along.
      const outward: GroundPoint = side > 0 ? [-along[1], along[0]] : [along[1], -along[0]]
      // The plot's front: behind the footpath, and the yard or forecourt.
      const behindFootpath = piece.width / 2 + preset.footpath
      const at = (s: number, o: number): GroundPoint => [piece.start[0] + along[0] * s + outward[0] * o, piece.start[1] + along[1] * s + outward[1] * o]
      // Faces the road: out of its front is towards the road, the opposite of outward.
      const rotation = Math.atan2(-outward[0], -outward[1])

      /** Whether a plot from s along, `width` wide and `depth` deep, is all clear. */
      const plotIsFree = (s: number, width: number, depth: number, from = behindFootpath + rule.setback) => {
        for (let i = 0; i <= 3; i++) {
          for (let j = 0; j <= 3; j++) {
            const [x, z] = at(s + (width * i) / 3, from + (depth * j) / 3)
            if (!isFree(x, z)) return false
          }
        }
        return true
      }
      /** How far along from s the ground stays free, for a plot `depth` deep, up to `most`. */
      const freeRun = (s: number, depth: number, most: number) => {
        let run = 0
        while (run + 2 <= most && plotIsFree(s + run, 2, depth)) run += 2
        return run
      }

      // Plots start along this piece but may run on past its end: the map splits a street into short
      // pieces at every node, and the clearance checks stop a plot at a side road or a building anyway.
      let s = 0.5
      while (s < length) {
        const width = rule.width[0] + random() * (rule.width[1] - rule.width[0])
        // A full plot if there's room; if a building stands further back, a shallower one in front of it
        // (a row of one-room shops, a small house), so no deep strip of bare earth is left by the road.
        const full = rule.depth[0] + random() * (rule.depth[1] - rule.depth[0])
        // On a narrow strip a house can also stand nearer the road, behind a shallow yard.
        const tries = [full, ...SHALLOWER[preset.name]].map((depth) => ({ depth, setback: rule.setback }))
        if (preset.name === 'residential') tries.push({ depth: 6.5, setback: NARROW_YARD })
        const fit = tries.find(({ depth, setback }) => plotIsFree(s, width, depth, behindFootpath + setback))
        if (!fit) {
          s += 2
          continue
        }
        const depth = fit.depth
        const front = behindFootpath + fit.setback
        const middle = at(s + width / 2, front + depth / 2)

        if (preset.name === 'main') {
          // A long gap: perhaps a petrol pump, or a little temple.
          const run = freeRun(s, 18, PUMP_GAP + 4)
          if (run >= PUMP_GAP && lastPump.every(([px, pz]) => Math.hypot(px - middle[0], pz - middle[1]) > PUMP_SPACING) && random() < 0.6) {
            const spot = at(s + PUMP_GAP / 2, front + 6)
            const [lng, lat] = worldToLonLat(spot)
            infill.pumps.push({ lat, lng })
            lastPump.push(spot)
            s += PUMP_GAP + 4
            continue
          }
          if (lastShrine.every(([px, pz]) => Math.hypot(px - middle[0], pz - middle[1]) > SHRINE_SPACING) && random() < 0.25) {
            const spot = at(s + width / 2, front + 4)
            infill.shrines.push({ faith: 'hindu', buildingIds: [], point: spot })
            lastShrine.push(spot)
            s += width + 2
            continue
          }
          if (random() < HOARDING_SHARE) {
            const [x, z] = at(s + width / 2, front + 1)
            infill.hoardings.push({ x, z, rotation, width: Math.min(width - 1, 7), poster: Math.floor(random() * 8) })
            addPost(collisions, x, z, 0.4)
            forget()
            s += width + 1
            continue
          }
        }

        if (preset.name === 'residential' && random() < SITE_SHARE) {
          infill.sites.push({ x: middle[0], z: middle[1], rotation, width, depth, floors: 2 + Math.floor(random() * 2), seed: Math.floor(random() * 1e6) })
          const corners = [at(s, front), at(s + width, front), at(s + width, front + depth), at(s, front + depth)]
          addFootprint(collisions, corners)
          forget()
          s += width + rule.gap[1]
          continue
        }

        // A building: houses on residential streets, shops on the others.
        const corners: GroundPoint[] = [at(s, front), at(s + width, front), at(s + width, front + depth), at(s, front + depth)]
        const ring = [...corners, corners[0]].map(worldToLonLat)
        const floors = Math.min(depth < 9 ? 2 : Infinity, rule.floors[0] + Math.floor(random() * (rule.floors[1] - rule.floors[0] + 1)))
        const kind = preset.name === 'residential' ? 'house' : 'shop'
        const building: BuildingFeature = {
          id: `infill/${road.id}/${pieceNumber}/${side}/${Math.round(s)}`,
          properties: { building: kind === 'house' ? 'house' : 'retail', 'building:levels': String(floors) },
          geometry: { type: 'Polygon', coordinates: [ring] },
          kind,
        }
        buildings.push(building)
        infill.buildings.push(building)
        addFootprint(collisions, corners)
        forget()

        // A car in the yard, beside the gate, parallel to the wall.
        if (kind === 'house' && fit.setback >= 2.5 && random() < CAR_SHARE) {
          const [x, z] = at(s + width * 0.72, front - fit.setback / 2)
          infill.parkedCars.push({ x, z, rotation: Math.atan2(along[0], along[1]) + (random() < 0.5 ? 0 : Math.PI), variation: random(), car: true })
          addPost(collisions, x, z, 1.1)
          forget()
        }
        s += width + rule.gap[0] + random() * (rule.gap[1] - rule.gap[0])
      }
    }
  })
  return infill
}
