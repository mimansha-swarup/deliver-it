import { createRandom } from './props'
import type { RoadGraph } from './roadGraph'

/**
 * Speed breakers, potholes and the puddles that fill in the rain: where they
 * are, and how they change the road's height under a wheel.
 */

/** A speed breaker's shape: half its depth along the road, and its height, in metres. */
export const BREAKER = { halfDepth: 0.45, height: 0.075 }
/** Breakers sit this far back from the edge of the road a junction joins, on roads up to this wide (HSR's side roads), in metres. */
const BREAKER_SETBACK = 5
const BREAKER_MAX_ROAD = 10
/** A share of junction approaches have one. Long stretches get one about this often, in metres. */
const BREAKER_CHANCE = 0.6
const BREAKER_SPACING = 140
/** Stretches shorter than this between junctions don't get one. */
const SHORTEST_STRETCH = 30

/** Potholes: how deep, how many on each 10 m link of road, and how big. */
const POTHOLE = { depth: 0.04, chance: 0.04, radius: [0.28, 0.6] }
/** Extra puddles along the road's edge, where water collects: how many, and how big. */
const EDGE_PUDDLE = { chance: 0.035, radius: [0.7, 1.5] }
/** A pothole's puddle spreads a little past its edge. */
const PUDDLE_SPREAD = 1.5
/** No potholes or puddles this close to a breaker or a junction, in metres. */
const FEATURE_CLEARANCE = 4

export type SpeedBreaker = {
  x: number
  z: number
  /** The way the road runs, as a unit vector. */
  alongX: number
  alongZ: number
  /** Half the road's width: the breaker spans it. */
  halfWidth: number
}

/** A pothole or a puddle: a round patch. `variation` picks its shape. */
export type RoadPatch = { x: number; z: number; radius: number; rotation: number; variation: number }

export type RoadFeatures = {
  breakers: SpeedBreaker[]
  potholes: RoadPatch[]
  puddles: RoadPatch[]
  /** How much a feature raises (or, in a pothole, lowers) the road here, in metres. */
  heightAt: (x: number, z: number) => number
  /** How much of a puddle's hollow is here, from 0 to 1. Whether there's water in it is `water.level`. */
  wetAt: (x: number, z: number) => number
  /** Where along a road link, in metres from `from`, its breakers are. Traffic slows for them. */
  breakersOnLink: (from: number, to: number) => number[]
}

/**
 * How full the puddles are, from 0 (dry) to 1. It follows the rain slowly:
 * puddles fill over a shower and take longer still to dry. `RoadFeatures` moves
 * it each frame, and the scooter reads it.
 */
export const water = { level: 0 }

/** The height of a breaker's hump, `along` metres from its middle. A smooth bump, flat at its edges. */
export function breakerHeight(along: number): number {
  if (Math.abs(along) >= BREAKER.halfDepth) return 0
  return BREAKER.height * 0.5 * (1 + Math.cos((Math.PI * along) / BREAKER.halfDepth))
}

const GRID = 8
const gridKey = (cellX: number, cellZ: number) => (cellX + 5000) * 10000 + (cellZ + 5000)

type Cell = { breakers: SpeedBreaker[]; potholes: RoadPatch[]; puddles: RoadPatch[] }

/** Features sorted into 8 m squares, so a wheel only checks the few around it. */
function createGrid() {
  const cells = new Map<number, Cell>()
  const add = <K extends keyof Cell>(kind: K, item: Cell[K][number], reach: number, x: number, z: number) => {
    for (let cellX = Math.floor((x - reach) / GRID); cellX <= Math.floor((x + reach) / GRID); cellX++) {
      for (let cellZ = Math.floor((z - reach) / GRID); cellZ <= Math.floor((z + reach) / GRID); cellZ++) {
        const key = gridKey(cellX, cellZ)
        let cell = cells.get(key)
        if (!cell) cells.set(key, (cell = { breakers: [], potholes: [], puddles: [] }))
        ;(cell[kind] as Cell[K][number][]).push(item)
      }
    }
  }
  const at = (x: number, z: number) => cells.get(gridKey(Math.floor(x / GRID), Math.floor(z / GRID)))
  return { add, at }
}

/**
 * Walks a stretch of road from a junction, along the link to `first`, through
 * points that only join two links, to the next junction or dead end. Returns
 * the points passed and the distance to each.
 */
function walkStretch(graph: RoadGraph, start: number, first: number) {
  const nodes = [start]
  const distances = [0]
  let previous = start
  let current = first
  let travelled = 0
  for (;;) {
    const link = graph.links[previous].find((candidate) => candidate.to === current)
    travelled += link?.length ?? 0
    nodes.push(current)
    distances.push(travelled)
    if (graph.links[current].length !== 2) break
    const next = graph.links[current].find((candidate) => candidate.to !== previous)
    if (!next || nodes.length > 400) break
    previous = current
    current = next.to
  }
  return { nodes, distances, length: travelled }
}

/** Places the breakers, potholes and puddles. The seed never changes, so they're in the same places every time. */
export function placeRoadFeatures(graph: RoadGraph): RoadFeatures {
  const random = createRandom(20261115)
  const grid = createGrid()
  const breakers: SpeedBreaker[] = []
  const potholes: RoadPatch[] = []
  const puddles: RoadPatch[] = []
  /** Breakers by link, as `from * count + to`, each with its distance from `from`. */
  const onLink = new Map<number, number[]>()
  const nodeCount = graph.xs.length
  const isJunction = (node: number) => graph.links[node].length >= 3
  /** How far from a junction's middle a breaker goes: past the widest road meeting there, and a little more. */
  const setback = (node: number) => BREAKER_SETBACK + Math.max(...graph.links[node].map((link) => link.roadWidth)) / 2

  const addBreaker = (nodes: number[], distances: number[], at: number, roadWidth: number) => {
    const step = distances.findIndex((distance) => distance >= at)
    if (step <= 0) return
    const from = nodes[step - 1]
    const to = nodes[step]
    const linkLength = distances[step] - distances[step - 1]
    const into = at - distances[step - 1]
    const alongX = (graph.xs[to] - graph.xs[from]) / linkLength
    const alongZ = (graph.zs[to] - graph.zs[from]) / linkLength
    const breaker: SpeedBreaker = {
      x: graph.xs[from] + alongX * into,
      z: graph.zs[from] + alongZ * into,
      alongX,
      alongZ,
      halfWidth: roadWidth / 2,
    }
    breakers.push(breaker)
    grid.add('breakers', breaker, breaker.halfWidth + BREAKER.halfDepth, breaker.x, breaker.z)
    const forward = onLink.get(from * nodeCount + to) ?? []
    forward.push(into)
    onLink.set(from * nodeCount + to, forward)
    const backward = onLink.get(to * nodeCount + from) ?? []
    backward.push(linkLength - into)
    onLink.set(to * nodeCount + from, backward)
  }

  // Breakers: walked from each junction along each road leaving it. Each stretch is taken once,
  // from its lower-numbered end, and gets one near each end and more along it if it's long.
  for (let start = 0; start < nodeCount; start++) {
    if (!isJunction(start)) continue
    for (const { to, roadWidth } of graph.links[start]) {
      if (roadWidth > BREAKER_MAX_ROAD) continue
      const { nodes, distances, length } = walkStretch(graph, start, to)
      const end = nodes[nodes.length - 1]
      if (length < SHORTEST_STRETCH || end < start) continue
      const near = setback(start)
      const far = isJunction(end) ? setback(end) : 0
      if (length < near + far + 4) continue
      if (random() < BREAKER_CHANCE) addBreaker(nodes, distances, near, roadWidth)
      if (far > 0 && random() < BREAKER_CHANCE) addBreaker(nodes, distances, length - far, roadWidth)
      for (let at = BREAKER_SPACING; at < length - BREAKER_SPACING / 2; at += BREAKER_SPACING) {
        addBreaker(nodes, distances, at, roadWidth)
      }
    }
  }

  const nearBreaker = (x: number, z: number) =>
    breakers.some((breaker) => Math.abs(breaker.x - x) < 20 && Math.abs(breaker.z - z) < 20 && Math.hypot(breaker.x - x, breaker.z - z) < breaker.halfWidth + FEATURE_CLEARANCE)

  // Potholes and puddles: a chance on each 10 m link of road, once per link.
  for (let from = 0; from < nodeCount; from++) {
    for (const { to, length, roadWidth } of graph.links[from]) {
      if (to < from || length < 1) continue
      if (isJunction(from) || isJunction(to)) continue
      const alongX = (graph.xs[to] - graph.xs[from]) / length
      const alongZ = (graph.zs[to] - graph.zs[from]) / length
      const half = roadWidth / 2
      const spot = (across: number) => {
        const at = random() * length
        return [graph.xs[from] + alongX * at + alongZ * across, graph.zs[from] + alongZ * at - alongX * across]
      }

      if (random() < POTHOLE.chance) {
        // Where wheels go: either side of the middle, near where each lane runs.
        const side = random() < 0.5 ? -1 : 1
        const across = side * Math.min(half - 0.7, 0.8 + random() * 1.4)
        const [x, z] = spot(across)
        const radius = POTHOLE.radius[0] + random() * (POTHOLE.radius[1] - POTHOLE.radius[0])
        if (!nearBreaker(x, z)) {
          const pothole = { x, z, radius, rotation: random() * Math.PI * 2, variation: random() }
          potholes.push(pothole)
          grid.add('potholes', pothole, radius, x, z)
          const puddle = { ...pothole, radius: radius * PUDDLE_SPREAD, variation: random() }
          puddles.push(puddle)
          grid.add('puddles', puddle, puddle.radius, x, z)
        }
      }

      if (random() < EDGE_PUDDLE.chance) {
        const radius = EDGE_PUDDLE.radius[0] + random() * (EDGE_PUDDLE.radius[1] - EDGE_PUDDLE.radius[0])
        const side = random() < 0.5 ? -1 : 1
        const [x, z] = spot(side * Math.max(0, half - radius * 0.7))
        if (!nearBreaker(x, z)) {
          const puddle = { x, z, radius, rotation: random() * Math.PI * 2, variation: random() }
          puddles.push(puddle)
          grid.add('puddles', puddle, radius, x, z)
        }
      }
    }
  }

  return {
    breakers,
    potholes,
    puddles,
    heightAt(x, z) {
      const cell = grid.at(x, z)
      if (!cell) return 0
      let height = 0
      for (const breaker of cell.breakers) {
        const dx = x - breaker.x
        const dz = z - breaker.z
        const across = Math.abs(dx * breaker.alongZ - dz * breaker.alongX)
        if (across < breaker.halfWidth) height = Math.max(height, breakerHeight(dx * breaker.alongX + dz * breaker.alongZ))
      }
      for (const pothole of cell.potholes) {
        const distance = Math.hypot(x - pothole.x, z - pothole.z) / pothole.radius
        // A bowl, deepest in the middle.
        if (distance < 1) height = Math.min(height, -POTHOLE.depth * (1 - distance * distance))
      }
      return height
    },
    wetAt(x, z) {
      const cell = grid.at(x, z)
      if (!cell) return 0
      let wet = 0
      for (const puddle of cell.puddles) {
        const distance = Math.hypot(x - puddle.x, z - puddle.z) / puddle.radius
        if (distance < 1) wet = Math.max(wet, Math.min(1, (1 - distance) * 3))
      }
      return wet
    },
    breakersOnLink: (from, to) => onLink.get(from * nodeCount + to) ?? [],
  }
}
