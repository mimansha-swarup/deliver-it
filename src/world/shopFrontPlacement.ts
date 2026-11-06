import { findNearestWall, type CollisionWorld } from './collision'
import type { PointFeature } from './mapData'
import { isInsideBounds, lonLatToWorld } from './worldUtils'

export type ShopFront = {
  x: number
  z: number
  /** Which way it faces, in radians around Y. */
  rotation: number
  width: number
  /** A 0 to 1 value used to pick a colour. */
  variation: number
}

/** A mapped shop or cafe is usually within this distance of its building, in metres. */
const MAX_WALL_DISTANCE = 16
const MIN_WALL_LENGTH = 3
const MAX_AWNING_WIDTH = 7
/** Two awnings closer than this would overlap, in metres. */
const MIN_SPACING = 5

/** A stable 0 to 1 number from a map feature's id, so colours never change. */
function hashToUnit(text: string): number {
  let hash = 0
  for (const character of text) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  return (hash >>> 0) / 4294967296
}

/** Gives each mapped shop, cafe and restaurant an awning on its nearest wall. */
export function generateShopFronts(places: PointFeature[], collisions: CollisionWorld): ShopFront[] {
  const fronts: ShopFront[] = []

  for (const place of places) {
    const { shop, amenity } = place.properties
    if (!shop && amenity !== 'restaurant' && amenity !== 'cafe' && amenity !== 'fast_food') continue

    const [x, , z] = lonLatToWorld(place.geometry.coordinates)
    if (!isInsideBounds(x, z)) continue

    const wall = findNearestWall(collisions, x, z, MAX_WALL_DISTANCE)
    if (!wall || wall.length < MIN_WALL_LENGTH) continue
    if (fronts.some((front) => Math.hypot(front.x - wall.x, front.z - wall.z) < MIN_SPACING)) continue

    fronts.push({
      x: wall.x,
      z: wall.z,
      rotation: Math.atan2(wall.normalX, wall.normalZ),
      width: Math.min(wall.length * 0.8, MAX_AWNING_WIDTH),
      variation: hashToUnit(place.id),
    })
  }

  return fronts
}
