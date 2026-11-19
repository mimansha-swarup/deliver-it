import type { LineFeature } from './mapData'

const LANE_WIDTH = 3.5
const DEFAULT_ROAD_WIDTH = 5

/**
 * Road widths in metres. OSM has no width data here, so these were chosen by
 * measuring the gap between road centrelines and the nearest buildings.
 */
const ROAD_WIDTHS: Record<string, number> = {
  secondary: 9,
  tertiary: 7,
  // Residential streets: two cars pass, and a scooter turns at a junction without riding the kerb
  // (were 4.6 m, too narrow to turn). The footpaths and yards beside them gave up the room.
  residential: 6.5,
  unclassified: 6,
  living_street: 5.5,
  service: 4,
  track: 3,
}

export function getRoadWidth({ properties }: LineFeature): number {
  const lanes = Number(properties.lanes)
  if (lanes > 0) return lanes * LANE_WIDTH
  return ROAD_WIDTHS[properties.highway ?? ''] ?? DEFAULT_ROAD_WIDTH
}
