/** TEMPORARY: where J jumps to (see DevTeleport.tsx). Filled in as the world is built. */
export type TeleportSpot = { name: string; x: number; z: number; heading: number }

export const teleportSpots: TeleportSpot[] = []
