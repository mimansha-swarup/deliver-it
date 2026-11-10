import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { RoadGraph } from '../world/roadGraph'
import { isInsideBounds } from '../world/worldUtils'

/** One straight piece of a path through the world, followed in one direction. */
export type Lane = {
  startX: number
  startZ: number
  endX: number
  endZ: number
  length: number
  /** Direction of travel. */
  forwardX: number
  forwardZ: number
  /** Lanes that can follow this one. */
  next: number[]
  /** The road points at each end of this lane. */
  startNode: number
  endNode: number
  /** The light this lane runs up to, if there is one. */
  signal?: { junction: number; group: number; stopBack: number }
}

type LaneRules = {
  /** Roads narrower than this are skipped. */
  minRoadWidth: number
  /** How far left of the road's centre the path runs, for a given road width. */
  sideOffset: (roadWidth: number) => number
  /** Space needed around the path, so nothing walks or drives through a wall. */
  clearance: number
}

const EDGE_MARGIN = 3

/**
 * Turns the road graph into one-way paths. Each road link gives one path in
 * each direction, shifted to the left of travel, because India drives on the
 * left. Paths blocked by a building or a post are left out.
 */
export function createLanes(
  graph: RoadGraph,
  collisions: CollisionWorld,
  { minRoadWidth, sideOffset, clearance }: LaneRules,
): Lane[] {
  const lanes: Lane[] = []
  const lanesFrom: number[][] = graph.xs.map(() => [])
  const endNodes: number[] = []
  const startNodes: number[] = []

  const isClear = (x: number, z: number) =>
    isInsideBounds(x, z, EDGE_MARGIN) && !isNearBuilding(collisions, x, z, clearance)

  graph.links.forEach((links, from) => {
    for (const { to, length, roadWidth } of links) {
      if (roadWidth < minRoadWidth || length === 0) continue

      const forwardX = (graph.xs[to] - graph.xs[from]) / length
      const forwardZ = (graph.zs[to] - graph.zs[from]) / length
      // Forward is (sin h, cos h), so a quarter turn to the left is (fz, -fx).
      const offset = sideOffset(roadWidth)
      const startX = graph.xs[from] + forwardZ * offset
      const startZ = graph.zs[from] - forwardX * offset
      const endX = graph.xs[to] + forwardZ * offset
      const endZ = graph.zs[to] - forwardX * offset

      const clear =
        isClear(startX, startZ) &&
        isClear((startX + endX) / 2, (startZ + endZ) / 2) &&
        isClear(endX, endZ)
      if (!clear) continue

      lanesFrom[from].push(lanes.length)
      startNodes.push(from)
      endNodes.push(to)
      lanes.push({
        startX,
        startZ,
        endX,
        endZ,
        length,
        forwardX,
        forwardZ,
        next: [],
        startNode: from,
        endNode: to,
      })
    }
  })

  // Carry straight on or turn off where possible, and only turn back at a dead end.
  lanes.forEach((lane, index) => {
    const onward = lanesFrom[endNodes[index]]
    const ahead = onward.filter((candidate) => endNodes[candidate] !== startNodes[index])
    lane.next = ahead.length > 0 ? ahead : onward
  })

  return lanes
}
