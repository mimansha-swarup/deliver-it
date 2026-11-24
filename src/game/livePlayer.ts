import { create } from 'zustand'
import { createSkyState, getSkyLook } from '../sky/skyLogic'

/**
 * Values updated every frame by the game loop and read by the minimap and the
 * direction arrow. They're plain objects rather than store state, so that
 * writing to them 60 times a second doesn't re-render anything.
 */
/** `bumps` and `gentle`: hard and gentle landings so far (ScooterController), for the tutorial. */
/** `height`: how high the wheels are, in metres: up on a flyover's deck, its height. */
/** `steer`: the bars, -1 to 1. `onFoot`: the rider is off the vehicle and walking; then x, z and heading are the rider's own, and `vehicleX`/`vehicleZ` are where the vehicle stands. */
export const livePlayer = { x: 0, z: 0, heading: 0, bumps: 0, gentle: 0, height: 0, steer: 0, onFoot: false, awayFromOwn: false, indoors: false, vehicleX: 0, vehicleZ: 0, vehicleHeading: 0 }

/** When the player last sounded the horn, as `performance.now()`: people in the road hear it (traffic/Traffic.tsx). */
export const liveHorn = { at: 0 }

/** The sky as it looks right now, worked out each frame by the Sky component. */
export const liveSky = {
  look: getSkyLook(createSkyState()),
  /** How hard it's raining, from 0 to 1. */
  rain: 0,
  /** How windy it is, from 0 to 1. */
  wind: 0.3,
  /** The time of day, from 0 up to 24, and game hours since loading (it never wraps), for shift times. */
  hours: 9,
  totalHours: 0,
  /** Set to an hour to move the clock there, as sleeping does. The Sky picks it up on its next frame. */
  setHoursTo: null as number | null,
}

/** The order's clock, in seconds since its grace ran out: kept by the mission tracker, read at the hand-over. */
export const liveMission = { elapsed: 0 }

export const liveView = {
  /** Nothing further than this from the rider is drawn, in metres. */
  drawDistance: 1300,
  /** The way the camera is looking, around Y, in radians: on foot, W walks this way (FollowCamera.tsx keeps it). */
  cameraYaw: 0,
  /** Set to swing the camera straight round behind the rider (they've stepped through a door): FollowCamera does it and clears it. */
  snapBehind: false,
}

export const liveRoute = {
  /** The road route to the current stop, as x, z, x, z and so on. */
  points: [] as number[],
  /** A point a little way along the route, which the direction arrow aims at. */
  aimX: 0,
  aimZ: 0,
  /** Whether there's a route to follow right now. */
  active: false,
}

/** A camera position that takes over from the normal view for a moment, such as a handover. */
export const liveShot = {
  active: false,
  cameraX: 0,
  cameraZ: 0,
  lookX: 0,
  lookZ: 0,
}

/** Whether the rider is on foot, for the screen (the HUD's badge): set by the mission tracker when it changes. */
export const useOnFoot = create<{ onFoot: boolean }>(() => ({ onFoot: false }))
