import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import type { ScooterState } from './ScooterController'

/** Brightness at full night, in candela, as three.js measures lights. */
export const HEADLIGHT_INTENSITY = 110
/** Beyond this, in metres, a headlight lights nothing. */
export const HEADLIGHT_RANGE = 34
/** Half the beam's angle, and how soft its edge is, from 0 hard to 1 soft. */
export const HEADLIGHT_ANGLE = 0.5
export const HEADLIGHT_SOFTNESS = 0.65
export const HEADLIGHT_COLOR = '#fff0cf'
/** How high the lamp is, and how far ahead and down it aims. */
const LAMP_HEIGHT = 0.95
const LAMP_FORWARD = 0.7
const AIM_AHEAD = 18

/**
 * The scooter's headlight: a real spotlight, so it lights whatever it falls on,
 * the road, walls, people and other vehicles. It's always in the scene and only
 * turned up at night, because adding or removing a light makes three.js rebuild
 * every material, which would cause a hitch at dusk.
 */
export function Headlight({ scooter }: { scooter: RefObject<ScooterState> }) {
  const light = useRef<THREE.SpotLight>(null)
  const target = useRef<THREE.Object3D>(null)

  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current
  }, [])

  useFrame(() => {
    if (!light.current || !target.current) return
    const { x, z, heading } = scooter.current
    const forwardX = Math.sin(heading)
    const forwardZ = Math.cos(heading)
    light.current.position.set(x + forwardX * LAMP_FORWARD, LAMP_HEIGHT, z + forwardZ * LAMP_FORWARD)
    target.current.position.set(x + forwardX * AIM_AHEAD, 0, z + forwardZ * AIM_AHEAD)
    light.current.intensity = HEADLIGHT_INTENSITY * liveSky.look.night
  })

  return (
    <>
      <spotLight
        ref={light}
        color={HEADLIGHT_COLOR}
        intensity={0}
        distance={HEADLIGHT_RANGE}
        angle={HEADLIGHT_ANGLE}
        penumbra={HEADLIGHT_SOFTNESS}
        decay={1}
      />
      <object3D ref={target} />
    </>
  )
}
