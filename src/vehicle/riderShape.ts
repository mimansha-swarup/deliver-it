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
 * How the rider moves on foot, as a set of cycles blended by speed: standing (idle), a turn on the
 * spot, a walk and a jog. Each is the same planted-foot stride as `JOG` with its own numbers, so
 * one blends into the next with no change of footing.
 *
 * `stance`: the share of a stride each foot is on the ground (over half in a walk, when both feet
 * are down between steps; under half in a jog, which has a moment in the air). `reach`: how far a
 * foot lands ahead of the hip. `armSwing`: how far a hand swings, and `armBend`: how much the
 * elbows are held bent (a jog) instead of hanging (a walk). `lean`: how far the body tips
 * forward, in radians. `sway`: how far the hips move over the standing foot, in metres. `twist`:
 * how far the shoulders turn with each step, in radians, the right one forward as the left foot is.
 */
export type Gait = { stance: number; reach: number; footLift: number; crouch: number; sink: number; armSwing: number; armBend: number; lean: number; sway: number; twist: number; feetApart: number }

export const WALK: Gait = { stance: 0.62, reach: 0.44, footLift: 0.075, crouch: 0.012, sink: 0.014, armSwing: 0.25, armBend: 0, lean: 0.035, sway: 0.03, twist: 0.085, feetApart: 0.09 }
export const JOG_GAIT: Gait = { stance: JOG.stance, reach: JOG.reach, footLift: JOG.footLift, crouch: JOG.crouch, sink: JOG.sink, armSwing: 0.24, armBend: 1, lean: 0.2, sway: 0.008, twist: 0.12, feetApart: 0.11 }
/** A step taken turning on the spot: short and low. */
export const SHUFFLE = { reach: 0.1, footLift: 0.045, pace: 0.5 }

/**
 * The walk gives way to the jog between these speeds, in m/s; below `full` a walk's steps shorten
 * with the speed, down to `shortest` of their length, so setting off and pulling up are small steps
 * and not full strides taken slowly; and under `still` there's no stride at all.
 */
export const GAIT_SPEEDS = { walkTo: 2.5, jogFrom: 3.6, full: 1.7, shortest: 0.4, still: 0.45 }

const GAIT_KEYS = Object.keys(WALK) as (keyof Gait)[]

/** The gait for a speed on foot, into `gait`, and how much of a stride there is at all (0 standing, 1 moving). */
export function gaitAt(pace: number, gait: Gait): number {
  const amount = Math.min(1, pace / GAIT_SPEEDS.still)
  const jog = Math.min(1, Math.max(0, (pace - GAIT_SPEEDS.walkTo) / (GAIT_SPEEDS.jogFrom - GAIT_SPEEDS.walkTo)))
  const blend = jog * jog * (3 - 2 * jog)
  for (const key of GAIT_KEYS) gait[key] = WALK[key] + (JOG_GAIT[key] - WALK[key]) * blend
  const short = GAIT_SPEEDS.shortest + (1 - GAIT_SPEEDS.shortest) * Math.min(1, pace / GAIT_SPEEDS.full)
  gait.reach *= short + (1 - short) * blend
  return amount
}

/** Radians of stride per metre at a speed on foot: what keeps the planted foot still on the ground, whatever the gait. */
export function stridePerMetre(pace: number): number {
  gaitAt(pace, scratchGait)
  return (Math.PI * 2 * scratchGait.stance) / (2 * scratchGait.reach)
}
const scratchGait: Gait = { ...WALK }

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
