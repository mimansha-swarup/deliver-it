import type { PolygonFeature } from './mapData'
import { lonLatToLocal } from './worldUtils'

/** Height of one storey, in metres. */
export const FLOOR_HEIGHT = 3.2

/**
 * Turns text into a stable number (FNV-1a hash). A building's "random" height
 * and colour come from its id, so it looks the same on every page load.
 */
export function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  }
  return hash >>> 0
}

/** The area of a building's outline in square metres, by the shoelace formula. */
function getFootprintArea(building: PolygonFeature): number {
  const points = building.geometry.coordinates[0].slice(0, -1).map(lonLatToLocal)

  let doubled = 0
  points.forEach(([x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]
    doubled += x * nextY - nextX * y
  })
  return Math.abs(doubled) / 2
}

/** Uses the mapped floor count if there is one, otherwise estimates from size. */
export function getFloors(building: PolygonFeature): number {
  const mapped = Number(building.properties['building:levels'])
  if (mapped > 0) return mapped

  const footprintArea = getFootprintArea(building)
  const variation = hashString(building.id) % 3
  if (footprintArea < 60) return 1 + (variation % 2) // 1 or 2
  if (footprintArea > 400) return 3 + variation // 3 to 5
  return 2 + variation // 2 to 4
}
