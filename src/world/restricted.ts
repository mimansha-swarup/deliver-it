import { addWall, type CollisionWorld } from './collision'
import type { LineFeature, PolygonFeature } from './mapData'
import { clipToPlayArea } from './roadGeometry'
import { isInsideOutline, lonLatToWorld, type GroundPoint, type LonLat } from './worldUtils'

/** The wall round military land, in metres. */
export const WALL = { thickness: 0.3, height: 3, band: 0.6 }
/** Solid to the scooter this far inside the wall too, so even a fast scooter can't get through it in one frame. */
const SOLID_INSIDE = 1.5

/**
 * Land nobody may enter: military ground. It's walled off, and no road, path or
 * delivery goes inside.
 */
export function isRestricted(area: PolygonFeature): boolean {
  return area.properties.landuse === 'military'
}

/** The ray test (see `measureFootprint` in collision.ts), on longitude and latitude, which is fine over a few kilometres. */
function isInside(ring: LonLat[], [x, y]: LonLat): boolean {
  let inside = false
  for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
    const [ax, ay] = ring[previous]
    const [bx, by] = ring[i]
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside
  }
  return inside
}

/** Where, from 0 to 1 along a to b, the line crosses each edge of the rings. */
function crossings(rings: LonLat[][], [ax, ay]: LonLat, [bx, by]: LonLat): number[] {
  const found: number[] = []
  for (const ring of rings) {
    for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
      const [cx, cy] = ring[previous]
      const [dx, dy] = ring[i]
      const denominator = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
      if (denominator === 0) continue
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denominator
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denominator
      if (t > 0 && t < 1 && u >= 0 && u <= 1) found.push(t)
    }
  }
  return found.sort((first, second) => first - second)
}

/**
 * Cuts every line where it enters restricted land, and keeps only the parts
 * outside. A road running in through a gate now stops at the wall.
 */
export function cutOutRestricted(lines: LineFeature[], zones: PolygonFeature[]): LineFeature[] {
  if (zones.length === 0) return lines
  const rings = zones.map((zone) => zone.geometry.coordinates[0])
  const inside = (point: LonLat) => rings.some((ring) => isInside(ring, point))
  const kept: LineFeature[] = []

  for (const line of lines) {
    const points = line.geometry.coordinates
    const keep = (run: LonLat[]) => {
      if (run.length >= 2) kept.push({ ...line, geometry: { type: 'LineString', coordinates: run } })
    }

    let isIn = inside(points[0])
    let run: LonLat[] = isIn ? [] : [points[0]]
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]]
      for (const t of crossings(rings, a, b)) {
        const point: LonLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        if (isIn) {
          run = [point]
        } else {
          run.push(point)
          keep(run)
          run = []
        }
        isIn = !isIn
      }
      if (!isIn) run.push(b)
    }
    keep(run)
  }
  return kept
}

/** One straight stretch of the wall, inside the play area, and which way is outside. */
export type WallEdge = { start: GroundPoint; end: GroundPoint; outX: number; outZ: number }

export function findWallEdges(zones: PolygonFeature[]): WallEdge[] {
  const edges: WallEdge[] = []
  for (const zone of zones) {
    const outline = zone.geometry.coordinates[0].slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    outline.forEach((corner, index) => {
      const next = outline[(index + 1) % outline.length]
      const clipped = clipToPlayArea(corner, next)
      if (!clipped) return
      const [start, end] = clipped
      const length = Math.hypot(end[0] - start[0], end[1] - start[1])
      if (length < 0.1) return
      // A quarter turn from the edge, pointing whichever way isn't inside.
      let outX = (end[1] - start[1]) / length
      let outZ = -(end[0] - start[0]) / length
      const middleX = (start[0] + end[0]) / 2
      const middleZ = (start[1] + end[1]) / 2
      if (isInsideOutline(outline, middleX + outX, middleZ + outZ)) {
        outX = -outX
        outZ = -outZ
      }
      edges.push({ start, end, outX, outZ })
    })
  }
  return edges
}

/** Makes the wall solid, with most of its thickness on the inside, out of sight. */
export function addRestrictedWalls(collisions: CollisionWorld, zones: PolygonFeature[]) {
  const thickness = WALL.thickness / 2 + SOLID_INSIDE
  for (const { start, end, outX, outZ } of findWallEdges(zones)) {
    // `addWall` centres its thickness on the line, so the line is moved in by half of it.
    const shift = WALL.thickness / 2 - thickness / 2
    addWall(
      collisions,
      [start[0] + outX * shift, start[1] + outZ * shift],
      [end[0] + outX * shift, end[1] + outZ * shift],
      thickness,
    )
  }
}

