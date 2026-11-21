import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, type Group, type Mesh, type MeshBasicMaterial } from 'three'
import { livePlayer, useOnFoot } from '../game/livePlayer'
import { errandLive } from '../game/doorsteps'
import { useGameStore } from '../game/gameStore'
import { MISSION_RULES } from '../game/missionConfig'
import { getCurrentStop } from './missionLogic'

const BEAM_HEIGHT = 70
const BEAM_RADIUS = 2.2
const RING_WIDTH = 0.5
const POINTER_HEIGHT = 7
/** The stop's beam and pointer go this far outside its ring, in metres, so the rider is never inside the beam. */
const BEAM_CLEAR = 6

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

/** Nearer the door than this, in metres, its beam isn't drawn. */
const DOOR_BEAM_GONE_WITHIN = 3.5
/** The door's marker shows from this far, in metres; its pointer grows with distance, up to this many times. */
const DOOR_SHOWN_WITHIN = 110
const DOOR_POINTER_HEIGHT = 3.3
const DOOR_POINTER_GROWS_OVER = 22
const DOOR_POINTER_LARGEST = 3
const DOOR_BEAM_HEIGHT = 26
/**
 * The pointer shows through what's in front of it only this near the door, in metres: there it's a
 * compound wall, a fence or the corner of the house. From further off it would show through whole
 * buildings, and seem to mark a house on the way that has nothing to do with the order.
 */
const DOOR_POINTER_THROUGH_WITHIN = 30

/**
 * The door the order goes to, which is not the stop on the road: a ring on the ground at it, a
 * thin bright beam that stands above the compound walls, and a pointer over it that shows through
 * walls and fences, so the house can be picked out from the road and the door found from the gate.
 * It follows the errand's next step (game/doorsteps.ts): the gate, the guard, the lobby's door, and
 * indoors the counter, the lift and the bell, where it's the ring and a small pointer only.
 */
export function DoorMarker() {
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  const group = useRef<Group>(null)
  const pointer = useRef<Mesh>(null)
  const beam = useRef<Mesh>(null)
  const color = getCurrentStop(mission, phase)?.color ?? '#ffffff'

  useFrame(({ clock }) => {
    if (!group.current) return
    const goal = errandLive.goal
    const distance = goal ? Math.hypot(goal.x - livePlayer.x, goal.z - livePlayer.z) : Infinity
    const shown = goal !== null && goal.kind === 'door' && distance < DOOR_SHOWN_WITHIN
    group.current.visible = shown
    if (!goal || !shown) return
    group.current.position.set(goal.x, goal.y, goal.z)
    // At the door itself the beam goes (its pointer stays): standing in it, as on walking out of the
    // dark store, the camera looked through it and the whole view was washed its colour.
    if (beam.current) beam.current.visible = !goal.indoors && distance > DOOR_BEAM_GONE_WITHIN
    if (pointer.current) {
      const size = goal.indoors ? 0.55 : Math.min(DOOR_POINTER_LARGEST, Math.max(1, distance / DOOR_POINTER_GROWS_OVER))
      pointer.current.scale.setScalar(size)
      pointer.current.position.y = (goal.indoors ? 2.3 : DOOR_POINTER_HEIGHT + size * 0.6) + Math.sin(clock.elapsedTime * 3) * 0.22
      pointer.current.rotation.y = clock.elapsedTime * 1.5
      const material = pointer.current.material as MeshBasicMaterial
      material.depthTest = !goal.indoors && distance > DOOR_POINTER_THROUGH_WITHIN
    }
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={beam} position={[0, DOOR_BEAM_HEIGHT / 2, 0]} renderOrder={10}>
        <cylinderGeometry args={[0.22, 0.22, DOOR_BEAM_HEIGHT, 10, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={DoubleSide} depthWrite={false} fog={false} />
      </mesh>
      <mesh position={[0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 1.1, 32]} />
        <meshBasicMaterial color={color} fog={false} />
      </mesh>
      {/* Drawn last, and near the door through whatever is in front: a compound wall, a fence, the corner of the house. */}
      <mesh ref={pointer} rotation={[Math.PI, 0, 0]} renderOrder={11}>
        <coneGeometry args={[0.42, 0.95, 4]} />
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} fog={false} />
      </mesh>
    </group>
  )
}

/** A light beam and ground ring at the current stop. Fog is off so it's seen from far away. */
export function MissionMarker() {
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  // On foot the road's stop has done its job: its beam and pointer go, so the door's marker is the only one.
  const onFoot = useOnFoot((state) => state.onFoot)
  const pointer = useRef<Mesh>(null)
  const beam = useRef<Mesh>(null)
  const stop = getCurrentStop(mission, phase)

  useFrame(({ clock }) => {
    if (!pointer.current || !beam.current || !stop) return
    // Arrived, the beam goes too: from inside it the whole street was tinted its colour, door and all.
    const far = !onFoot && Math.hypot(stop.x - livePlayer.x, stop.z - livePlayer.z) > MISSION_RULES.zoneRadius + BEAM_CLEAR
    beam.current.visible = far
    pointer.current.visible = far
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
      <mesh ref={beam} position={[0, BEAM_HEIGHT / 2, 0]} renderOrder={10}>
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
