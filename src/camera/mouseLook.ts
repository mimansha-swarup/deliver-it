import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useGameStore } from '../game/gameStore'
import { isKey } from '../game/keyBindings'

/*
 * Mouse-look: hold the right mouse button and move, or click the view to lock the pointer (Esc lets
 * go), to orbit the camera round the rider. While riding it swings back behind the rider a moment
 * after the mouse stops; standing still or on foot it stays where it was put. FollowCamera reads
 * `liveLook` every frame.
 */

export const liveLook = {
  /** How far the camera is turned from behind the rider, in radians (positive: round to their left), and tilted up (positive looks down from higher). */
  yaw: 0,
  pitch: 0,
  /** The right button is down, or the pointer is locked to the view. */
  held: false,
  locked: false,
  /** When the mouse last moved the camera (performance.now()). */
  movedAt: 0,
}

const SENSITIVITY = { yaw: 0.0042, pitch: 0.0032 }
/** Up to here below the horizon and above it: never under the road, never straight down. */
const PITCH = { min: -0.28, max: 0.95 }
/** Riding, the view starts to come back this long after the mouse last moved (ms), at this rate (per second). */
const RETURN_AFTER_MS = 900
const RETURN_RATE = 3.2
/** Riding counts as faster than this, in m/s. */
const RIDING_SPEED = 2

/** Eases the look back behind the rider while riding and not being steered by the mouse. Called once a frame. */
export function settleLook(speed: number, onFoot: boolean, dt: number) {
  if (liveLook.yaw === 0 && liveLook.pitch === 0) return
  if (liveLook.held && !liveLook.locked) return
  if (onFoot || speed < RIDING_SPEED) return
  if (performance.now() - liveLook.movedAt < RETURN_AFTER_MS) return
  const keep = Math.exp(-RETURN_RATE * dt)
  liveLook.yaw *= keep
  liveLook.pitch *= keep
  if (Math.abs(liveLook.yaw) < 0.002 && Math.abs(liveLook.pitch) < 0.002) {
    liveLook.yaw = 0
    liveLook.pitch = 0
  }
}

/** Listens to the mouse on the game's view. Mounted with the follow camera. */
export function useMouseLook() {
  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    const playing = () => {
      const game = useGameStore.getState()
      return game.started && !game.photoMode
    }
    const down = (event: MouseEvent) => {
      if (!playing()) return
      if (event.button === 2) liveLook.held = true
      // A click on the view itself locks the pointer to it; Esc lets go.
      else if (event.button === 0 && document.pointerLockElement !== canvas) void canvas.requestPointerLock?.()
    }
    const up = (event: MouseEvent) => {
      if (event.button === 2) liveLook.held = liveLook.locked
    }
    const move = (event: MouseEvent) => {
      if (!liveLook.held || !playing()) return
      liveLook.yaw -= event.movementX * SENSITIVITY.yaw
      // Kept within a turn either way, so coming back never spins the long way round.
      liveLook.yaw = Math.atan2(Math.sin(liveLook.yaw), Math.cos(liveLook.yaw))
      liveLook.pitch = Math.max(PITCH.min, Math.min(PITCH.max, liveLook.pitch + event.movementY * SENSITIVITY.pitch))
      liveLook.movedAt = performance.now()
    }
    const lockChanged = () => {
      liveLook.locked = document.pointerLockElement === canvas
      liveLook.held = liveLook.locked
    }
    const menu = (event: Event) => event.preventDefault()
    // The phone and the map need the pointer back.
    const key = (event: KeyboardEvent) => {
      if (liveLook.locked && (isKey('phone', event.code) || isKey('map', event.code) || isKey('help', event.code))) document.exitPointerLock()
    }
    const blur = () => {
      liveLook.held = liveLook.locked
    }
    canvas.addEventListener('mousedown', down)
    canvas.addEventListener('contextmenu', menu)
    window.addEventListener('mouseup', up)
    window.addEventListener('mousemove', move)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    document.addEventListener('pointerlockchange', lockChanged)
    // Anything that needs a click (a result card, an order offer's buttons) frees the pointer.
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      if (!liveLook.locked) return
      if ((state.lastReward && !previous.lastReward) || (state.shiftSummary && !previous.shiftSummary) || (state.askingOffline && !previous.askingOffline) || (state.photoMode && !previous.photoMode)) document.exitPointerLock()
    })
    return () => {
      canvas.removeEventListener('mousedown', down)
      canvas.removeEventListener('contextmenu', menu)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', blur)
      document.removeEventListener('pointerlockchange', lockChanged)
      unsubscribe()
    }
  }, [canvas])
}
