import { liveRoute } from '../game/livePlayer'
import { hasClearLine, type CollisionWorld } from '../world/collision'
import { findNearestNode, type RoadGraph, type RouteField } from '../world/roadGraph'
import { SCOOTER } from '../vehicle/vehicleConfig'

/** How far ahead along the route the arrow looks. Long enough to show the next turn early. */
const AIM_DISTANCE = 22

/**
 * Walks the route from the rider's position, and returns its length in metres.
 * The arrow aims at the furthest point ahead that's in plain sight, so at a
 * corner it points around the building rather than into it.
 */
export function updateLiveRoute(
  collisions: CollisionWorld,
  graph: RoadGraph,
  field: RouteField,
  x: number,
  z: number,
  stopX: number,
  stopZ: number,
): number {
  const { points } = liveRoute
  points.length = 0
  points.push(x, z)

  liveRoute.active = true
  liveRoute.aimX = stopX
  liveRoute.aimZ = stopZ

  let node = findNearestNode(graph, x, z)
  if (field.distance[node] === Infinity) {
    points.push(stopX, stopZ)
    return Math.hypot(stopX - x, stopZ - z)
  }

  let walked = 0
  let aimFound = false
  let firstNode = true
  let previousX = x
  let previousZ = z

  while (node !== -1) {
    const nodeX = graph.xs[node]
    const nodeZ = graph.zs[node]
    walked += Math.hypot(nodeX - previousX, nodeZ - previousZ)
    points.push(nodeX, nodeZ)

    if (!aimFound) {
      const visible = hasClearLine(collisions, x, z, nodeX, nodeZ, SCOOTER.collisionRadius)
      if (visible || firstNode) {
        liveRoute.aimX = nodeX
        liveRoute.aimZ = nodeZ
      }
      if (!visible || walked >= AIM_DISTANCE) aimFound = true
      firstNode = false
    }

    previousX = nodeX
    previousZ = nodeZ
    node = field.nextNode[node]
  }

  return walked + Math.hypot(stopX - previousX, stopZ - previousZ)
}

export function clearLiveRoute() {
  liveRoute.points.length = 0
  liveRoute.active = false
}
