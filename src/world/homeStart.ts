import type { Spawn } from '../dev/spawn'
import type { Gate } from './houseKit'
import { nearestRoadPiece, type RoadIndex } from './props'
import type { GroundPoint } from './worldUtils'

/*
 * Where a new rider starts: at home, in central HSR. Home is a family house on 16th Cross Road in
 * Sector 2, a quiet residential street just off 27th Main Road, the shop street. The rider starts
 * on the street outside its gate, facing along it towards 27th Main, so the first thing in view is
 * shops and people, never a wall or the edge of the map (which is 180 m east of 27th Main: hence
 * the west arm of 16th Cross, looking east at the shops on its far side). The main dark store is on
 * 27th Main nearby, so the tutorial's first ride is a short one.
 *
 * Fixed points from the map (world metres): the map data doesn't change between visits.
 */

/** On the west arm of 16th Cross Road, Sector 2: home is the family house nearest this. */
export const HOME_NEAR: GroundPoint = [110, -337]
/** Where 16th Cross Road meets 27th Main Road: the rider starts facing it. */
export const HOME_FACING: GroundPoint = [179, -339]
/** On 27th Main Road in Sector 2: the main dark store is the shop front nearest this, within MAIN_STORE_SEARCH metres. */
export const MAIN_STORE_NEAR: GroundPoint = [176, -300]
export const MAIN_STORE_SEARCH = 250

/** The family house's gate nearest a point. */
export function nearestHouseGate(gates: Gate[], near: GroundPoint): Gate | null {
  let best: Gate | null = null
  for (const gate of gates) {
    if (!gate.house) continue
    if (!best || Math.hypot(gate.x - near[0], gate.z - near[1]) < Math.hypot(best.x - near[0], best.z - near[1])) best = gate
  }
  return best
}

/** In the left lane of the street outside a gate, facing a point along it. */
export function startAtGate(gate: Gate, roads: RoadIndex, facing: GroundPoint): Spawn {
  const near = nearestRoadPiece(roads, gate.x, gate.z, 30)
  let [x, z] = [gate.x, gate.z]
  let width = 4
  if (near) {
    const { start, end } = near.piece
    width = near.piece.width
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    const t = Math.max(0, Math.min(1, ((gate.x - start[0]) * (end[0] - start[0]) + (gate.z - start[1]) * (end[1] - start[1])) / (length * length)))
    x = start[0] + (end[0] - start[0]) * t
    z = start[1] + (end[1] - start[1]) * t
  }
  const heading = Math.atan2(facing[0] - x, facing[1] - z)
  // A quarter of the road's width to the left of the middle, as traffic keeps left.
  const left = width / 4
  return { name: 'Home', x: x + Math.cos(heading) * left, z: z - Math.sin(heading) * left, heading }
}
