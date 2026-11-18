import type { BuildingFeature, MapData } from './mapData'
import { distanceToPiece, forEachRoadNear, type RoadIndex, type RoadPiece } from './props'
import { streetPresetOf, WIDEST_FOOTPATH } from './streetPresets'
import { PAVEMENT_WIDTH } from './surface'
import { isInsideOutline, isRingInPlayArea, lonLatToWorld, worldToLonLat, type GroundPoint } from './worldUtils'

/*
 * No building stands on a road or its footpath. The map's footprints and our road widths don't
 * always agree, so some outlines reach over the footpath or into the carriageway. Each footprint
 * is measured against every road near it (the road plus its street's footpath each side):
 *
 * - a small overlap: the building is trimmed back to the footpath's far edge, as if it had been
 *   built behind it (trimming rather than shifting, so it doesn't walk into its neighbour);
 * - a large overlap: what's left behind the footpath, if it's still a house-sized piece, is a
 *   smaller building; otherwise the building goes and that piece becomes a walled plot.
 *
 * Runs before anything looks at the buildings (collisions, shops, the house kit).
 */

/** Overlaps of up to this share of the footprint are small: trim. */
const SMALL_OVERLAP = 0.3
/** A trimmed building must keep this much of itself, and this many square metres, or it's not the same building any more. */
const KEEP_SHARE = 0.55
const SMALLEST_BUILDING = 28
/** Thinner than this, in metres (twice area over perimeter), a piece is a sliver, not a building. */
const THINNEST = 2.2
/** A plot left behind is walled only if it's at least this big. */
const SMALLEST_PLOT = 20
/** The trim stands this far back from the footpath edge, so the wall isn't flush with the paving. */
const MARGIN = 0.2
/** Rounds of trimming against the most-overlapped road: a corner building can need two or three. */
const TRIM_ROUNDS = 6

export type SetbackReport = { checked: number; clear: number; trimmed: number; replaced: number; removed: number; walledPlots: number }

type Clearance = { piece: RoadPiece; need: number }

/** Road pieces are searched this far round a point: the road index already allows for half the road. */
const REACH = WIDEST_FOOTPATH + 0.5

/** Each road's footpath width, looked up once per pass. */
let footpaths: Float32Array = new Float32Array(0)

/** How far from a road piece's centre line a building must stay: half the road and its footpath. */
function clearanceOf(_data: MapData, piece: RoadPiece): number {
  return piece.width / 2 + footpaths[piece.road]
}

/** Interior test points are this far apart, in metres. */
const SAMPLE_STEP = 1.5

/** Points to test a footprint with: a grid inside it, and its corners. */
function samplePoints(outline: GroundPoint[]): GroundPoint[] {
  const xs = outline.map(([x]) => x)
  const zs = outline.map(([, z]) => z)
  const points: GroundPoint[] = [...outline]
  for (let x = Math.floor(Math.min(...xs)) + 0.5; x < Math.max(...xs); x += SAMPLE_STEP) {
    for (let z = Math.floor(Math.min(...zs)) + 0.5; z < Math.max(...zs); z += SAMPLE_STEP) {
      if (isInsideOutline(outline, x, z)) points.push([x, z])
    }
  }
  return points
}

/** Whether a point is on a road or its footpath. */
function isOnRoad(data: MapData, roads: RoadIndex, x: number, z: number): boolean {
  let on = false
  forEachRoadNear(roads, x, z, REACH, (piece) => {
    if (!on && distanceToPiece(x, z, piece) < clearanceOf(data, piece)) on = true
  })
  return on
}

/**
 * Whether a footprint is clear, checked round its edge every metre: a road or footpath can only
 * reach in by crossing the edge (no footprint is big enough to hold a road whole). Most are
 * clear, and this is much cheaper than the full count below.
 */
function isClear(data: MapData, roads: RoadIndex, outline: GroundPoint[]): boolean {
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]
    const [bx, bz] = outline[(i + 1) % outline.length]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
    for (let step = 0; step < steps; step++) {
      if (isOnRoad(data, roads, ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps)) return false
    }
  }
  return true
}

/** Points round a footprint's edge, a metre apart. */
function edgePoints(outline: GroundPoint[]): GroundPoint[] {
  const points: GroundPoint[] = []
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]
    const [bx, bz] = outline[(i + 1) % outline.length]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
    for (let step = 0; step < steps; step++) points.push([ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps])
  }
  return points
}

/** Of some points, the share on a road or footpath, and the road pieces they're deepest in, most points first. */
function measure(data: MapData, roads: RoadIndex, points: GroundPoint[]): { share: number; ranked: Clearance[] } {
  const tally = new Map<RoadPiece, number>()
  let over = 0
  for (const [x, z] of points) {
    let hit: RoadPiece | null = null
    let depth = 0
    forEachRoadNear(roads, x, z, REACH, (piece) => {
      const into = clearanceOf(data, piece) - distanceToPiece(x, z, piece)
      if (into > depth) {
        depth = into
        hit = piece
      }
    })
    if (hit) {
      over++
      tally.set(hit, (tally.get(hit) ?? 0) + 1)
    }
  }
  const ranked = [...tally].sort((a, b) => b[1] - a[1]).map(([piece]) => ({ piece, need: clearanceOf(data, piece) }))
  return { share: points.length ? over / points.length : 0, ranked }
}

function area(outline: GroundPoint[]): number {
  let doubled = 0
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]
    const [bx, bz] = outline[(i + 1) % outline.length]
    doubled += ax * bz - bx * az
  }
  return Math.abs(doubled) / 2
}

function perimeter(outline: GroundPoint[]): number {
  let total = 0
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]
    const [bx, bz] = outline[(i + 1) % outline.length]
    total += Math.hypot(bx - ax, bz - az)
  }
  return total
}

/**
 * Cuts a footprint along a line parallel to a road piece, `need` from its centre line, keeping
 * one side of it (Sutherland-Hodgman against one half-plane). Pieces are short and straight, so
 * the cut follows the road where it is.
 */
function trimAgainst(outline: GroundPoint[], { piece, need }: Clearance, keep: 1 | -1): GroundPoint[] {
  const [sx, sz] = piece.start
  const [ex, ez] = piece.end
  const length = Math.hypot(ex - sx, ez - sz) || 1
  const nx = (-(ez - sz) / length) * keep
  const nz = ((ex - sx) / length) * keep
  const offset = need + MARGIN
  const side = ([x, z]: GroundPoint) => (x - sx) * nx + (z - sz) * nz - offset
  const kept: GroundPoint[] = []
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    const da = side(a)
    const db = side(b)
    if (da >= 0) kept.push(a)
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db)
      kept.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return kept
}

/** How many of the most-overlapped road pieces each round tries cutting against. */
const CANDIDATES = 3

/**
 * Trims round by round: each round tries a cut against each of the roads it overlaps most, on
 * either side, and keeps the one that leaves the most building. Null if it can't be cleared.
 */
function trimClear(data: MapData, roads: RoadIndex, outline: GroundPoint[]): GroundPoint[] | null {
  let current = outline
  for (let round = 0; round < TRIM_ROUNDS; round++) {
    const { share, ranked } = measure(data, roads, edgePoints(current))
    if (share === 0) return current
    let best: GroundPoint[] | null = null
    let bestArea = 0
    for (const clearance of ranked.slice(0, CANDIDATES)) {
      for (const keep of [1, -1] as const) {
        const cut = trimAgainst(current, clearance, keep)
        const cutArea = cut.length >= 3 ? area(cut) : 0
        if (cutArea > bestArea) {
          best = cut
          bestArea = cutArea
        }
      }
    }
    if (!best) return null
    current = best
  }
  return isClear(data, roads, current) ? current : null
}

const isSolidPiece = (outline: GroundPoint[]) => outline.length >= 3 && (2 * area(outline)) / perimeter(outline) >= THINNEST

function toRing(outline: GroundPoint[]): BuildingFeature['geometry']['coordinates'][0] {
  const ring = outline.map(([x, z]) => worldToLonLat(x, z))
  return [...ring, ring[0]]
}

/**
 * Sets every building clear of the roads and footpaths, changing `data.buildings` in place.
 * Returns the report and the outlines of plots left where a building was taken away, to be
 * walled.
 */
export function setBuildingsBack(data: MapData, roads: RoadIndex): { report: SetbackReport; plots: GroundPoint[][] } {
  footpaths = Float32Array.from(data.roads, (road) => streetPresetOf(road)?.footpath ?? PAVEMENT_WIDTH)
  const report: SetbackReport = { checked: 0, clear: 0, trimmed: 0, replaced: 0, removed: 0, walledPlots: 0 }
  const plots: GroundPoint[][] = []
  const kept: BuildingFeature[] = []
  for (const building of data.buildings) {
    const ring = building.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) {
      kept.push(building)
      continue
    }
    report.checked++
    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    if (isClear(data, roads, outline)) {
      report.clear++
      kept.push(building)
      continue
    }
    const { share } = measure(data, roads, samplePoints(outline))
    const before = area(outline)
    const trimmed = trimClear(data, roads, outline)
    const after = trimmed ? area(trimmed) : 0
    const fits = trimmed !== null && after >= SMALLEST_BUILDING && isSolidPiece(trimmed)
    if (fits && share <= SMALL_OVERLAP && after >= before * KEEP_SHARE) {
      building.geometry.coordinates[0] = toRing(trimmed)
      report.trimmed++
      kept.push(building)
    } else if (fits) {
      // A smaller building on what's left of the plot.
      building.geometry.coordinates[0] = toRing(trimmed)
      report.replaced++
      kept.push(building)
    } else {
      report.removed++
      if (trimmed && after >= SMALLEST_PLOT && isSolidPiece(trimmed)) {
        plots.push(trimmed)
        report.walledPlots++
      }
    }
  }
  data.buildings.length = 0
  data.buildings.push(...kept)
  return { report, plots }
}

