import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { isNearBuilding, type CollisionWorld } from '../world/collision'

const DISTANCE_BEHIND = 5.2
const HEIGHT = 2.5
const LOOK_AHEAD = 4
const LOOK_HEIGHT = 1

/** How fast the camera swings round behind the scooter. Higher is tighter. */
const TURN_RESPONSE = 5

/** How close the camera may come to the scooter when backed against a wall. */
const MIN_DISTANCE = 1.4
const WALL_CLEARANCE = 0.4
const PROBE_STEP = 0.4
/** How fast the camera drifts back out after being pushed in. */
const DISTANCE_RESPONSE = 3

/** Walks backwards from the scooter and returns how far the camera can go. */
function findClearDistance(
  collisions: CollisionWorld,
  x: number,
  z: number,
  forwardX: number,
  forwardZ: number,
): number {
  for (let distance = MIN_DISTANCE; distance < DISTANCE_BEHIND; distance += PROBE_STEP) {
    const probeX = x - forwardX * distance
    const probeZ = z - forwardZ * distance
    if (isNearBuilding(collisions, probeX, probeZ, WALL_CLEARANCE)) {
      return Math.max(MIN_DISTANCE, distance - PROBE_STEP)
    }
  }
  return DISTANCE_BEHIND
}

/**
 * Keeps the camera behind the target, lagging slightly through turns, and moves
 * it closer when a building would otherwise block the view.
 */
export function FollowCamera({
  target,
  collisions,
}: {
  target: RefObject<Group | null>
  collisions: CollisionWorld
}) {
  const cameraHeading = useRef<number | null>(null)
  const cameraDistance = useRef(DISTANCE_BEHIND)

  useFrame(({ camera }, delta) => {
    if (!target.current) return

    const { position, rotation } = target.current
    const previous = cameraHeading.current ?? rotation.y

    // Moves a fraction of the remaining gap, in a way that doesn't depend on frame rate.
    const heading = previous + (rotation.y - previous) * (1 - Math.exp(-TURN_RESPONSE * delta))
    cameraHeading.current = heading

    const forwardX = Math.sin(heading)
    const forwardZ = Math.cos(heading)

    const clearDistance = findClearDistance(collisions, position.x, position.z, forwardX, forwardZ)
    const distance =
      clearDistance < cameraDistance.current
        ? clearDistance // Snap in, or the wall would be visible for a moment.
        : cameraDistance.current +
          (clearDistance - cameraDistance.current) * (1 - Math.exp(-DISTANCE_RESPONSE * delta))
    cameraDistance.current = distance

    camera.position.set(position.x - forwardX * distance, HEIGHT, position.z - forwardZ * distance)
    camera.lookAt(position.x + forwardX * LOOK_AHEAD, LOOK_HEIGHT, position.z + forwardZ * LOOK_AHEAD)
  })

  return null
}
