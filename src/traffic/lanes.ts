import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { RoadGraph } from '../world/roadGraph'
import { isInsideBounds } from '../world/worldUtils'
import type { DeckSpan } from './deckLanes'

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
  /** How busy its street is (streetPresets.ts): new traffic is placed in proportion. Unset is 1. */
  weight?: number
  /** Whether buses run on its street. */
  buses?: boolean
  /**
   * Stretches with a vehicle parked at the kerb, which traffic eases out around: from and to (metres
   * along), and `edge`, the parked vehicle's inner side, sideways from the lane (left is positive,
   * as `shift`), less a margin. A vehicle there keeps its own left side to the right of it.
   */
  parked?: { from: number; to: number; edge: number }[]
  /**
   * On a wide road traffic runs in files, side by side: where each file's line is, sideways from
   * the lane's own line (left is positive, as `shift`). Unset: one file, on the lane's line.
   */
  files?: number[]
  /** Inside a junction, between two of its crossings (junctions.ts): no traffic appears on it. */
  inJunction?: boolean
  /** Closed for now (a procession): no traffic is put on it, and none turns onto it. */
  closed?: boolean
  /** On a flyover: which deck, and where along it the lane starts and ends (deckLanes.ts). */
  deck?: DeckSpan
}

type LaneRules = {
  /** Roads narrower than this are skipped. */
  minRoadWidth: number
  /** How far left of the road's centre the path runs, for a given road width. */
  sideOffset: (roadWidth: number) => number
  /** Traffic keeps to a one-way street's direction: no path against it. People on the footpath walk both ways. */
  obeyOneWay?: boolean
  /** Space needed around the path, so nothing walks or drives through a wall. */
  clearance: number
  /** Work out the files traffic runs in on wide roads (`Lane.files`). */
  files?: boolean
}

/** Two files of traffic are this far apart, in metres, and a file's line keeps this far from the road's edge and from its middle. */
const FILE_GAP = 3.2
const FILE_EDGE = 1.15

/**
 * The files on a road `roadWidth` wide, for a lane running `offset` to the left of its middle. A
 * one-way road (each half of a dual carriageway) is all this direction's: the lane's own line,
 * and one or two more to its right. A two-way road has half each: two files only on a wide one.
 */
function filesFor(roadWidth: number, offset: number, oneWay: boolean): number[] | undefined {
  if (oneWay) {
    // From the lane's line to the far (right-hand) edge.
    const room = roadWidth / 2 + offset - FILE_EDGE
    const more = Math.min(2, Math.floor(room / FILE_GAP))
    if (more < 1) return undefined
    return Array.from({ length: more + 1 }, (_, file) => -file * FILE_GAP)
  }
  // Its own half: from the middle of the road to the kerb.
  const spread = (roadWidth / 2 - 2 * FILE_EDGE) / 2
  if (spread * 2 < FILE_GAP - 0.4) return undefined
  const middle = roadWidth / 4 - offset
  return [middle + spread, middle - spread]
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
  { minRoadWidth, sideOffset, clearance, obeyOneWay = false, files = false }: LaneRules,
): Lane[] {
  const lanes: Lane[] = []
  const lanesFrom: number[][] = graph.xs.map(() => [])
  const endNodes: number[] = []
  const startNodes: number[] = []

  const isClear = (x: number, z: number) =>
    isInsideBounds(x, z, EDGE_MARGIN) && !isNearBuilding(collisions, x, z, clearance)

  graph.links.forEach((links, from) => {
    for (const { to, length, roadWidth, oneWay } of links) {
      if (roadWidth < minRoadWidth || length === 0) continue
      if (obeyOneWay && oneWay === -1) continue

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
        files: files ? filesFor(roadWidth, offset, oneWay === 1) : undefined,
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
