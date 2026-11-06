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

/** Side length in metres of the square playable area, centred on the origin. */
export const PLAY_AREA_SIZE = 450

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

/** True when a position falls inside the square playable area. */
export function isInsidePlayArea(position: LonLat): boolean {
  const [east, north] = lonLatToLocal(position)
  const half = PLAY_AREA_SIZE / 2
  return Math.abs(east) <= half && Math.abs(north) <= half
}

/** True when the centre of a closed GeoJSON ring falls inside the playable area. */
export function isRingInPlayArea(closedRing: LonLat[]): boolean {
  const ring = closedRing.slice(0, -1)
  const lon = ring.reduce((sum, [pointLon]) => sum + pointLon, 0) / ring.length
  const lat = ring.reduce((sum, [, pointLat]) => sum + pointLat, 0) / ring.length
  return isInsidePlayArea([lon, lat])
}
