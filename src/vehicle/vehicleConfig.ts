import { PLAY_AREA } from '../world/worldUtils'

/** Everything that affects how the scooter feels. Speeds are in metres per second. */
export const SCOOTER = {
  maxSpeed:  14, //14, // about 50 km/h
  maxReverseSpeed: 3,
  /** Engine pull from a standstill, and what's left of it near top speed. */
  acceleration: 6.5,
  topEndAcceleration: 1.8,
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
  /** Slowing back down after going over the speed limit. */
  overspeedDrag: 3,

  /** How far the scooter tilts in corners, in radians. */
  maxLean: 0.38,
  leanRate: 7,
  /** How far the nose lifts under power and dips under braking, in radians. */
  pitchUnderPower: 0.05,
  pitchUnderBraking: 0.07,
  pitchRate: 0.5,

  wheelRadius: 0.296,

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
