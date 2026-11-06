import type { LineFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { isInsidePlayArea, lonLatToWorld } from './worldUtils'

/** Long straight roads get extra points this far apart, in metres. */
const NODE_SPACING = 10

type Link = { to: number; length: number; roadWidth: number }

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

  const connect = (a: number, b: number, roadWidth: number) => {
    const length = Math.hypot(graph.xs[a] - graph.xs[b], graph.zs[a] - graph.zs[b])
    graph.links[a].push({ to: b, length, roadWidth })
    graph.links[b].push({ to: a, length, roadWidth })
  }

  for (const road of roads) {
    const name = road.properties.name ?? ''
    const roadWidth = getRoadWidth(road)
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
        connect(previous, node, roadWidth)
        previous = node
      }
      connect(previous, end, roadWidth)
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
 */
export function createRouteField(graph: RoadGraph, destination: number): RouteField {
  const count = graph.xs.length
  const distance = new Float64Array(count).fill(Infinity)
  const nextNode = new Int32Array(count).fill(-1)
  const done = new Uint8Array(count)
  distance[destination] = 0

  for (let round = 0; round < count; round++) {
    let current = -1
    for (let node = 0; node < count; node++) {
      if (!done[node] && distance[node] < Infinity) {
        if (current === -1 || distance[node] < distance[current]) current = node
      }
    }
    if (current === -1) break
    done[current] = 1

    for (const { to, length } of graph.links[current]) {
      const throughCurrent = distance[current] + length
      if (throughCurrent < distance[to]) {
        distance[to] = throughCurrent
        nextNode[to] = current
      }
    }
  }

  return { nextNode, distance }
}
