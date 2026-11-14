/** How people's legs move when they walk. Shared by the shapes, the shader and the walking logic. */

export const HIP = 0.86
/** The knee, halfway down the leg. The leg has a ring of corners here, so it can bend. */
export const KNEE = 0.46

/**
 * How people walk. Each foot spends `stance` of a stride planted on the
 * ground, sliding back under the body exactly as fast as the body moves, and
 * the rest lifted and swung forward. The other foot does the same half a
 * stride later. A foot reaches `reach` metres in front of the hip, and as far
 * behind. Moving at the same pace as the ground is what stops feet skating.
 */
export const GAIT = {
  stance: 0.55,
  reach: 0.32,
  /** The thigh and shin, in metres. Together they're the leg, hip to sole. */
  thigh: HIP - KNEE,
  shin: KNEE,
  /** How high a swinging foot lifts, and how far the hips dip as weight passes from one foot to the other. */
  footLift: 0.11,
  hipDip: 0.045,
  /** How far an arm swings each way, in radians. */
  armSwing: 0.32,
}

/**
 * A full stride is two steps. With the foot planted for `stance` of it, and
 * covering twice `reach` while planted, the body moves `2 * reach / stance`
 * metres each stride. `stride` counts in radians, a whole turn each stride.
 */
export const STRIDE_PER_METRE = (Math.PI * 2 * GAIT.stance) / (2 * GAIT.reach)
