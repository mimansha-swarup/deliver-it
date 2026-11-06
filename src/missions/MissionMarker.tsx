import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, type Mesh } from 'three'
import { useGameStore } from '../game/gameStore'
import { MISSION_RULES } from '../game/missionConfig'
import { getCurrentStop } from './missionLogic'

const BEAM_HEIGHT = 70
const BEAM_RADIUS = 2.2
const RING_WIDTH = 0.5
const POINTER_HEIGHT = 7

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
      <mesh position={[0, BEAM_HEIGHT / 2, 0]}>
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
