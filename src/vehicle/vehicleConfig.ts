import { PLAY_AREA } from '../world/worldUtils'

/** Everything that affects how the scooter feels. Speeds are in metres per second. */
export const SCOOTER = {
  maxSpeed: 15.56, // 56 km/h. It was 14, about 50 km/h.
  maxReverseSpeed: 3,
  /**
   * Engine pull from a standstill, and what's left of it near top speed, in m/s².
   * It tapers evenly in between (see `engineForce`): 40 km/h in about 3 s and
   * 54 km/h in about 5 s. It was 6.5 and 1.8, tapering late, which reached top
   * speed in 3.2 s (too quick), then 4 and 1, which took 6.7 s (too slow).
   */
  acceleration: 5.25,
  topEndAcceleration: 1.4,
  reverseAcceleration: 3,
  braking: 11,
  coasting: 1.6,

  /** Slowing while the handbrake is held, without and with the throttle. */
  handbrake: 7,
  powerSlideDrag: 2.2,

  /** How quickly the handlebars reach full lock, in full turns of input per second. */
  steerRate: 5,
  /** Turning speed in radians per second, at low speed and at top speed. */
  turnRateLow: 2,
  turnRateHigh: 1,
  /** Below `slowTurnSpeed` (m/s, about 20 km/h) turning is up to this share sharper, most at a crawl. */
  slowTurnBoost: 0.35,
  slowTurnSpeed: 5.6,
  /** Below this speed, steering fades out, so a parked scooter can't spin on the spot. */
  fullSteeringSpeed: 4,

  /** How strongly the tyres cancel sideways sliding, each second. */
  grip: 12,
  driftGrip: 1.4,
  /** How quickly grip changes when the handbrake goes on or off. */
  gripChangeRate: 30,

  /** Drifting needs at least this much forward speed. */
  driftMinSpeed: 6,
  /** Extra turning speed while drifting. */
  driftTurnBoost: 1.5,
  /** The furthest the scooter can rotate past its direction of travel, in radians. */
  maxDriftAngle: 0.9,
  /** Share of lost sideways speed turned into forward speed as the tyres bite. */
  slideRecovery: 0.35,
  /** The same, with the throttle held during a drift. This is what keeps a drift alive. */
  powerSlideRecovery: 0.8,
  /** Sideways speed that counts as a real slide, for boosts and skid marks. */
  slipThreshold: 1.2,

  /** Hold a slide this long, and letting go gives a boost. */
  boostChargeTime: 0.7,
  boostTime: 0.8,
  boostSpeed: 3,
  boostAcceleration: 9,
  /**
   * Nitro: hold Shift with the throttle for a burst of speed, on top of top speed
   * (5 m/s is 18 km/h more, about 74 km/h). A full tank lasts `nitroBurnTime`. It
   * fills while riding, fastest near top speed (empty to full in `nitroFillTime`),
   * and each drift boost adds `nitroFromBoost`. It needs a little in the tank to start.
   */
  nitroSpeed: 5,
  nitroAcceleration: 7,
  nitroBurnTime: 3.5,
  nitroFillTime: 40,
  nitroFromBoost: 0.2,
  nitroMinToStart: 0.15,
  /** A new game starts with this much, so it can be tried straight away. */
  nitroStart: 0.6,
  /**
   * Slowing back down to top speed after a nitro burst or a drift boost, with the
   * throttle held, in m/s². Gentle, so the speed carries on for a few seconds:
   * from full nitro speed (74 km/h) back to 56 km/h takes about 4 s. It was 3, which took 1.7 s.
   */
  overspeedDrag: 1.2,

  /** How far the scooter tilts in corners, in radians. */
  maxLean: 0.38,
  leanRate: 7,
  /** How far the nose lifts under power and dips under braking, in radians. */
  pitchUnderPower: 0.05,
  pitchUnderBraking: 0.07,
  pitchRate: 0.5,

  wheelRadius: 0.296,
  /** Where the axles are, in metres forward of the scooter's middle. From the model. */
  frontAxle: 0.654,
  rearAxle: -0.564,
  /**
   * A tyre rolls up a step over a little forward travel: this much height per
   * metre. A 13 cm kerb takes about a quarter of a metre, as a real wheel does.
   */
  /** A tyre on the ground follows it down slopes no steeper than this (drop per metre travelled); steeper is an edge it falls off. */
  stickSlope: 0.3,
  climbPerMetre: 0.55,
  /** Even at a crawl, a tyre gets up a step this fast, in metres per second. */
  climbAtCrawl: 0.3,
  /**
   * The share of a tyre's upward speed, rolling up a hump, that it keeps once over
   * the top. The suspension soaks up the rest. A breaker at 40 km/h is a small hop.
   */
  launchShare: 0.35,
  /** The most upward speed a tyre leaves the ground with, in m/s: a hop of about 7 cm. A kerb at speed would otherwise throw it 30 cm. */
  maxLaunch: 1.2,
  /** Landing faster than this, in m/s, is a jolt. Each jolt takes up to this share of the speed. */
  joltSpeed: 0.9,
  /**
   * Below this share of the top speed, a breaker or pothole is taken gently: no bump, no thud, no
   * jolt, and a fragile order doesn't mind. Riding over one slowly is what a careful rider does.
   */
  bumpSpeedShare: 0.5,
  /** A landing at least this hard (metres a second) counts as going over a breaker or into a pothole, however slowly. */
  gentleLanding: 0.25,
  landingSpeedLoss: 0.12,
  /** How wet the ground must be to splash, from 0 to 1, and how fast the scooter must go, in m/s. */
  splashWetness: 0.25,
  splashSpeed: 3,
  /** A puddle takes this share of the tyres' grip, which comes back at this rate, each second. */
  puddleGripLoss: 0.6,
  puddleGripReturn: 2.5,

  /** The scooter counts as a circle of this radius when it hits things. */
  collisionRadius: 0.6,
  /** The weight of the scooter, rider and load, in kilograms. */
  mass: 180,
  /** Hitting a wall faster than this is a crash, in metres per second. */
  wallCrashSpeed: 7,
  /** Being knocked by more than this much speed by anything else is a crash. */
  impactCrashSpeed: 6.5,
  /** How long a crash takes from start to riding again, in seconds. */
  crashTime: 1.7,
  /** The last part of that time is spent getting back up. */
  getUpTime: 0.6,
  /** Faster than this, a crash throws the rider off, in m/s (about 14 km/h). Slower, they topple with it. */
  throwOffSpeed: 4,
  /** How quickly the scooter skids to a stop on its side. */
  crashSkid: 1.6,
  /** How far it tips over in a crash, in radians. */
  crashLean: 1.3,
  /** Share of the speed kept when bouncing off a wall in a crash. */
  wallBounce: 0.3,
  /** Hits more direct than this are head-on, and don't deflect. 1 is dead straight. */
  headOnThreshold: 0.8,
  /** How quickly a glancing hit swings the scooter along the wall. */
  wallDeflectRate: 14,
  /** How quickly the throttle turns a nose pressed against something, so nobody gets stuck. */
  wallNudgeRate: 1.8,
}

/** On a real road in the play area, pointing along it. */
export const SCOOTER_SPAWN = {
  x: 52.8,
  z: -130.2,
  heading: Math.atan2(-0.9, 90),
}

/** The invisible barrier, a metre inside the wall. */
export const WORLD_LIMITS = {
  minX: PLAY_AREA.minX + 1,
  maxX: PLAY_AREA.maxX - 1,
  minZ: PLAY_AREA.minZ + 1,
  maxZ: PLAY_AREA.maxZ - 1,
}
