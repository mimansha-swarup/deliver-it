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

/**
 * Whether a road is one way, along the order its points are mapped in: tagged so, or a roundabout
 * (which is one way by what it is). HSR has about 380 such stretches: each half of its dual
 * carriageways, the service roads beside the Outer Ring Road, and a few residential streets.
 */
export function isOneWay({ properties }: LineFeature): boolean {
  return properties.oneway === 'yes' || properties.junction === 'roundabout'
}

export function getRoadWidth({ properties }: LineFeature): number {
  const lanes = Number(properties.lanes)
  if (lanes > 0) return lanes * LANE_WIDTH
  return ROAD_WIDTHS[properties.highway ?? ''] ?? DEFAULT_ROAD_WIDTH
}
