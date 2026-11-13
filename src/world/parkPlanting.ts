import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { MapData } from './mapData'
import {
  createRandom,
  strayTint,
  indexRoadPieces,
  isClearOfRoads,
  toRoadPieces,
  type Prop,
  type RoadsideProps,
} from './props'
import {
  isInsideBounds,
  isInsideOutline,
  isRingInPlayArea,
  lonLatToWorld,
  type GroundPoint,
} from './worldUtils'

/** Trees are tried on a grid this wide, in metres, then nudged so they don't look planted. */
const TREE_GRID = 9
const TREE_NUDGE = 3.5
const TREE_CHANCE = 0.55
const TREE_TRUNK_RADIUS = 0.25
const TREE_CLEARANCE = 2.5

const BENCH_EVERY = 16
/** How far from a path's centre a bench stands, in metres. */
const BENCH_OFFSET = 1.8
const BENCH_RADIUS = 0.6
const PATH_WIDTH = 2

function toOutline(ring: MapData['parks'][number]['geometry']['coordinates'][number]): GroundPoint[] {
  return ring.slice(0, -1).map((position): GroundPoint => {
    const [x, , z] = lonLatToWorld(position)
    return [x, z]
  })
}



/**
 * Adds trees and benches to the real parks on the map. Both are solid, and the
 * trees join the roadside ones. The seed never changes, so parks stay the same.
 */
export function plantParks(
  data: MapData,
  collisions: CollisionWorld,
  props: RoadsideProps,
): Prop[] {
  const random = createRandom(20261107)
  const roads = indexRoadPieces(toRoadPieces(data.roads))
  const pathPieces = toRoadPieces(data.footways).map((piece) => ({ ...piece, width: PATH_WIDTH }))
  const paths = indexRoadPieces(pathPieces)
  const benches: Prop[] = []

  for (const park of data.parks) {
    const ring = park.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) continue

    const outline = toOutline(ring)
    const xs = outline.map(([x]) => x)
    const zs = outline.map(([, z]) => z)

    for (let gridX = Math.min(...xs); gridX < Math.max(...xs); gridX += TREE_GRID) {
      for (let gridZ = Math.min(...zs); gridZ < Math.max(...zs); gridZ += TREE_GRID) {
        const x = gridX + (random() - 0.5) * TREE_NUDGE * 2
        const z = gridZ + (random() - 0.5) * TREE_NUDGE * 2
        const rotation = random() * 6.28
        const variation = random()

        if (random() > TREE_CHANCE) continue
        if (!isInsideOutline(outline, x, z) || !isInsideBounds(x, z, 3)) continue
        if (isNearBuilding(collisions, x, z, TREE_CLEARANCE)) continue
        if (!isClearOfRoads(roads, x, z, TREE_CLEARANCE) || !isClearOfRoads(paths, x, z, TREE_CLEARANCE)) continue

        addPost(collisions, x, z, TREE_TRUNK_RADIUS)
        props.trees.push({ x, z, rotation, variation, tint: strayTint(props.trees.length) })
      }
    }

    for (const piece of pathPieces) {
      const [startX, startZ] = piece.start
      const [endX, endZ] = piece.end
      const length = Math.hypot(endX - startX, endZ - startZ)
      if (length === 0) continue

      const forwardX = (endX - startX) / length
      const forwardZ = (endZ - startZ) / length

      for (let along = BENCH_EVERY / 2; along < length; along += BENCH_EVERY) {
        // Facing the path: forward turned a quarter to the right, seen from above.
        const x = startX + forwardX * along + forwardZ * BENCH_OFFSET
        const z = startZ + forwardZ * along - forwardX * BENCH_OFFSET
        if (!isInsideOutline(outline, x, z)) continue
        if (isNearBuilding(collisions, x, z, BENCH_RADIUS + 0.3)) continue
        if (!isClearOfRoads(roads, x, z, BENCH_RADIUS)) continue

        addPost(collisions, x, z, BENCH_RADIUS)
        benches.push({ x, z, rotation: Math.atan2(-forwardZ, forwardX), variation: 0.5 })
      }
    }
  }

  return benches
}
