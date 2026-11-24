import type { LineFeature } from './mapData'
import { getRoadWidth, isOneWay } from './roadData'
import { isInsidePlayArea, lonLatToWorld } from './worldUtils'

/** Long straight roads get extra points this far apart, in metres. */
const NODE_SPACING = 10

/**
 * `oneWay`: on a one-way road, 1 for the link that goes the road's way and -1 for the one against
 * it. Both are kept: a rider can go the wrong way (and people walk both ways), traffic doesn't
 * (traffic/lanes.ts), and routes avoid it where they can (`createRouteField`).
 */
type Link = { to: number; length: number; roadWidth: number; oneWay?: 1 | -1 }

/** The road network as a graph: points on roads, joined where you can ride between them. */
export type RoadGraph = {
  xs: number[]
  zs: number[]
  links: Link[][]
  /** The name of the road each point is on, or an empty string. */
  roadNames: string[]
}

/** For one destination: which way to go from every point, and how far it is. */
export type RouteField = {
  nextNode: Int32Array
  distance: Float64Array
}

export function createRoadGraph(roads: LineFeature[]): RoadGraph {
  const graph: RoadGraph = { xs: [], zs: [], links: [], roadNames: [] }
  const nodeAt = new Map<string, number>()

  const addNode = (x: number, z: number, name: string): number => {
    graph.xs.push(x)
    graph.zs.push(z)
    graph.links.push([])
    graph.roadNames.push(name)
    return graph.xs.length - 1
  }

  /** Roads meet where they share an exact OSM point, so those become one node. */
  const nodeForPoint = (key: string, x: number, z: number, name: string): number => {
    const existing = nodeAt.get(key)
    if (existing !== undefined) return existing

    const node = addNode(x, z, name)
    nodeAt.set(key, node)
    return node
  }

  const connect = (a: number, b: number, roadWidth: number, oneWay: boolean) => {
    const length = Math.hypot(graph.xs[a] - graph.xs[b], graph.zs[a] - graph.zs[b])
    graph.links[a].push(oneWay ? { to: b, length, roadWidth, oneWay: 1 } : { to: b, length, roadWidth })
    graph.links[b].push(oneWay ? { to: a, length, roadWidth, oneWay: -1 } : { to: a, length, roadWidth })
  }

  for (const road of roads) {
    const name = road.properties.name ?? ''
    const roadWidth = getRoadWidth(road)
    const oneWay = isOneWay(road)
    const points = road.geometry.coordinates

    for (let i = 0; i < points.length - 1; i++) {
      if (!isInsidePlayArea(points[i]) || !isInsidePlayArea(points[i + 1])) continue

      const [startX, , startZ] = lonLatToWorld(points[i])
      const [endX, , endZ] = lonLatToWorld(points[i + 1])
      const start = nodeForPoint(points[i].join(), startX, startZ, name)
      const end = nodeForPoint(points[i + 1].join(), endX, endZ, name)

      const parts = Math.ceil(Math.hypot(endX - startX, endZ - startZ) / NODE_SPACING)
      let previous = start
      for (let part = 1; part < parts; part++) {
        const along = part / parts
        const node = addNode(startX + (endX - startX) * along, startZ + (endZ - startZ) * along, name)
        connect(previous, node, roadWidth, oneWay)
        previous = node
      }
      connect(previous, end, roadWidth, oneWay)
    }
  }

  return keepMainNetwork(graph)
}

/**
 * Some mapped roads don't join the rest, usually because the area's edge cuts
 * them off. No route can use them, so the graph keeps only its largest
 * connected group of points, and every point it holds can reach every other.
 */
function keepMainNetwork(graph: RoadGraph): RoadGraph {
  const groupOf = new Int32Array(graph.xs.length).fill(-1)
  let largestGroup = -1
  let largestSize = 0

  for (let first = 0; first < groupOf.length; first++) {
    if (groupOf[first] !== -1) continue

    groupOf[first] = first
    const waiting = [first]
    let size = 0
    while (waiting.length > 0) {
      const node = waiting.pop() as number
      size++
      for (const { to } of graph.links[node]) {
        if (groupOf[to] === -1) {
          groupOf[to] = first
          waiting.push(to)
        }
      }
    }

    if (size > largestSize) {
      largestSize = size
      largestGroup = first
    }
  }

  // Removing points shifts the numbers of the rest, so each link is renumbered.
  const newNumber = new Int32Array(groupOf.length)
  const kept: number[] = []
  groupOf.forEach((group, node) => {
    if (group !== largestGroup) return
    newNumber[node] = kept.length
    kept.push(node)
  })

  return {
    xs: kept.map((node) => graph.xs[node]),
    zs: kept.map((node) => graph.zs[node]),
    roadNames: kept.map((node) => graph.roadNames[node]),
    links: kept.map((node) =>
      graph.links[node].map((link) => ({ ...link, to: newNumber[link.to] })),
    ),
  }
}

export function findNearestNode(graph: RoadGraph, x: number, z: number): number {
  let nearest = 0
  let nearestSquared = Infinity

  for (let node = 0; node < graph.xs.length; node++) {
    const squared = (graph.xs[node] - x) ** 2 + (graph.zs[node] - z) ** 2
    if (squared < nearestSquared) {
      nearestSquared = squared
      nearest = node
    }
  }
  return nearest
}

/**
 * Dijkstra's algorithm, run outward from the destination. It records the way
 * home from every point at once, so wherever the rider goes, even off course,
 * the route is already known and nothing has to be searched for again.
 *
 * The next point to settle is always the nearest one not yet done. A heap hands
 * that over without looking at every point: over all of HSR's 34,000 points,
 * scanning them all each time took seconds.
 */
/**
 * Roads closed for now (a festival procession): routes go round them. A closed link isn't
 * impossible, only very long, so a stop on the closed stretch itself can still be reached.
 * `version` goes up with every change, for whoever keeps routes to know theirs are stale.
 */
export const roadClosures = { version: 0, closed: new Set<number>() }
const CLOSED_COSTS = 4000
/**
 * A metre ridden against a one-way street counts as this many when a route is chosen: routes go
 * round by the right carriageway, but a door on a one-way stretch can still be reached, the last
 * few metres the wrong way if that's far shorter, as a rider would. The distance reported is still
 * the real one.
 */
const WRONG_WAY_COSTS = 8
const linkKey = (from: number, to: number) => from * 1_000_000 + to

/** Who has closed what: the festival, a city event. Each sets and lifts its own; the closed set is all of them together. */
const closedBy = new Map<string, [number, number][]>()

export function setClosedLinks(pairs: [number, number][], owner = 'festival') {
  if (pairs.length > 0) closedBy.set(owner, pairs)
  else closedBy.delete(owner)
  roadClosures.closed = new Set([...closedBy.values()].flat().flatMap(([a, b]) => [linkKey(a, b), linkKey(b, a)]))
  roadClosures.version++
}

export function createRouteField(graph: RoadGraph, destination: number): RouteField {
  const count = graph.xs.length
  const distance = new Float64Array(count).fill(Infinity)
  // What the search compares: the distance, with closed and wrong-way stretches counted as longer than they are.
  const cost = new Float64Array(count).fill(Infinity)
  const nextNode = new Int32Array(count).fill(-1)
  const done = new Uint8Array(count)
  const queue = new MinHeap()
  distance[destination] = 0
  cost[destination] = 0
  queue.push(destination, 0)

  while (queue.size > 0) {
    const current = queue.pop()
    if (done[current]) continue
    done[current] = 1

    for (const { to, length, oneWay } of graph.links[current]) {
      // The search runs out from the destination, so this link is ridden from `to` to `current`:
      // against the street if the link the other way (this one) goes with it.
      const throughCurrent =
        cost[current] + length * (oneWay === 1 ? WRONG_WAY_COSTS : 1) + (roadClosures.closed.size > 0 && roadClosures.closed.has(linkKey(current, to)) ? CLOSED_COSTS : 0)
      if (throughCurrent < cost[to]) {
        cost[to] = throughCurrent
        distance[to] = distance[current] + length
        nextNode[to] = current
        // The old entry for `to` stays in the heap, and is skipped when it comes out as done.
        queue.push(to, throughCurrent)
      }
    }
  }

  return { nextNode, distance }
}

/**
 * A binary heap: a tree kept in an array, where each entry is no further than
 * its children. The smallest is always at the front, and adding or taking one
 * only moves entries along a single branch.
 */
class MinHeap {
  private nodes: number[] = []
  private keys: number[] = []

  get size(): number {
    return this.nodes.length
  }

  push(node: number, key: number) {
    const { nodes, keys } = this
    let at = nodes.length
    nodes.push(node)
    keys.push(key)
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (keys[parent] <= key) break
      nodes[at] = nodes[parent]
      keys[at] = keys[parent]
      at = parent
    }
    nodes[at] = node
    keys[at] = key
  }

  pop(): number {
    const { nodes, keys } = this
    const top = nodes[0]
    const lastNode = nodes.pop() as number
    const lastKey = keys.pop() as number
    const size = nodes.length
    if (size === 0) return top

    let at = 0
    for (;;) {
      let child = at * 2 + 1
      if (child >= size) break
      if (child + 1 < size && keys[child + 1] < keys[child]) child++
      if (keys[child] >= lastKey) break
      nodes[at] = nodes[child]
      keys[at] = keys[child]
      at = child
    }
    nodes[at] = lastNode
    keys[at] = lastKey
    return top
  }
}
