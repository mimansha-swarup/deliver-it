import type { LineFeature } from './mapData'
import { indexRoadPieces, nearestRoadEdge, toRoadPieces, type RoadIndex } from './props'

/**
 * How high each surface stands, in metres above the soil (y = 0). Roads sit a
 * little above the ground, and the pavement under them, so the surfaces never
 * flicker against each other. Anything that touches the ground stands on these.
 */
export const ROAD_HEIGHT = 0.05
export const PAVEMENT_HEIGHT = 0.03
/** A pavement runs under each road, showing this far past the edge on both sides. */
export const PAVEMENT_WIDTH = 3
/** The kerb between the road and the pavement: its width and how far it stands above the soil. */
export const KERB = { width: 0.18, height: 0.13 }
/** The low concrete edge between the pavement and the soil. */
export const EDGING = { width: 0.12, height: 0.07 }

/** How high the ground is at any point, for wheels and feet to stand on. */
export type Surface = { heightAt: (x: number, z: number) => number }

/** A world with no roads: flat soil everywhere. */
export const FLAT_SURFACE: Surface = { heightAt: () => 0 }

/**
 * Works out the surface from the roads alone, the same way `Roads` and `Kerbs`
 * lay them out: road, then kerb, pavement and edging going outwards from its
 * edge. Only the nearest road counts, so where two meet, the junction is open
 * road, as the kerbs leave it. It uses the road grid, so a question looks at a
 * few dozen pieces of road rather than all 9,000.
 */
export function createSurface(roads: LineFeature[]): Surface {
  const index: RoadIndex = indexRoadPieces(toRoadPieces(roads))
  return {
    heightAt(x, z) {
      const out = nearestRoadEdge(index, x, z, PAVEMENT_WIDTH + 0.1)
      if (out <= 0) return ROAD_HEIGHT
      if (out < KERB.width) return KERB.height
      if (out < PAVEMENT_WIDTH - EDGING.width) return PAVEMENT_HEIGHT
      if (out < PAVEMENT_WIDTH) return EDGING.height
      return 0
    },
  }
}
