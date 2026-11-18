import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, type Group, type Mesh } from 'three'
import { livePlayer } from '../game/livePlayer'
import { useGameStore } from '../game/gameStore'
import { MISSION_RULES } from '../game/missionConfig'
import { getCurrentStop } from './missionLogic'

const BEAM_HEIGHT = 70
const BEAM_RADIUS = 2.2
const RING_WIDTH = 0.5
const POINTER_HEIGHT = 7

const HOME_COLOR = '#7fb2ff'
/** Home's marker only shows off duty, and only this close, in metres. */
const HOME_SHOWN_WITHIN = 120
const POINTER_HIDDEN_WITHIN = 15

/**
 * Home: a soft ring at the gate and a small pointer, only off duty and only nearby, so it doesn't
 * compete with an order's beam. Stop in the ring to sleep (see the HUD).
 */
export function HomeMarker() {
  const home = useGameStore((state) => state.home)
  const offDuty = useGameStore((state) => state.duty === 'off')
  const group = useRef<Group>(null)
  const pointer = useRef<Mesh>(null)

  useFrame(({ clock }) => {
    if (!group.current || !home) return
    const distance = Math.hypot(home.x - livePlayer.x, home.z - livePlayer.z)
    group.current.visible = offDuty && distance < HOME_SHOWN_WITHIN
    if (pointer.current) {
      // Up close the ring is enough; the pointer would hang right in front of the camera.
      pointer.current.visible = distance > POINTER_HIDDEN_WITHIN
      pointer.current.position.y = 3.2 + Math.sin(clock.elapsedTime * 2) * 0.3
    }
  })

  if (!home) return null
  return (
    <group ref={group} position={[home.x, 0, home.z]}>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3, 3.35, 40]} />
        <meshBasicMaterial color={HOME_COLOR} fog={false} />
      </mesh>
      <mesh ref={pointer} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.5, 1.1, 4]} />
        <meshBasicMaterial color={HOME_COLOR} fog={false} />
      </mesh>
    </group>
  )
}

/** A light beam and ground ring at the current stop. Fog is off so it's seen from far away. */
export function MissionMarker() {
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  const pointer = useRef<Mesh>(null)
  const stop = getCurrentStop(mission, phase)

  useFrame(({ clock }) => {
    if (!pointer.current) return
    pointer.current.position.y = POINTER_HEIGHT + Math.sin(clock.elapsedTime * 2.5) * 0.6
    pointer.current.rotation.y = clock.elapsedTime * 1.5
  })

  if (!stop) return null

  return (
    <group position={[stop.x, 0, stop.z]}>
      {/*
        Drawn after every other see-through thing. See-through things are drawn far to near by
        their middles, and a map square's road marks (stains, patches, dust) are one big shape
        whose middle is often nearer than the beam: they were drawn over it, and showed through.
      */}
      <mesh position={[0, BEAM_HEIGHT / 2, 0]} renderOrder={10}>
        <cylinderGeometry args={[BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 24, 1, true]} />
        <meshBasicMaterial
          color={stop.color}
          transparent
          opacity={0.22}
          side={DoubleSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[MISSION_RULES.zoneRadius - RING_WIDTH, MISSION_RULES.zoneRadius, 48]} />
        <meshBasicMaterial color={stop.color} fog={false} />
      </mesh>

      {/* A cone's tip points up by default, so this flips it to point at the ground. */}
      <mesh ref={pointer} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1, 2.2, 4]} />
        <meshBasicMaterial color={stop.color} fog={false} />
      </mesh>
    </group>
  )
}
