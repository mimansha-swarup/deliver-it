import { findNearestWall, type CollisionWorld } from './collision'
import type { ShopUnit } from './houseKit'
import type { PointFeature } from './mapData'
import { typeByChance, typeForPlace, type ShopType } from './signboards'
import { isInsideBounds, lonLatToWorld, type GroundPoint } from './worldUtils'

export type ShopFront = {
  x: number
  z: number
  /** Which way it faces, in radians around Y. */
  rotation: number
  width: number
  /** What kind of shop it is, which picks its board, inside and awning. */
  type: ShopType
  /** A 0 to 1 value used to pick between versions of its board and inside. */
  variation: number
  /** Where its chalk menu board stands, if it has one. */
  menuBoard?: GroundPoint
}

/** A mapped shop or cafe is usually within this distance of its building, in metres. */
const MAX_WALL_DISTANCE = 16
const MIN_WALL_LENGTH = 3
const MAX_AWNING_WIDTH = 7
/** An awning stops this far short of each corner of its wall, so it never hangs past the building. */
const CORNER_MARGIN = 0.5
/** Two awnings closer than this would overlap, in metres. */
const MIN_SPACING = 5

/** A stable 0 to 1 number from a map feature's id, so colours never change. */
function hashToUnit(text: string): number {
  let hash = 0
  for (const character of text) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  return (hash >>> 0) / 4294967296
}

/** Gives each mapped shop, cafe and restaurant a shop front on its nearest wall. */
export function generateShopFronts(places: PointFeature[], collisions: CollisionWorld): ShopFront[] {
  const fronts: ShopFront[] = []

  for (const place of places) {
    const { shop, amenity, cuisine } = place.properties
    if (!shop && amenity !== 'restaurant' && amenity !== 'cafe' && amenity !== 'fast_food' && amenity !== 'pharmacy') {
      continue
    }

    const [x, , z] = lonLatToWorld(place.geometry.coordinates)
    if (!isInsideBounds(x, z)) continue

    const wall = findNearestWall(collisions, x, z, MAX_WALL_DISTANCE)
    if (!wall || wall.length < MIN_WALL_LENGTH) continue

    // Centred on the nearest point of the wall, but slid along and narrowed as needed
    // so it stays between the wall's corners.
    const width = Math.min(wall.length * 0.8, MAX_AWNING_WIDTH, wall.length - CORNER_MARGIN * 2)
    const lowest = width / 2 + CORNER_MARGIN
    const centre = Math.min(Math.max(wall.offset, lowest), wall.length - lowest)
    const frontX = wall.startX + wall.alongX * centre
    const frontZ = wall.startZ + wall.alongZ * centre
    if (fronts.some((front) => Math.hypot(front.x - frontX, front.z - frontZ) < MIN_SPACING)) continue

    fronts.push({
      x: frontX,
      z: frontZ,
      rotation: Math.atan2(wall.normalX, wall.normalZ),
      width,
      type: typeForPlace({ shop, amenity, cuisine }),
      variation: hashToUnit(place.id),
    })
  }

  return fronts
}

/**
 * Fills the units along shop buildings' fronts. A unit at a mapped place becomes
 * that place, which then isn't drawn again on its own; the rest get a kind of
 * shop by chance, in the mix an HSR street has.
 */
export function fillShopUnits(units: ShopUnit[], mapped: ShopFront[]): ShopFront[] {
  const absorbed = new Set<ShopFront>()
  const filled = units.map(({ x, z, rotation, width, seed, menuBoard }): ShopFront => {
    const place = mapped.find(
      (front) =>
        !absorbed.has(front) &&
        Math.cos(front.rotation - rotation) > 0.7 &&
        Math.hypot(front.x - x, front.z - z) < (width + front.width) / 2,
    )
    if (place) absorbed.add(place)
    const variation = (seed % 1000) / 1000
    return {
      x,
      z,
      rotation,
      width,
      type: place?.type ?? typeByChance(((seed >>> 10) % 1000) / 1000),
      variation,
      menuBoard,
    }
  })

  // A mapped place that a unit didn't take, but that a unit now overlaps, is dropped too.
  const kept = mapped.filter(
    (front) =>
      !absorbed.has(front) &&
      filled.every((unit) => Math.hypot(unit.x - front.x, unit.z - front.z) >= (unit.width + front.width) / 2),
  )
  return [...kept, ...filled]
}
