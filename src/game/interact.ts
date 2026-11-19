/*
 * Things the rider can use on foot with the interact key (E): a door, a counter, a doorbell, a guard.
 * Whatever owns one sets it under its own id while it applies and clears it when it doesn't; the
 * on-foot controller (vehicle/OnFoot.tsx) finds the nearest in reach and shows it as the prompt.
 * Also "interests": places worth getting off the vehicle for, which is when "F · Get off" shows.
 */

export type Spot = {
  x: number
  z: number
  /** How near the rider must be, in metres. */
  radius: number
  /** What the prompt says after the key: "Pick up", "Ring the bell". */
  text: string
  run: () => void
  /** Only in this room (game/rooms.ts), or only out on the street when left out. */
  room?: string
  /** Among spots in reach, the highest wins; then the nearest. */
  priority?: number
}

const spots = new Map<string, Spot>()

export function setSpot(id: string, spot: Spot | null) {
  if (spot) spots.set(id, spot)
  else spots.delete(id)
}

/** Clears every spot whose id starts with a prefix: a whole errand's, or a room's. */
export function clearSpots(prefix: string) {
  for (const id of [...spots.keys()]) if (id.startsWith(prefix)) spots.delete(id)
}

/** The spot in reach of a point to use now, or null. `room`: the room the rider is in, or null on the street. */
export function spotInReach(x: number, z: number, room: string | null): Spot | null {
  let best: Spot | null = null
  let bestScore = -Infinity
  for (const spot of spots.values()) {
    if ((spot.room ?? null) !== room) continue
    const distance = Math.hypot(spot.x - x, spot.z - z)
    if (distance > spot.radius) continue
    const score = (spot.priority ?? 0) * 100 - distance
    if (score > bestScore) {
      best = spot
      bestScore = score
    }
  }
  return best
}

/** Places worth getting off for: an order's stop, a chai stall. `reach`: within this many metres, stopped, the get-off prompt shows. */
type Interest = { x: number; z: number; reach: number }
const interests = new Map<string, Interest>()

export function setInterest(id: string, interest: Interest | null) {
  if (interest) interests.set(id, interest)
  else interests.delete(id)
}

/** Fixed places of interest (chai stalls), set once the world is planned. */
export const fixedInterests: { list: Interest[] } = { list: [] }

export function isNearInterest(x: number, z: number): boolean {
  for (const { x: ix, z: iz, reach } of interests.values()) if (Math.hypot(ix - x, iz - z) < reach) return true
  for (const { x: ix, z: iz, reach } of fixedInterests.list) if (Math.hypot(ix - x, iz - z) < reach) return true
  return false
}
