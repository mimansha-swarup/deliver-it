import { FILE_PREFIX } from '../game/brand'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'

/*
 * Photo mode, from the phone's Camera app: the game pauses (R3F's clock stops, so every frame's
 * delta is 0 and nothing moves), a free camera flies about, the HUD hides, and Space saves the
 * picture as a PNG. Esc goes back to riding, and an order offer gets back the time it was paused.
 */

/** Metres a second, and with Shift. */
const SPEED = 8
const FAST = 25
/** Radians per pixel of mouse drag. */
const LOOK = 0.004
const MIN_FOV = 20
const MAX_FOV = 80

/** Keys held, and a drag in progress, shared between the DOM overlay and the camera. */
const input = { keys: new Set<string>(), dragging: false, lookX: 0, lookY: 0, zoom: 0, save: false }

type Pose = { position: THREE.Vector3; yaw: number; pitch: number; fov: number }

/** Stops the game's clock: with auto-start off, a stopped clock gives every frame a delta of 0. Returns how far it had run. */
function pauseClock(clock: THREE.Clock): number {
  const elapsed = clock.elapsedTime
  clock.autoStart = false
  clock.stop()
  return elapsed
}

function resumeClock(clock: THREE.Clock, elapsed: number) {
  clock.start()
  clock.elapsedTime = elapsed
  clock.autoStart = true
}

function poseOf(camera: THREE.PerspectiveCamera): Pose {
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  return { position: camera.position.clone(), yaw: euler.y, pitch: euler.x, fov: camera.fov }
}

function applyPose(camera: THREE.PerspectiveCamera, pose: Pose) {
  camera.position.copy(pose.position)
  camera.quaternion.setFromEuler(new THREE.Euler(pose.pitch, pose.yaw, 0, 'YXZ'))
  if (camera.fov !== pose.fov) {
    camera.fov = pose.fov
    camera.updateProjectionMatrix()
  }
  camera.updateMatrixWorld()
}

/** In the Canvas: pauses the clock, flies the camera, and takes the picture after it's drawn. */
export function PhotoCamera() {
  const on = useGameStore((state) => state.photoMode)
  const clock = useThree((state) => state.clock)
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const gl = useThree((state) => state.gl)
  const pose = useRef<Pose | null>(null)
  const last = useRef(0)

  useEffect(() => {
    if (!on) return
    const pausedAt = performance.now()
    const before = poseOf(camera)
    const elapsed = pauseClock(clock)
    pose.current = { ...before, position: before.position.clone() }
    last.current = performance.now()
    return () => {
      resumeClock(clock, elapsed)
      applyPose(camera, { ...before, position: camera.position.clone(), yaw: poseOf(camera).yaw, pitch: poseOf(camera).pitch })
      useGameStore.getState().extendOffer(performance.now() - pausedAt)
      pose.current = null
      input.keys.clear()
    }
  }, [on, clock, camera])

  // After the follow camera (0), before the effects draw the frame (1).
  useFrame(() => {
    const state = pose.current
    if (!state) return
    const now = performance.now()
    const dt = Math.min(0.1, (now - last.current) / 1000)
    last.current = now

    state.yaw -= input.lookX * LOOK
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - input.lookY * LOOK))
    input.lookX = 0
    input.lookY = 0
    state.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, state.fov + input.zoom * 0.02))
    input.zoom = 0

    const speed = (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? FAST : SPEED) * dt
    const forward = new THREE.Vector3(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch))
    const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw))
    if (input.keys.has('KeyW')) state.position.addScaledVector(forward, speed)
    if (input.keys.has('KeyS')) state.position.addScaledVector(forward, -speed)
    if (input.keys.has('KeyD')) state.position.addScaledVector(right, speed)
    if (input.keys.has('KeyA')) state.position.addScaledVector(right, -speed)
    if (input.keys.has('KeyE')) state.position.y += speed
    if (input.keys.has('KeyQ')) state.position.y = Math.max(0.5, state.position.y - speed)

    applyPose(camera, state)
  }, 0.5)

  // Right after the frame is drawn, while the picture is still in the canvas.
  useFrame(() => {
    if (!input.save || !pose.current) return
    input.save = false
    const link = document.createElement('a')
    link.download = `${FILE_PREFIX}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
    link.href = gl.domElement.toDataURL('image/png')
    link.click()
  }, 2)

  return null
}

/** Over the screen in photo mode: how to move, and the buttons. Also where the input comes from. */
export function PhotoModeUi() {
  const on = useGameStore((state) => state.photoMode)
  const setPhotoMode = useGameStore((state) => state.setPhotoMode)

  useEffect(() => {
    if (!on) return
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Escape') setPhotoMode(false)
      else if (event.code === 'Space') {
        event.preventDefault()
        input.save = true
      } else input.keys.add(event.code)
    }
    const up = (event: KeyboardEvent) => input.keys.delete(event.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [on, setPhotoMode])

  if (!on) return null
  return (
    <div
      className="photo-mode"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        input.dragging = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!input.dragging) return
        input.lookX += event.movementX
        input.lookY += event.movementY
      }}
      onPointerUp={() => {
        input.dragging = false
      }}
      onWheel={(event) => {
        input.zoom += event.deltaY
      }}
    >
      <p className="photo-mode-hint">
        Photo mode · W A S D move · drag to look · Q / E down, up · Shift faster · scroll to zoom
      </p>
      <p className="photo-mode-buttons">
        <button type="button" onClick={() => (input.save = true)}>
          Save picture · Space
        </button>
        <button type="button" onClick={() => setPhotoMode(false)}>
          Back to riding · Esc
        </button>
      </p>
    </div>
  )
}
