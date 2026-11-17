import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { BuildingFeature } from './mapData'
import { createRouteField, type RoadGraph } from './roadGraph'
import type { ShopFront } from './shopFrontPlacement'
import { isInsideBounds, isInsideOutline, isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

/** A building orders are collected from. The first one found is the home store, by the start. */
export type DarkStore = {
  /** The road it's on, to tell one store from another, if the map names it. */
  road: string | null
  /**
   * How far out from the front wall the riders' bay is painted, in metres:
   * inside the footpath, short of the kerb. Set once the roads are known
   * (`placeRidersBays`); unset, the default distance.
   */
  bayOut?: number
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

/** Road names that don't help find a store: too common, or a flyover passing over it. */
const UNHELPFUL_ROAD_NAME = /^service road$|flyover/i
/** How far to look for a better road name, in metres. */
const NAME_REACH = 250

/** The store's road, or the nearest road with a name worth showing, if its own has none. */
function findRoadName(graph: RoadGraph, node: number): string | null {
  const usable = (name: string) => name !== '' && !UNHELPFUL_ROAD_NAME.test(name)
  if (usable(graph.roadNames[node])) return graph.roadNames[node]
  let best: string | null = null
  let bestDistance = NAME_REACH
  graph.roadNames.forEach((name, other) => {
    if (!usable(name)) return
    const distance = Math.hypot(graph.xs[other] - graph.xs[node], graph.zs[other] - graph.zs[node])
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  })
  return best
}

/** Where to look for a store: within `min` to `max` metres of `near`, nearest first. */
type SearchArea = { near: GroundPoint; min: number; max: number }

/** Road points a store can open onto: wide enough, clear of walls and away from traffic lights. */
function findOpenRoadNodes(graph: RoadGraph, collisions: CollisionWorld, signalNodes: number[]): number[] {
  const isOpenRoad = (node: number) =>
    graph.links[node].some(({ roadWidth }) => roadWidth >= MIN_ROAD_WIDTH) &&
    !isNearBuilding(collisions, graph.xs[node], graph.zs[node], 2) &&
    signalNodes.every(
      (signal) =>
        Math.hypot(graph.xs[signal] - graph.xs[node], graph.zs[signal] - graph.zs[node]) >=
        SIGNAL_CLEARANCE,
    )
  return graph.xs.map((_, node) => node).filter(isOpenRoad)
}

/** Picks the nearest suitable building in the area and fits a store to its front wall, or null if none suits. */
function findStoreIn(
  buildings: BuildingFeature[],
  graph: RoadGraph,
  collisions: CollisionWorld,
  shopFronts: ShopFront[],
  roadNodes: number[],
  { near, min, max }: SearchArea,
): DarkStore | null {
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

      const startDistance = Math.hypot(x - near[0], z - near[1])
      if (startDistance < min || startDistance > max) return
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
        road: findRoadName(graph, node),
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

  return best
}

/** Every street within this far of a store by road can get orders from it, in metres: the longest trip. */
const STORE_REACH = 1500
/** Stores are added until no more than this share of the streets is out of reach. */
const OUT_OF_REACH_SHARE = 0.04
const MAX_STORES = 8
/** Streets out of reach are counted in squares this big, in metres. */
const SQUARE = 100
/** A new store goes where the most streets out of reach are within this distance, in metres. */
const GATHER_RADIUS = 800
/** How far from that spot a building may be, in metres. */
const SEARCH_RADIUS = 450

/**
 * The home store, then more across the map, so every part of HSR gets orders.
 * Each new store goes where the most streets are still out of reach of every
 * store so far, at the nearest building that suits it.
 */
export function findDarkStores(
  buildings: BuildingFeature[],
  graph: RoadGraph,
  collisions: CollisionWorld,
  shopFronts: ShopFront[],
  start: GroundPoint,
  signalNodes: number[] = [],
): DarkStore[] {
  const roadNodes = findOpenRoadNodes(graph, collisions, signalNodes)
  const home = findStoreIn(buildings, graph, collisions, shopFronts, roadNodes, {
    near: start,
    min: MIN_START_DISTANCE,
    max: MAX_START_DISTANCE,
  })
  if (!home) throw new Error('No building on the map suits the dark store')
  const stores = [home]

  const streets = graph.xs.map((_, node) => node).filter((node) => isInsideBounds(graph.xs[node], graph.zs[node], EDGE_MARGIN))
  const nearest = new Float64Array(graph.xs.length).fill(Infinity)
  const reach = (store: DarkStore) => {
    const { distance } = createRouteField(graph, store.node)
    for (const node of streets) nearest[node] = Math.min(nearest[node], distance[node])
  }
  reach(home)
  // Places where no building suits a store, so they aren't tried again.
  const givenUp = new Uint8Array(graph.xs.length)

  while (stores.length < MAX_STORES) {
    const outOfReach = streets.filter((node) => nearest[node] > STORE_REACH && !givenUp[node])
    if (outOfReach.length <= streets.length * OUT_OF_REACH_SHARE) break

    const near = findBusiestSpot(graph, outOfReach)
    const store = findStoreIn(buildings, graph, collisions, shopFronts, roadNodes, { near, min: 0, max: SEARCH_RADIUS })
    if (store) {
      stores.push(store)
      reach(store)
    } else {
      for (const node of outOfReach) {
        if (Math.hypot(graph.xs[node] - near[0], graph.zs[node] - near[1]) <= SEARCH_RADIUS) givenUp[node] = 1
      }
    }
  }
  return stores
}

/** The middle of the map square with the most of these streets within `GATHER_RADIUS` of it. */
function findBusiestSpot(graph: RoadGraph, nodes: number[]): GroundPoint {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    const key = `${Math.floor(graph.xs[node] / SQUARE)},${Math.floor(graph.zs[node] / SQUARE)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const reach = Math.ceil(GATHER_RADIUS / SQUARE)
  let best: GroundPoint = [graph.xs[nodes[0]], graph.zs[nodes[0]]]
  let bestCount = -1
  for (const key of counts.keys()) {
    const [column, row] = key.split(',').map(Number)
    let count = 0
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        if (dx * dx + dz * dz <= reach * reach) count += counts.get(`${column + dx},${row + dz}`) ?? 0
      }
    }
    if (count > bestCount) {
      bestCount = count
      best = [(column + 0.5) * SQUARE, (row + 0.5) * SQUARE]
    }
  }
  return best
}

/** Parked bikes are solid, so riders go around them. */
export function addDarkStorePosts(collisions: CollisionWorld, store: DarkStore) {
  for (const { x, z } of store.bikes) addPost(collisions, x, z, BIKE_RADIUS)
}

/** The bay keeps this far back from the road's edge, so it's on the footpath, not the kerb. */
const BAY_KERB_CLEARANCE = 0.9
const BAY_MIN_OUT = 1.2
const BAY_MAX_OUT = 4.1

/** Sets where each store's riders' bay is painted: on its footpath, short of the kerb, however wide the footpath. */
export function placeRidersBays(stores: DarkStore[], roadEdgeAt: (x: number, z: number) => number) {
  for (const store of stores) {
    const toRoad = roadEdgeAt(store.x, store.z)
    store.bayOut = Math.min(BAY_MAX_OUT, Math.max(BAY_MIN_OUT, toRoad - BAY_KERB_CLEARANCE))
  }
}
