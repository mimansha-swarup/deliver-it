import { isDebug } from '../dev/spawn'
import { liveVehicle } from '../vehicle/vehicleCatalog'
import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { liveShot } from '../game/livePlayer'
import type { ScooterState } from '../vehicle/ScooterController'
import { getTravelSpeed, isAfoot, scooterLevel } from '../vehicle/ScooterController'
import { liveRoom, ROOM } from '../game/rooms'
import { UP_ON_DECK } from '../world/transitPlacement'
import { tuning } from '../vehicle/tuning'
import { isNearBuilding, type CollisionWorld } from '../world/collision'
import { liveLook, settleLook, useMouseLook } from './mouseLook'

/*
 * Low and close: just over the rider's helmet and a few metres back, so buildings and trees
 * rise over the frame and the road ahead takes less of it. Any lower and the helmet sits on the
 * vanishing point and hides the road ahead; at 2 m it's just under the horizon.
 */
const DISTANCE_BEHIND = 3.8
const HEIGHT = 2
const LOOK_AHEAD = 7
const LOOK_HEIGHT = 1.5

/** How fast the camera swings round behind the scooter. Higher is tighter. */
const TURN_RESPONSE = 5

/** How long the camera takes to fly in from the title view, in seconds. */
const INTRO_TIME = 1.6

/** Wider than it was from higher up, so a close camera still shows the street either side. */
const BASE_FOV = 64
/** Extra field of view at top speed, which makes speed feel faster. */
const SPEED_FOV = 10
const FOV_RESPONSE = 4
const NITRO_FOV = 6

/** How far the camera swings toward the direction of travel in a slide, from 0 to 1. */
const SLIDE_FOLLOW = 0.65

/** In a turn the camera rolls with the scooter's lean, this share of it, and at most this far, in radians. */
const SWAY_SHARE = 0.18
const SWAY_MAX = 0.06
/** How quickly the roll follows the lean: slower than the lean, so it sways rather than snaps. */
const SWAY_RESPONSE = 2.5

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

/** On foot the camera is a little closer and looks a few steps ahead of the rider, at about shoulder height. */
const FOOT_VIEW = { distance: 0.86, height: 0.98, look: 0.9 }
const FOOT_LOOK_AHEAD = 3
const FOOT_LOOK_HEIGHT = 1.3
/** In a room, the camera keeps this far inside its walls and under its ceiling, in metres. */
const ROOM_MARGIN = 0.35

/** Walks backwards from the scooter and returns how far the camera can go. */
function findClearDistance(
  collisions: CollisionWorld,
  x: number,
  z: number,
  forwardX: number,
  forwardZ: number,
  reach = DISTANCE_BEHIND,
): number {
  for (let distance = MIN_DISTANCE; distance < reach; distance += PROBE_STEP) {
    const probeX = x - forwardX * distance
    const probeZ = z - forwardZ * distance
    if (isNearBuilding(collisions, probeX, probeZ, WALL_CLEARANCE)) {
      return Math.max(MIN_DISTANCE, distance - PROBE_STEP)
    }
  }
  return reach
}

/**
 * Keeps the camera behind the target, lagging slightly through turns, and moves
 * it closer when a building would otherwise block the view.
 */
/** A camera held still at a spot, looking at a point, while `active`: for taking the title pictures. */
const photo = { active: false, position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
if (isDebug()) (window as unknown as { __deliverItPhoto?: typeof photo }).__deliverItPhoto = photo

export function FollowCamera({
  scooter,
  collisions,
  deckCollisions,
}: {
  scooter: RefObject<ScooterState>
  collisions: CollisionWorld
  deckCollisions?: (height: number) => CollisionWorld
}) {
  /** How high the scooter is (up on a flyover), eased, so the camera rises with it smoothly. */
  const level = useRef(0)
  const cameraHeading = useRef<number | null>(null)
  const cameraDistance = useRef(DISTANCE_BEHIND)
  const introStart = useRef<Vector3 | null>(null)
  const introTime = useRef(0)
  const shotAmount = useRef(0)
  /** 0 follows the scooter, 1 follows the rider, while they're off it after a crash. */
  const onRider = useRef(0)
  const sway = useRef(0)

  useMouseLook()

  // V swaps between the chase view and the driver's seat, in a vehicle that has one.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'KeyV' || event.repeat || !liveVehicle.spec.cockpit) return
      liveVehicle.cockpit = !liveVehicle.cockpit
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

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
    // On foot by choice, it stays behind the rider as they turn.
    const afoot = isAfoot(state)
    const targetHeading = afoot ? state.rider.heading : riderOff ? previous : state.heading - slipAngle * SLIDE_FOLLOW

    // Moves a fraction of the remaining gap, in a way that doesn't depend on frame rate, the short way round.
    const heading = previous + Math.atan2(Math.sin(targetHeading - previous), Math.cos(targetHeading - previous)) * (1 - Math.exp(-TURN_RESPONSE * delta))
    cameraHeading.current = heading

    // Mouse-look turns the view round the rider from there, and comes back behind them while riding.
    settleLook(travelSpeed, riderOff, delta)
    const forwardX = Math.sin(heading + liveLook.yaw)
    const forwardZ = Math.cos(heading + liveLook.yaw)

    const height = scooterLevel(state)
    level.current += (height - level.current) * (1 - Math.exp(-8 * delta))
    const up = height > UP_ON_DECK
    // The vehicle's own chase view: a van is followed from further back and higher than a scooter.
    const view = afoot ? FOOT_VIEW : liveVehicle.spec.camera
    const indoors = afoot && liveRoom.kind !== null
    // In a room the walls are the room's own (the camera is kept inside them, below); the street's don't apply.
    const clearDistance = indoors ? DISTANCE_BEHIND * view.distance : findClearDistance(up && deckCollisions ? deckCollisions(height) : collisions, focusX, focusZ, forwardX, forwardZ, DISTANCE_BEHIND * view.distance)
    const distance =
      clearDistance < cameraDistance.current
        ? clearDistance // Snap in, or the wall would be visible for a moment.
        : cameraDistance.current +
          (clearDistance - cameraDistance.current) * (1 - Math.exp(-DISTANCE_RESPONSE * delta))
    cameraDistance.current = distance

    // Tilting the look up swings the camera higher over the rider; down, lower behind them.
    const tilt = liveLook.pitch
    const back = distance * (tilt > 0 ? Math.cos(tilt * 0.9) : 1)
    const lift = tilt > 0 ? Math.sin(tilt) * distance * 1.6 : tilt * 4
    camera.position.set(focusX - forwardX * back, Math.max(0.5, HEIGHT * view.height + lift) + level.current, focusZ - forwardZ * back)

    if (indoors) {
      camera.position.x = Math.max(liveRoom.x - ROOM.width / 2 + ROOM_MARGIN, Math.min(liveRoom.x + ROOM.width / 2 - ROOM_MARGIN, camera.position.x))
      camera.position.z = Math.max(liveRoom.z - ROOM.depth / 2 + ROOM_MARGIN, Math.min(liveRoom.z + ROOM.depth / 2 - ROOM_MARGIN, camera.position.z))
      camera.position.y = Math.min(camera.position.y, liveRoom.floorY + ROOM.height - ROOM_MARGIN)
    }

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
    const lookAhead = afoot ? FOOT_LOOK_AHEAD : LOOK_AHEAD * (1 - follow)
    let lookX = focusX + forwardX * lookAhead
    let lookY: number = (afoot ? FOOT_LOOK_HEIGHT : LOOK_HEIGHT * view.look + (RIDER_LOOK_HEIGHT - LOOK_HEIGHT * view.look) * follow) + level.current + (tilt < 0 ? -tilt * 9 : 0)
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
    // From the driver's seat, where the vehicle has one (V): the eye's place in the vehicle, looking
    // down the road. Not during a set shot, or while the rider is off after a crash.
    const seat = liveVehicle.spec.cockpit
    if (seat && liveVehicle.cockpit && amount < 0.001 && follow < 0.01 && introTime.current >= INTRO_TIME) {
      const aheadX = Math.sin(state.heading)
      const aheadZ = Math.cos(state.heading)
      camera.position.set(state.x + aheadX * seat[2] + aheadZ * seat[0], level.current + seat[1], state.z + aheadZ * seat[2] - aheadX * seat[0])
      // The mouse turns the driver's head.
      const lookAtX = Math.sin(state.heading + liveLook.yaw)
      const lookAtZ = Math.cos(state.heading + liveLook.yaw)
      camera.lookAt(camera.position.x + lookAtX * 20, level.current + seat[1] - 1.2 - liveLook.pitch * 14, camera.position.z + lookAtZ * 20)
    }
    // A gentle roll into turns, with the scooter's lean: none in a set shot or while the rider is off.
    const swayTarget = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, state.lean * SWAY_SHARE)) * (1 - follow) * (1 - amount)
    sway.current += (swayTarget - sway.current) * (1 - Math.exp(-SWAY_RESPONSE * delta))
    camera.rotateZ(sway.current)
    // Debug: a camera held still, for taking pictures (`__deliverItPhoto` with ?debug).
    if (photo.active) {
      camera.position.set(...photo.position)
      camera.lookAt(...photo.target)
    }

    if (camera instanceof PerspectiveCamera) {
      // Nitro widens the view a little more, for the rush.
      const targetFov =
        BASE_FOV + SPEED_FOV * Math.min(travelSpeed / tuning.maxSpeed, 1.4) + (state.nitroOn ? NITRO_FOV : 0)
      camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-FOV_RESPONSE * delta))
      camera.updateProjectionMatrix()
    }
  })

  return null
}
