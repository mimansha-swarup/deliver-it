import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { liveShot } from '../game/livePlayer'
import type { ScooterState } from '../vehicle/ScooterController'
import { getTravelSpeed } from '../vehicle/ScooterController'
import { tuning } from '../vehicle/tuning'
import { isNearBuilding, type CollisionWorld } from '../world/collision'

const DISTANCE_BEHIND = 5.2
const HEIGHT = 2.5
const LOOK_AHEAD = 4
const LOOK_HEIGHT = 1

/** How fast the camera swings round behind the scooter. Higher is tighter. */
const TURN_RESPONSE = 5

/** How long the camera takes to fly in from the title view, in seconds. */
const INTRO_TIME = 1.6

const BASE_FOV = 60
/** Extra field of view at top speed, which makes speed feel faster. */
const SPEED_FOV = 12
const FOV_RESPONSE = 4

/** How far the camera swings toward the direction of travel in a slide, from 0 to 1. */
const SLIDE_FOLLOW = 0.65

/** How close the camera may come to the scooter when backed against a wall. */
const MIN_DISTANCE = 1.4
const WALL_CLEARANCE = 0.4
const PROBE_STEP = 0.4
/** How fast the camera drifts back out after being pushed in. */
const DISTANCE_RESPONSE = 3

/** How high the camera sits for a moment like a handover, and what it looks at. */
const SHOT_HEIGHT = 1.75
const SHOT_LOOK_HEIGHT = 1.05
/** How quickly the camera moves in and out of such a moment. */
const SHOT_RESPONSE = 3.5

/** How far the camera rattles in the hardest hit, in metres. */
const SHAKE_SIZE = 0.35
/** How quickly the camera moves over to a thrown rider, and back to the scooter. */
const RIDER_FOLLOW_RESPONSE = 3.5
/** Where the camera looks on a rider who's down: lower than on the scooter. */
const RIDER_LOOK_HEIGHT = 0.6

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
  scooter,
  collisions,
}: {
  scooter: RefObject<ScooterState>
  collisions: CollisionWorld
}) {
  const cameraHeading = useRef<number | null>(null)
  const cameraDistance = useRef(DISTANCE_BEHIND)
  const introStart = useRef<Vector3 | null>(null)
  const introTime = useRef(0)
  const shotAmount = useRef(0)
  /** 0 follows the scooter, 1 follows the rider, while they're off it after a crash. */
  const onRider = useRef(0)

  useFrame(({ camera, clock }, delta) => {
    const state = scooter.current
    introStart.current ??= new Vector3().copy(camera.position)
    const travelSpeed = getTravelSpeed(state)

    // After a crash, follow the rider rather than the scooter, and come back once they're on it again.
    const riderOff = state.rider.phase !== 'on' && state.rider.phase !== 'mounting'
    onRider.current += ((riderOff ? 1 : 0) - onRider.current) * (1 - Math.exp(-RIDER_FOLLOW_RESPONSE * delta))
    const follow = onRider.current
    const focusX = state.x + (state.rider.x - state.x) * follow
    const focusZ = state.z + (state.rider.z - state.z) * follow

    // In a slide, look partly along the direction of travel, so the scooter is
    // seen turned sideways against it.
    const slipAngle = travelSpeed > 3 ? Math.atan2(state.slip, Math.max(state.speed, 1)) : 0
    const previous = cameraHeading.current ?? state.heading
    // While the rider is off, the camera holds its direction instead of spinning with the fallen scooter.
    const targetHeading = riderOff ? previous : state.heading - slipAngle * SLIDE_FOLLOW

    // Moves a fraction of the remaining gap, in a way that doesn't depend on frame rate.
    const heading = previous + (targetHeading - previous) * (1 - Math.exp(-TURN_RESPONSE * delta))
    cameraHeading.current = heading

    const forwardX = Math.sin(heading)
    const forwardZ = Math.cos(heading)

    const clearDistance = findClearDistance(collisions, focusX, focusZ, forwardX, forwardZ)
    const distance =
      clearDistance < cameraDistance.current
        ? clearDistance // Snap in, or the wall would be visible for a moment.
        : cameraDistance.current +
          (clearDistance - cameraDistance.current) * (1 - Math.exp(-DISTANCE_RESPONSE * delta))
    cameraDistance.current = distance

    camera.position.set(focusX - forwardX * distance, HEIGHT, focusZ - forwardZ * distance)

    // A hit rattles the camera. Two speeds of wobble stop it looking regular.
    camera.position.x += Math.sin(clock.elapsedTime * 47) * state.impact * SHAKE_SIZE
    camera.position.y += Math.sin(clock.elapsedTime * 61) * state.impact * SHAKE_SIZE * 0.6

    // Blends from the title view, starting and finishing gently.
    if (introTime.current < INTRO_TIME) {
      introTime.current += delta
      const progress = Math.min(introTime.current / INTRO_TIME, 1)
      const eased = progress * progress * (3 - 2 * progress)
      camera.position.lerp(introStart.current, 1 - eased)
    }

    // On the rider, look at them rather than ahead of them.
    const lookAhead = LOOK_AHEAD * (1 - follow)
    let lookX = focusX + forwardX * lookAhead
    let lookY: number = LOOK_HEIGHT + (RIDER_LOOK_HEIGHT - LOOK_HEIGHT) * follow
    let lookZ = focusZ + forwardZ * lookAhead

    // Eases across to a set shot and back, so that it never cuts.
    const shotTarget = liveShot.active ? 1 : 0
    shotAmount.current += (shotTarget - shotAmount.current) * (1 - Math.exp(-SHOT_RESPONSE * delta))
    const amount = shotAmount.current * shotAmount.current * (3 - 2 * shotAmount.current)
    if (amount > 0.001) {
      camera.position.x += (liveShot.cameraX - camera.position.x) * amount
      camera.position.y += (SHOT_HEIGHT - camera.position.y) * amount
      camera.position.z += (liveShot.cameraZ - camera.position.z) * amount
      lookX += (liveShot.lookX - lookX) * amount
      lookY += (SHOT_LOOK_HEIGHT - lookY) * amount
      lookZ += (liveShot.lookZ - lookZ) * amount
    }

    camera.lookAt(lookX, lookY, lookZ)

    if (camera instanceof PerspectiveCamera) {
      const targetFov = BASE_FOV + SPEED_FOV * Math.min(travelSpeed / tuning.maxSpeed, 1.2)
      camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-FOV_RESPONSE * delta))
      camera.updateProjectionMatrix()
    }
  })

  return null
}
