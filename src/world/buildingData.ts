import type { BuildingKind } from './buildingKinds'
import type { BuildingFeature, PolygonFeature } from './mapData'
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
export function getFootprintArea(building: PolygonFeature): number {
  const points = building.geometry.coordinates[0].slice(0, -1).map(lonLatToLocal)

  let doubled = 0
  points.forEach(([x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]
    doubled += x * nextY - nextX * y
  })
  return Math.abs(doubled) / 2
}

/** The shortest a building of each kind gets, and how many floors it can add to that. */
const FLOOR_RANGES: Record<BuildingKind, { lowest: number; extra: number }> = {
  house: { lowest: 2, extra: 2 },
  apartment: { lowest: 4, extra: 3 },
  shop: { lowest: 2, extra: 3 },
  office: { lowest: 4, extra: 4 },
  civic: { lowest: 2, extra: 2 },
}
/** A house smaller than this is a little single-storey or two-storey place, in square metres. */
const TINY_HOUSE = 60

/** Uses the mapped floor count if there is one, otherwise estimates from its kind. */
export function getFloors(building: BuildingFeature): number {
  const mapped = Number(building.properties['building:levels'])
  if (mapped > 0) return mapped

  const hash = hashString(building.id)
  if (building.kind === 'house' && getFootprintArea(building) < TINY_HOUSE) return 1 + (hash % 2)

  const { lowest, extra } = FLOOR_RANGES[building.kind]
  return lowest + (hash % extra)
}
