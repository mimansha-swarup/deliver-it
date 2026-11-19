import type { Door, Society } from '../game/doorsteps'
import { addPost, addWall, type CollisionWorld } from './collision'
import { isInsideBounds } from './worldUtils'

/*
 * The gated society: the biggest block of flats on the map that has a compound gate gets a boom
 * barrier across it, a sentry box, a guard and a name board (SocietyGate.tsx). Deliveries to it go
 * past the guard first: the order's OTP, and a line in the visitors' register (missions/Errand.tsx).
 * The name is made up.
 */

export const SOCIETY_NAME = 'Sampige Residency'
/** A block of flats' gate is this wide (houseKit.ts' APARTMENT.gate); the barrier leaves a wicket this wide at the guard's end for people on foot. */
export const SOCIETY_GATE = { width: 4.2, wicket: 0.95 }

export type SocietyPlan = Society & {
  /** Along the gate, towards the guard's end, and out to the street. */
  alongX: number
  alongZ: number
  outX: number
  outZ: number
}

export function planSociety(doors: Door[], collisions: CollisionWorld): SocietyPlan | null {
  let door: Door | null = null
  for (const candidate of doors) {
    if (!candidate.apartment || !candidate.gate || candidate.floors < 3) continue
    if (!isInsideBounds(candidate.gate.x, candidate.gate.z, 80)) continue
    if (!door || candidate.area > door.area) door = candidate
  }
  if (!door?.gate) return null
  const { outX, outZ, gate } = door
  const alongX = outZ
  const alongZ = -outX
  const half = SOCIETY_GATE.width / 2
  // The barrier: solid from the far end of the gate to the wicket by the guard.
  addWall(collisions, [gate.x - alongX * half, gate.z - alongZ * half], [gate.x + alongX * (half - SOCIETY_GATE.wicket), gate.z + alongZ * (half - SOCIETY_GATE.wicket)], 0.16)
  // The sentry box, just inside the wall beside the wicket.
  const boxX = gate.x + alongX * (half + 0.9) - outX * 0.85
  const boxZ = gate.z + alongZ * (half + 0.9) - outZ * 0.85
  addPost(collisions, boxX, boxZ, 0.6)
  return {
    door,
    name: SOCIETY_NAME,
    gate,
    guard: { x: gate.x + alongX * (half + 0.55) + outX * 0.85, z: gate.z + alongZ * (half + 0.55) + outZ * 0.85, heading: Math.atan2(outX, outZ) },
    alongX,
    alongZ,
    outX,
    outZ,
  }
}
