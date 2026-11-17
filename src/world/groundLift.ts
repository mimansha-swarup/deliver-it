/**
 * How far something standing at a point must be lifted to stand on the ground
 * there: on a raised footpath, its height; elsewhere 0, as before. Set once the
 * world is built (see buildStreetEdges in streetEdgeGeometry.ts), and read by everything placed on the
 * street: parked scooters, carts, people.
 */
export const groundLift = {
  at: (x: number, z: number): number => {
    void x
    void z
    return 0
  },
}

/** A parked scooter's wheels are about this far ahead of and behind its middle, in metres. */
const WHEEL_REACH = 0.65
/** How far a scooter may be slid along its length to get both wheels on one level, in metres. */
const SLIDES = [0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.5, -1.5]

type Parked = { x: number; z: number; rotation: number }

/**
 * Parked scooters stand nose-in or tail-in to the shops, which on a raised
 * footpath can leave one wheel up on the footpath and the other down in the
 * soil behind it, or in the road. Each one whose wheels aren't on one level is
 * slid along its length until they are, or taken away if no spot nearby works.
 */
export function settleParkedScooters<T extends Parked>(
  scooters: T[],
  liftAt: (x: number, z: number) => number,
  isFree: (x: number, z: number) => boolean,
): T[] {
  const isLevel = (x: number, z: number, forwardX: number, forwardZ: number) => {
    const middle = liftAt(x, z)
    return (
      liftAt(x + forwardX * WHEEL_REACH, z + forwardZ * WHEEL_REACH) === middle &&
      liftAt(x - forwardX * WHEEL_REACH, z - forwardZ * WHEEL_REACH) === middle
    )
  }
  return scooters.flatMap((scooter) => {
    const forwardX = Math.sin(scooter.rotation)
    const forwardZ = Math.cos(scooter.rotation)
    if (isLevel(scooter.x, scooter.z, forwardX, forwardZ)) return [scooter]
    for (const slide of SLIDES) {
      const x = scooter.x + forwardX * slide
      const z = scooter.z + forwardZ * slide
      if (isLevel(x, z, forwardX, forwardZ) && isFree(x, z)) return [{ ...scooter, x, z }]
    }
    return []
  })
}
