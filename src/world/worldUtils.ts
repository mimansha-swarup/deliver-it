/** A GeoJSON coordinate. Note the order: longitude comes first. */
export type LonLat = [lon: number, lat: number]

/** Metres from the world origin. */
export type LocalPoint = [east: number, north: number]

/** A position on the ground in world coordinates: [x, z]. */
export type GroundPoint = [x: number, z: number]

/**
 * The point on the map that becomes (0, 0, 0) in the game world: the centre of
 * the playable area. It is fixed rather than computed from the data, so
 * re-exporting the map cannot silently move everything in the world.
 */
export const WORLD_ORIGIN = { lon: 77.6502, lat: 12.9095 }

/**
 * The playable rectangle in world coordinates, in metres. It follows the dense
 * part of the map, so it's long and thin, and it isn't centred on the origin.
 */
export const PLAY_AREA = { minX: -320, maxX: 280, minZ: -720, maxZ: 720 }

export const PLAY_AREA_WIDTH = PLAY_AREA.maxX - PLAY_AREA.minX
export const PLAY_AREA_DEPTH = PLAY_AREA.maxZ - PLAY_AREA.minZ

const METRES_PER_DEGREE = 111_320
const LON_SCALE = Math.cos((WORLD_ORIGIN.lat * Math.PI) / 180)

/** Converts longitude/latitude into metres east and north of the origin. */
export function lonLatToLocal([lon, lat]: LonLat): LocalPoint {
  return [
    (lon - WORLD_ORIGIN.lon) * METRES_PER_DEGREE * LON_SCALE,
    (lat - WORLD_ORIGIN.lat) * METRES_PER_DEGREE,
  ]
}

/**
 * Converts to a Three.js position on the ground.
 * East is +X, up is +Y and north is -Z.
 */
export function lonLatToWorld(position: LonLat, height = 0): [number, number, number] {
  const [east, north] = lonLatToLocal(position)
  return [east, height, -north]
}

/** True when a ground point is inside the playable area, by at least `margin` metres. */
export function isInsideBounds(x: number, z: number, margin = 0): boolean {
  return (
    x >= PLAY_AREA.minX + margin &&
    x <= PLAY_AREA.maxX - margin &&
    z >= PLAY_AREA.minZ + margin &&
    z <= PLAY_AREA.maxZ - margin
  )
}

/** True when a position falls inside the playable area. */
export function isInsidePlayArea(position: LonLat): boolean {
  const [x, , z] = lonLatToWorld(position)
  return isInsideBounds(x, z)
}

/** True when the centre of a closed GeoJSON ring falls inside the playable area. */
export function isRingInPlayArea(closedRing: LonLat[]): boolean {
  const ring = closedRing.slice(0, -1)
  const lon = ring.reduce((sum, [pointLon]) => sum + pointLon, 0) / ring.length
  const lat = ring.reduce((sum, [, pointLat]) => sum + pointLat, 0) / ring.length
  return isInsidePlayArea([lon, lat])
}
