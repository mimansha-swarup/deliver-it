/*
 * Rooms the rider walks into: the dark store's counter, a darshini, a block of flats' lobby and the
 * corridor on a customer's floor. The city's buildings are solid blocks, so a room is its own small
 * set, built only while the rider is in it (world/Rooms.tsx), under the building it belongs to and
 * out of sight of the street. Going through a door is a short fade and a move there; walking is the
 * same walking, kept inside the room's walls and off its furniture.
 *
 * A room is always square to the map: nobody sees it from outside, so it needn't follow its building.
 * Its own space: x across (left negative), z from the back wall (negative) to the door (positive),
 * y up from its floor.
 */

export type RoomKind = 'store' | 'chai' | 'lobby' | 'corridor'

/** How far under the street the rooms are, in metres: out of sight, and out of the sun's reach. */
export const ROOM_DEPTH = -30
/** Every room is this big inside, in metres. */
export const ROOM = { width: 7.2, depth: 6.4, height: 2.9 }

/** Something solid in a room, in its own space: a counter, a table. */
export type Block = { minX: number; maxX: number; minZ: number; maxZ: number }

type Mover = { x: number; z: number }

export const liveRoom = {
  kind: null as RoomKind | null,
  /** The room's middle, in the world, and its floor's height. */
  x: 0,
  z: 0,
  floorY: ROOM_DEPTH,
  blocks: [] as Block[],
  /** Where the rider stands again on leaving: outside the door they came in by. */
  exit: { x: 0, z: 0, heading: 0 },
  /** What it says over the door, and which floor (a corridor's). */
  label: '',
  floor: 0,
  /** The rider can't walk for a moment (a fade, the lift, signing a register). */
  frozen: false,
  /** Keeps something inside the walls and out of the furniture. */
  keepInside(mover: Mover, radius: number) {
    const halfX = ROOM.width / 2 - radius - 0.08
    const halfZ = ROOM.depth / 2 - radius - 0.08
    let x = Math.max(-halfX, Math.min(halfX, mover.x - liveRoom.x))
    let z = Math.max(-halfZ, Math.min(halfZ, mover.z - liveRoom.z))
    for (const block of liveRoom.blocks) {
      if (x <= block.minX - radius || x >= block.maxX + radius || z <= block.minZ - radius || z >= block.maxZ + radius) continue
      // Out by the nearest side.
      const left = x - (block.minX - radius)
      const right = block.maxX + radius - x
      const back = z - (block.minZ - radius)
      const front = block.maxZ + radius - z
      const least = Math.min(left, right, back, front)
      if (least === left) x = block.minX - radius
      else if (least === right) x = block.maxX + radius
      else if (least === back) z = block.minZ - radius
      else z = block.maxZ + radius
    }
    mover.x = liveRoom.x + x
    mover.z = liveRoom.z + z
  },
}

/** A spot in the room's own space, as a place in the world. */
export function roomPoint(x: number, z: number): [number, number] {
  return [liveRoom.x + x, liveRoom.z + z]
}
