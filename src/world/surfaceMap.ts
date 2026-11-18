import type { LineFeature, MapData, PolygonFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { streetPresetOf } from './streetPresets'
import { PAVEMENT_WIDTH } from './surface'
import { lonLatToWorld, PLAY_AREA, PLAY_AREA_DEPTH, PLAY_AREA_WIDTH, type GroundPoint, type LonLat } from './worldUtils'

/*
 * One map of what the ground is, for the whole city, a metre to a cell: road, median, footpath,
 * paved ground (forecourts, parking, school yards), building, park, empty plot, or open ground.
 * It's drawn from the road geometry (and each street's footpath and median widths), the building
 * footprints and OSM's land-use tags, and every placement system asks it before putting anything
 * down (`allows`): grass, trees, bushes, poles, props, parked vehicles, fences and buildings. The
 * grass shader reads it too, as an image.
 *
 * Drawn in order of priority, each over the last: land use, parks, plots, paved ground,
 * footpaths, buildings, roads, medians. So a road always wins, and a footpath over a park is
 * still a footpath.
 */

export const Surface = {
  Open: 0,
  Road: 1,
  Median: 2,
  Footpath: 3,
  Paved: 4,
  Building: 5,
  Park: 6,
  Plot: 7,
  /** A lake: nothing is placed on it. */
  Water: 8,
} as const
export type Surface = (typeof Surface)[keyof typeof Surface]

export const SURFACE_NAMES = ['open ground', 'road', 'median', 'footpath', 'paved', 'building', 'park', 'plot', 'water'] as const

/** What may go where. */
export type Placement = 'grass' | 'tree' | 'bush' | 'pole' | 'prop' | 'bench' | 'pedestrian' | 'parked' | 'footpathBike' | 'fence' | 'building' | 'decal'

const ALLOWED: Record<Placement, Surface[]> = {
  // Roads and junctions carry only traffic, markings and decals.
  grass: [Surface.Open, Surface.Median, Surface.Park, Surface.Plot],
  tree: [Surface.Open, Surface.Median, Surface.Footpath, Surface.Park],
  bush: [Surface.Open, Surface.Median, Surface.Park],
  pole: [Surface.Footpath, Surface.Median, Surface.Open, Surface.Paved],
  prop: [Surface.Footpath, Surface.Open, Surface.Paved, Surface.Park, Surface.Plot],
  bench: [Surface.Park, Surface.Footpath],
  pedestrian: [Surface.Footpath, Surface.Paved, Surface.Park, Surface.Open],
  parked: [Surface.Road],
  footpathBike: [Surface.Footpath, Surface.Paved],
  fence: [Surface.Open, Surface.Park, Surface.Paved, Surface.Plot, Surface.Building],
  building: [Surface.Open, Surface.Plot, Surface.Building],
  decal: [Surface.Road, Surface.Paved, Surface.Footpath],
}

/** Land-use tags and what they make the ground. */
const PAVED_TAGS = new Set(['amenity=fuel', 'amenity=parking', 'parking=surface', 'amenity=motorcycle_parking', 'amenity=marketplace', 'amenity=bus_station', 'amenity=school', 'amenity=college', 'amenity=kindergarten'])
const PARK_TAGS = new Set(['leisure=park', 'leisure=garden', 'leisure=playground', 'leisure=pitch', 'leisure=common', 'landuse=recreation_ground', 'landuse=grass', 'landuse=meadow', 'natural=grassland', 'landuse=cemetery'])
const PLOT_TAGS = new Set(['landuse=construction', 'landuse=brownfield', 'landuse=greenfield'])

function tagSurface({ properties }: PolygonFeature): Surface | null {
  const tags = ['amenity', 'leisure', 'landuse', 'natural', 'parking'].map((key) => `${key}=${properties[key as keyof typeof properties] ?? ''}`)
  if (tags.some((tag) => PAVED_TAGS.has(tag))) return Surface.Paved
  if (tags.some((tag) => PLOT_TAGS.has(tag))) return Surface.Plot
  if (tags.some((tag) => PARK_TAGS.has(tag))) return Surface.Park
  return null
}

export class SurfaceMap {
  readonly width = Math.ceil(PLAY_AREA_WIDTH)
  readonly depth = Math.ceil(PLAY_AREA_DEPTH)
  readonly cells = new Uint8Array(this.width * this.depth)

  /** The ground at a point. Outside the play area, open ground. */
  at(x: number, z: number): Surface {
    const column = Math.floor(x - PLAY_AREA.minX)
    const row = Math.floor(z - PLAY_AREA.minZ)
    if (column < 0 || row < 0 || column >= this.width || row >= this.depth) return Surface.Open
    return this.cells[row * this.width + column] as Surface
  }

  allows(x: number, z: number, what: Placement): boolean {
    return ALLOWED[what].includes(this.at(x, z))
  }

  /** Whether every point round a circle allows it: a thing with some size must fit whole. */
  allowsAround(x: number, z: number, radius: number, what: Placement): boolean {
    if (!this.allows(x, z, what)) return false
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      if (!this.allows(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, what)) return false
    }
    return true
  }

  /** Fills a polygon (scanline, even-odd), only over cells of the given kinds if `over` is given. */
  fillPolygon(points: GroundPoint[], kind: Surface, over?: Surface[]) {
    if (points.length < 3) return
    const local = points.map(([x, z]) => [x - PLAY_AREA.minX, z - PLAY_AREA.minZ])
    const zs = local.map(([, z]) => z)
    const top = Math.max(0, Math.floor(Math.min(...zs)))
    const bottom = Math.min(this.depth - 1, Math.ceil(Math.max(...zs)))
    const crossings: number[] = []
    for (let row = top; row <= bottom; row++) {
      const z = row + 0.5
      crossings.length = 0
      for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
        const [ax, az] = local[j]
        const [bx, bz] = local[i]
        if (az > z !== bz > z) crossings.push(ax + ((z - az) / (bz - az)) * (bx - ax))
      }
      crossings.sort((a, b) => a - b)
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(crossings[k] - 0.5))
        const to = Math.min(this.width - 1, Math.floor(crossings[k + 1] - 0.5))
        for (let column = from; column <= to; column++) this.set(row * this.width + column, kind, over)
      }
    }
  }

  /** A thick line with round ends: a road or footpath along a centre line. */
  strokeLine(points: GroundPoint[], width: number, kind: Surface, over?: Surface[]) {
    const half = width / 2
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, az] = points[i]
      const [bx, bz] = points[i + 1]
      const length = Math.hypot(bx - ax, bz - az)
      if (length === 0) continue
      const sideX = (-(bz - az) / length) * half
      const sideZ = ((bx - ax) / length) * half
      this.fillPolygon([[ax + sideX, az + sideZ], [bx + sideX, bz + sideZ], [bx - sideX, bz - sideZ], [ax - sideX, az - sideZ]], kind, over)
    }
    for (const [x, z] of points) this.fillDisc(x, z, half, kind, over)
  }

  fillDisc(x: number, z: number, radius: number, kind: Surface, over?: Surface[]) {
    const cx = x - PLAY_AREA.minX
    const cz = z - PLAY_AREA.minZ
    for (let row = Math.max(0, Math.floor(cz - radius)); row <= Math.min(this.depth - 1, Math.ceil(cz + radius)); row++) {
      for (let column = Math.max(0, Math.floor(cx - radius)); column <= Math.min(this.width - 1, Math.ceil(cx + radius)); column++) {
        if (Math.hypot(column + 0.5 - cx, row + 0.5 - cz) <= radius) this.set(row * this.width + column, kind, over)
      }
    }
  }

  private set(index: number, kind: Surface, over?: Surface[]) {
    if (over && !over.includes(this.cells[index] as Surface)) return
    this.cells[index] = kind
  }

  /** How many cells of each kind: for the debug report. */
  counts(): Record<string, number> {
    const counts = new Array(SURFACE_NAMES.length).fill(0)
    for (const cell of this.cells) counts[cell]++
    return Object.fromEntries(SURFACE_NAMES.map((name, kind) => [name, counts[kind]]))
  }
}

const toGround = (position: LonLat): GroundPoint => {
  const [x, , z] = lonLatToWorld(position)
  return [x, z]
}

function roadPoints(road: LineFeature): GroundPoint[] {
  return road.geometry.coordinates.map(toGround)
}

/** How wide a median strip is down the middle of a two-way road whose preset has one, if this road gets one. */
function medianWidth(road: LineFeature): number {
  const median = streetPresetOf(road)?.median
  if (!median || road.properties.oneway === 'yes' || getRoadWidth(road) < median.minRoadWidth) return 0
  return median.width
}

/** On a dual carriageway (two one-way roads), the gap between them is a median if it's at most this wide, in metres. */
const DUAL_GAP = 12

/**
 * Draws the city's ground. `paved` adds outlines that are paved though the map doesn't say so
 * (shop forecourts, petrol bunk forecourts); `plots` adds building sites and empty plots.
 */
export function createSurfaceMap(data: MapData, extra: { paved?: GroundPoint[][]; plots?: GroundPoint[][] } = {}): SurfaceMap {
  const map = new SurfaceMap()
  for (const area of data.areas) {
    const kind = tagSurface(area)
    if (kind !== null) map.fillPolygon(area.geometry.coordinates[0].map(toGround), kind)
  }
  for (const park of data.parks) map.fillPolygon(park.geometry.coordinates[0].map(toGround), Surface.Park)
  for (const plot of extra.plots ?? []) map.fillPolygon(plot, Surface.Plot)
  for (const outline of extra.paved ?? []) map.fillPolygon(outline, Surface.Paved)

  // Footpaths: the band each side of a road, as wide as its street's footpath.
  for (const road of data.roads) {
    const footpath = streetPresetOf(road)?.footpath ?? PAVEMENT_WIDTH
    map.strokeLine(roadPoints(road), getRoadWidth(road) + footpath * 2, Surface.Footpath)
  }
  for (const path of data.footways) map.strokeLine(path.geometry.coordinates.map(toGround), 2, Surface.Footpath, [Surface.Open, Surface.Park, Surface.Plot])

  for (const building of data.buildings) map.fillPolygon(building.geometry.coordinates[0].map(toGround), Surface.Building)
  for (const road of data.roads) map.strokeLine(roadPoints(road), getRoadWidth(road), Surface.Road)

  // Medians: down the middle of two-way main roads, and the gap between the two halves of a
  // dual carriageway (two one-way roads close together), which isn't footpath but a median.
  for (const road of data.roads) {
    const width = medianWidth(road)
    if (width > 0) map.strokeLine(roadPoints(road), width, Surface.Median)
  }
  for (const road of data.roads) {
    if (road.properties.oneway !== 'yes' || !streetPresetOf(road)?.median) continue
    const points = roadPoints(road)
    const half = getRoadWidth(road) / 2
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, az] = points[i]
      const [bx, bz] = points[i + 1]
      const length = Math.hypot(bx - ax, bz - az)
      if (length === 0) continue
      const sideX = -(bz - az) / length
      const sideZ = (bx - ax) / length
      for (let along = 0; along <= length; along += 1) {
        const x = ax + ((bx - ax) * along) / length
        const z = az + ((bz - az) * along) / length
        for (const side of [1, -1]) {
          // Out from this road's edge: is there another road close by on this side?
          let gap = -1
          for (let out = 1; out <= DUAL_GAP; out++) {
            if (map.at(x + sideX * side * (half + out), z + sideZ * side * (half + out)) === Surface.Road) {
              gap = out
              break
            }
          }
          if (gap <= 1) continue
          for (let out = 0.5; out < gap; out += 0.5) {
            const px = x + sideX * side * (half + out)
            const pz = z + sideZ * side * (half + out)
            map.fillDisc(px, pz, 0.6, Surface.Median, [Surface.Footpath, Surface.Open, Surface.Park])
          }
        }
      }
    }
  }
  return map
}

/**
 * The world's surface map, once planned (World.tsx); placement code reads it from here.
 * `rejected` counts refusals and `report` what the placement fixes moved or removed, for the
 * debug view.
 */
export const worldSurface = { map: null as SurfaceMap | null, rejected: {} as Partial<Record<Placement, number>>, report: {} as Record<string, Record<string, number>> }

/** Whether the ground at a point allows something. Before the map exists, anything goes. */
export function surfaceAllows(x: number, z: number, what: Placement): boolean {
  if (!worldSurface.map) return true
  const allowed = worldSurface.map.allows(x, z, what)
  if (!allowed) worldSurface.rejected[what] = (worldSurface.rejected[what] ?? 0) + 1
  return allowed
}
