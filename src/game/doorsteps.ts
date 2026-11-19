import type { DoorScene } from './gameTypes'

/*
 * Front doors: where an order is really delivered. The world lists every house's and block of
 * flats' door as it's planned (world/houseKit.ts); the mission planner picks the one nearest a
 * customer's stop on the road, and the errand (missions/Errand.tsx) walks the rider to it.
 */

export type Door = {
  /** Just outside the door, on the front wall, and the way the wall faces. */
  x: number
  z: number
  outX: number
  outZ: number
  floors: number
  apartment: boolean
  /** The compound gate in front of it, if it has a compound wall. */
  gate: { x: number; z: number } | null
  /** The building's footprint, in square metres. */
  area: number
}

/** A gated society: a big block of flats with a guard at its gate (world/SocietyGate.tsx). */
export type Society = { door: Door; name: string; gate: { x: number; z: number }; guard: { x: number; z: number; heading: number } }

export const doorsteps = { doors: [] as Door[], society: null as Society | null }

/** How far from a customer's road point their door may be, in metres. */
const DOOR_REACH = 42

/**
 * The door for a customer whose stop is at a road point: the nearest one that faces that stretch of
 * road, so the walk from the kerb is across the footpath, not round the block.
 */
export function findDoorstep(x: number, z: number): Door | null {
  let best: Door | null = null
  let bestScore = Infinity
  for (const door of doorsteps.doors) {
    const awayX = x - door.x
    const awayZ = z - door.z
    const distance = Math.hypot(awayX, awayZ)
    if (distance > DOOR_REACH) continue
    // In front of the door, not behind its building or far off to one side of it.
    const front = awayX * door.outX + awayZ * door.outZ
    if (front < 2) continue
    const side = Math.abs(awayX * door.outZ - awayZ * door.outX)
    const score = distance + side * 0.8
    if (score < bestScore) {
      best = door
      bestScore = score
    }
  }
  return best
}

/**
 * The hand-over as it stands, shared by the errand (which runs it) and the scene (missions/Handoff.tsx,
 * which shows it): whether the customer has come out, where they stand if not at the order's own
 * spot (a corridor upstairs), and the doorstep's little scene.
 */
export const errandLive = {
  customerOut: true,
  customerAt: null as { x: number; z: number; rotation: number; floorY: number | null } | null,
  scene: 'plain' as DoorScene,
  /** The society's guard has seen the OTP and the register is signed. */
  cleared: false,
}
