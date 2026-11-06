import { PLAY_AREA_SIZE } from '../world/worldUtils'

/** Everything that affects how the scooter feels. Speeds are in metres per second. */
export const SCOOTER = {
  maxSpeed: 14, // about 50 km/h
  maxReverseSpeed: 3,
  acceleration: 5,
  reverseAcceleration: 3,
  braking: 11,
  handbrake: 15,
  coasting: 1.6,

  /** How quickly the handlebars reach full lock, in full turns of input per second. */
  steerRate: 5,
  /** Turning speed in radians per second, at low speed and at top speed. */
  turnRateLow: 2,
  turnRateHigh: 1,
  /** Below this speed, steering fades out, so a parked scooter can't spin on the spot. */
  fullSteeringSpeed: 4,

  /** How far the scooter tilts in corners, in radians. */
  maxLean: 0.38,
  leanRate: 7,

  wheelRadius: 0.25,
}

/** On a real road in the play area, pointing along it. */
export const SCOOTER_SPAWN = {
  x: 52.8,
  z: -130.2,
  heading: Math.atan2(-0.9, 90),
}

/** The invisible barrier, measured from the centre of the world. */
export const WORLD_LIMIT = PLAY_AREA_SIZE / 2 - 1
