import type * as THREE from 'three'

/* Stopping and starting the game's clock, for photo mode and the pause menu. */

/** Stops the game's clock: with auto-start off, a stopped clock gives every frame a delta of 0. Returns how far it had run. */
export function pauseClock(clock: THREE.Clock): number {
  const elapsed = clock.elapsedTime
  clock.autoStart = false
  clock.stop()
  return elapsed
}

export function resumeClock(clock: THREE.Clock, elapsed: number) {
  clock.start()
  clock.elapsedTime = elapsed
  clock.autoStart = true
}
