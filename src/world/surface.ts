import type { LineFeature } from './mapData'
import { indexRoadPieces, nearestRoadEdge, toRoadPieces, type RoadIndex } from './props'
import type { RoadFeatures } from './roadFeatures'

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

/**
 * How high the ground is at any point, for wheels and feet to stand on, and how
 * much of a puddle's hollow is there (see `RoadFeatures.wetAt`).
 */
export type Surface = {
  /**
   * The ground's height at (x, z). Where a flyover passes over, `near` (how high the wheel or body
   * already is) picks the level: a deck no more than a step above it, or else the ground.
   */
  heightAt: (x: number, z: number, near?: number) => number
  wetAt: (x: number, z: number) => number
}

/** A world with no roads: flat soil everywhere. */
export const FLAT_SURFACE: Surface = { heightAt: () => 0, wetAt: () => 0 }

/**
 * Works out the surface from the roads alone, the same way `Roads` and `Kerbs`
 * lay them out: road, then kerb, pavement and edging going outwards from its
 * edge. Only the nearest road counts, so where two meet, the junction is open
 * road, as the kerbs leave it. It uses the road grid, so a question looks at a
 * few dozen pieces of road rather than all 9,000. On the road, speed breakers
 * raise it and potholes lower it.
 *
 * Roads with the new ground (streetEdgeGeometry.ts) set their own heights through
 * `street`: 'road' on their asphalt, including rounded corners, or a height on
 * their kerbs and raised footpaths.
 */
export function createSurface(
  roads: LineFeature[],
  features: RoadFeatures,
  street: (x: number, z: number) => number | 'road' | null = () => null,
): Surface {
  const index: RoadIndex = indexRoadPieces(toRoadPieces(roads))
  return {
    wetAt: features.wetAt,
    heightAt(x, z) {
      const set = street(x, z)
      if (set === 'road') return ROAD_HEIGHT + features.heightAt(x, z)
      if (set !== null) return set
      const out = nearestRoadEdge(index, x, z, PAVEMENT_WIDTH + 0.1)
      if (out <= 0) return ROAD_HEIGHT + features.heightAt(x, z)
      if (out < KERB.width) return KERB.height
      if (out < PAVEMENT_WIDTH - EDGING.width) return PAVEMENT_HEIGHT
      if (out < PAVEMENT_WIDTH) return EDGING.height
      return 0
    },
  }
}
