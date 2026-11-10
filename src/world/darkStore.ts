import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { BuildingFeature } from './mapData'
import type { RoadGraph } from './roadGraph'
import type { ShopFront } from './shopFrontPlacement'
import { isInsideBounds, isInsideOutline, isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

/** The one building every order is collected from. */
export type DarkStore = {
  /** The middle of its front wall, and which way that wall faces. */
  x: number
  z: number
  rotation: number
  /** How wide its front is, in metres. */
  width: number
  /** The road point riders stop at. */
  node: number
  /** Where the staff member stands. */
  staffX: number
  staffZ: number
  /** Where two parked bikes stand, and which way they point. */
  bikes: { x: number; z: number; rotation: number }[]
}

const MIN_FRONT_WIDTH = 8
const MAX_FRONT_WIDTH = 12
/** How far the front wall may be from the road's middle, in metres. */
const MAX_ROAD_DISTANCE = 14
const MIN_ROAD_WIDTH = 7
/** The store sits a short ride from where the game starts, not right beside it. */
const MIN_START_DISTANCE = 70
const MAX_START_DISTANCE = 400
const AWNING_CLEARANCE = 8
const SIGNAL_CLEARANCE = 35
const EDGE_MARGIN = 40
const BIKE_RADIUS = 0.5
const STAFF_FROM_WALL = 1.2
const BIKES_FROM_WALL = 1.5
const BIKE_SPACING = 1.5

/** Picks the nearest suitable building and fits the store to its front wall. */
export function findDarkStore(
  buildings: BuildingFeature[],
  graph: RoadGraph,
  collisions: CollisionWorld,
  shopFronts: ShopFront[],
  start: GroundPoint,
  signalNodes: number[] = [],
): DarkStore {
  const isOpenRoad = (node: number) =>
    graph.links[node].some(({ roadWidth }) => roadWidth >= MIN_ROAD_WIDTH) &&
    !isNearBuilding(collisions, graph.xs[node], graph.zs[node], 2) &&
    signalNodes.every(
      (signal) =>
        Math.hypot(graph.xs[signal] - graph.xs[node], graph.zs[signal] - graph.zs[node]) >=
        SIGNAL_CLEARANCE,
    )
  const roadNodes = graph.xs.map((_, node) => node).filter(isOpenRoad)

  let best: DarkStore | null = null
  let bestDistance = Infinity

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    if (building.kind !== 'shop' || !isRingInPlayArea(ring)) continue

    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    outline.forEach((corner, index) => {
      const next = outline[(index + 1) % outline.length]
      const width = Math.hypot(next[0] - corner[0], next[1] - corner[1])
      if (width < MIN_FRONT_WIDTH) return

      const x = (corner[0] + next[0]) / 2
      const z = (corner[1] + next[1]) / 2
      if (!isInsideBounds(x, z, EDGE_MARGIN)) return

      const startDistance = Math.hypot(x - start[0], z - start[1])
      if (startDistance < MIN_START_DISTANCE || startDistance > MAX_START_DISTANCE) return
      if (startDistance >= bestDistance) return

      const sideX = (next[1] - corner[1]) / width
      const sideZ = -(next[0] - corner[0]) / width
      const flip = isInsideOutline(outline, x + sideX * 0.3, z + sideZ * 0.3) ? -1 : 1
      const normalX = sideX * flip
      const normalZ = sideZ * flip

      if (isNearBuilding(collisions, x + normalX * 3, z + normalZ * 3, 1.5)) return
      if (shopFronts.some((front) => Math.hypot(front.x - x, front.z - z) < AWNING_CLEARANCE)) return

      // The road point straight out from the door, not one further along the street.
      let node = -1
      let nearest: number = MAX_ROAD_DISTANCE
      for (const candidate of roadNodes) {
        const awayX = graph.xs[candidate] - x
        const awayZ = graph.zs[candidate] - z
        const out = awayX * normalX + awayZ * normalZ
        const along = Math.abs(awayX * normalZ - awayZ * normalX)
        if (out > 0 && along < width / 2 && out < nearest) {
          nearest = out
          node = candidate
        }
      }
      if (node === -1) return

      const alongX = -normalZ
      const alongZ = normalX
      const frontWidth = Math.min(width, MAX_FRONT_WIDTH)
      const bikeOffset = frontWidth / 2 - 1

      bestDistance = startDistance
      best = {
        x,
        z,
        rotation: Math.atan2(normalX, normalZ),
        width: frontWidth,
        node,
        staffX: x + normalX * STAFF_FROM_WALL,
        staffZ: z + normalZ * STAFF_FROM_WALL,
        bikes: [0, 1].map((slot) => ({
          x: x + normalX * BIKES_FROM_WALL + alongX * (bikeOffset - slot * BIKE_SPACING),
          z: z + normalZ * BIKES_FROM_WALL + alongZ * (bikeOffset - slot * BIKE_SPACING),
          rotation: Math.atan2(alongX + normalX, alongZ + normalZ),
        })),
      }
    })
  }

  if (!best) throw new Error('No building on the map suits the dark store')
  return best
}

/** Parked bikes are solid, so riders go around them. */
export function addDarkStorePosts(collisions: CollisionWorld, store: DarkStore) {
  for (const { x, z } of store.bikes) addPost(collisions, x, z, BIKE_RADIUS)
}
