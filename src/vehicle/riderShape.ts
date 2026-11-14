import * as THREE from 'three'

/**
 * Where the rider's hips sit, from the scooter's middle. A thrown rider turns
 * around this point, and `SEAT_BACK` in ScooterController matches its z.
 */
export const HIP = new THREE.Vector3(0, 0.93, -0.36)

/**
 * How the rider jogs back to the scooter after a fall. It works like the
 * pedestrians' walk (see `GAIT` in traffic/gait.ts): each foot is planted for
 * `stance` of a stride, sliding back as fast as the body moves, then lifted and
 * swung forward. A jog spends less of it on the ground, and lifts the feet higher.
 */
export const JOG = {
  /** Metres per second, once up to pace. */
  speed: 3.2,
  stance: 0.35,
  /** How far a foot lands in front of the hip, and leaves behind it, in metres. */
  reach: 0.36,
  footLift: 0.2,
  /** The hips sit lower while jogging, with bent knees, and sink a little more on each landing. */
  crouch: 0.04,
  sink: 0.04,
}

/** Radians of stride per metre, so the planted foot keeps pace with the ground. A whole turn is two steps. */
export const JOG_STRIDE_PER_METRE = (Math.PI * 2 * JOG.stance) / (2 * JOG.reach)

/**
 * A ball that stands for part of a body or bike when checking what touches the
 * ground: its middle, in the space of whatever it belongs to, and its radius.
 * Checking a few dozen balls is far cheaper than every corner of the shapes.
 */
export type Probe = { point: THREE.Vector3; radius: number }

/**
 * Balls standing for the rider's body, for keeping them above the ground.
 * `Rider` moves them to where each part is, every frame, in this order.
 */
const RIDER_PROBE_SIZES = [
  0.19, // hips
  0.17, // waist
  0.19, // chest
  0.16, // helmet
  0.06, 0.06, // elbows
  0.05, 0.05, // hands
  0.08, 0.08, // knees
  0.05, 0.05, // feet
]
export function createRiderProbes(): Probe[] {
  return RIDER_PROBE_SIZES.map((radius) => ({ point: new THREE.Vector3(), radius }))
}
