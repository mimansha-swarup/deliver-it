/**
 * Values updated every frame by the game loop and read by the minimap and the
 * direction arrow. They're plain objects rather than store state, so that
 * writing to them 60 times a second doesn't re-render anything.
 */
export const livePlayer = { x: 0, z: 0, heading: 0 }

export const liveView = {
  /** Nothing further than this from the rider is drawn, in metres. */
  drawDistance: 1300,
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
