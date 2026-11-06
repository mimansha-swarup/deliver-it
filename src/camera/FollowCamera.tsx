import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

const DISTANCE_BEHIND = 5.2
const HEIGHT = 2.5
const LOOK_AHEAD = 4
const LOOK_HEIGHT = 1

/** How fast the camera swings round behind the scooter. Higher is tighter. */
const TURN_RESPONSE = 5

/** Keeps the camera behind the target, lagging slightly through turns. */
export function FollowCamera({ target }: { target: RefObject<Group | null> }) {
  const cameraHeading = useRef<number | null>(null)

  useFrame(({ camera }, delta) => {
    if (!target.current) return

    const { position, rotation } = target.current
    const previous = cameraHeading.current ?? rotation.y

    // Moves a fraction of the remaining gap, in a way that doesn't depend on frame rate.
    const heading = previous + (rotation.y - previous) * (1 - Math.exp(-TURN_RESPONSE * delta))
    cameraHeading.current = heading

    const forwardX = Math.sin(heading)
    const forwardZ = Math.cos(heading)

    camera.position.set(
      position.x - forwardX * DISTANCE_BEHIND,
      HEIGHT,
      position.z - forwardZ * DISTANCE_BEHIND,
    )
    camera.lookAt(position.x + forwardX * LOOK_AHEAD, LOOK_HEIGHT, position.z + forwardZ * LOOK_AHEAD)
  })

  return null
}
