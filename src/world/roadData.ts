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
  residential: 5,
  service: 4,
  track: 3,
}

export function getRoadWidth({ properties }: LineFeature): number {
  const lanes = Number(properties.lanes)
  if (lanes > 0) return lanes * LANE_WIDTH
  return ROAD_WIDTHS[properties.highway ?? ''] ?? DEFAULT_ROAD_WIDTH
}
