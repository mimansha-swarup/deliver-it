import { useEffect, useMemo, useRef, type Ref, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Group } from 'three'
import { useGameStore } from '../game/gameStore'
import type { CollisionWorld } from '../world/collision'
import { stepScooter, type ScooterState } from './ScooterController'
import { useDriveInput } from './useDriveInput'
import { SCOOTER } from './vehicleConfig'

const BODY_COLOR = '#d9482b'
const TRIM_COLOR = '#23252a'
const METAL_COLOR = '#9a9da3'
const BOX_COLOR = '#e8e4d8'

/** Longest a single frame may count for, so a paused tab can't cause a huge jump. */
const MAX_FRAME_TIME = 0.05

/** How far the front wheel visibly turns at full lock, in radians. */
const MAX_FRONT_WHEEL_ANGLE = 0.45

const WHEEL_WIDTH = 0.1

function Wheel({ spinRef, z }: { spinRef: Ref<Group>; z: number }) {
  const radius = SCOOTER.wheelRadius

  return (
    <group ref={spinRef} position={[0, radius, z]}>
      {/* Cylinders stand upright by default, so this lays the wheel on its side. */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[radius, radius, WHEEL_WIDTH, 20]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.9} />
      </mesh>
      {/* A bar across the hub, which makes the spinning visible. */}
      <mesh>
        <boxGeometry args={[WHEEL_WIDTH + 0.02, radius * 1.3, 0.05]} />
        <meshStandardMaterial color={METAL_COLOR} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  )
}

const BLOB_WIDTH = 0.65
const BLOB_LENGTH = 1.45
const BLOB_HEIGHT = 0.08
const BLOB_SIDES = 20
/** [distance out from the middle, darkness] for each ring of the shape. */
const BLOB_RINGS = [
  [0, 0.6],
  [0.55, 0.45],
  [1, 0],
]

/** A dark oval that fades out at its edge. The fade is stored on its corners. */
function createBlobGeometry(): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []

  const add = (ring: number, side: number) => {
    const [distance, darkness] = BLOB_RINGS[ring]
    const angle = (side / BLOB_SIDES) * Math.PI * 2
    positions.push(
      Math.cos(angle) * distance * BLOB_WIDTH,
      BLOB_HEIGHT,
      Math.sin(angle) * distance * BLOB_LENGTH,
    )
    colors.push(0, 0, 0, darkness)
  }

  for (let ring = 0; ring < BLOB_RINGS.length - 1; ring++) {
    for (let side = 0; side < BLOB_SIDES; side++) {
      add(ring, side)
      add(ring + 1, side)
      add(ring, side + 1)
      add(ring, side + 1)
      add(ring + 1, side)
      add(ring + 1, side + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
  return geometry
}

/**
 * A soft dark shape on the road. The sun's shadow map is far too coarse for an
 * object this small, so the scooter fakes its own shadow instead of casting one.
 */
function BlobShadow() {
  const geometry = useMemo(() => createBlobGeometry(), [])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        depthWrite={false}
        side={DoubleSide}
        polygonOffset
        polygonOffsetFactor={-6}
        polygonOffsetUnits={-6}
      />
    </mesh>
  )
}

function ScooterBody() {
  return (
    <>
      {/* Footboard */}
      <mesh position={[0, 0.3, 0.1]}>
        <boxGeometry args={[0.34, 0.09, 0.72]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.8} />
      </mesh>
      {/* Rear body */}
      <mesh position={[0, 0.5, -0.42]}>
        <boxGeometry args={[0.36, 0.42, 0.78]} />
        <meshStandardMaterial color={BODY_COLOR} roughness={0.45} />
      </mesh>
      {/* Seat */}
      <mesh position={[0, 0.76, -0.36]}>
        <boxGeometry args={[0.3, 0.1, 0.66]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.7} />
      </mesh>
      {/* Leg shield, tilted back toward the rider */}
      <mesh position={[0, 0.62, 0.46]} rotation={[-0.22, 0, 0]}>
        <boxGeometry args={[0.4, 0.68, 0.07]} />
        <meshStandardMaterial color={BODY_COLOR} roughness={0.45} />
      </mesh>
      {/* Delivery box */}
      <mesh position={[0, 1.02, -0.62]}>
        <boxGeometry args={[0.46, 0.44, 0.46]} />
        <meshStandardMaterial color={BOX_COLOR} roughness={0.6} />
      </mesh>
    </>
  )
}

function Handlebars() {
  return (
    <>
      {/* Steering column */}
      <mesh position={[0, 0.82, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.42, 8]} />
        <meshStandardMaterial color={METAL_COLOR} metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Bars */}
      <mesh position={[0, 1.03, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.66, 8]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.7} />
      </mesh>
      {/* Headlight */}
      <mesh position={[0, 0.97, 0.07]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#fff6d8" emissive="#ffe9a8" emissiveIntensity={0.7} />
      </mesh>
    </>
  )
}

/**
 * The scooter's nesting matches how it moves. The outer group carries position
 * and direction, the lean group tilts everything, and the steering group turns
 * only the front end. Each part inherits the movement of the groups around it.
 */
export function Scooter({
  ref,
  scooterState,
  collisions,
}: {
  ref: RefObject<Group | null>
  scooterState: RefObject<ScooterState>
  collisions: CollisionWorld
}) {
  const input = useDriveInput()

  const lean = useRef<Group>(null)
  const steering = useRef<Group>(null)
  const frontWheel = useRef<Group>(null)
  const rearWheel = useRef<Group>(null)

  useFrame((_, delta) => {
    const state = scooterState.current
    if (useGameStore.getState().started) {
      stepScooter(state, input.current, collisions, Math.min(delta, MAX_FRAME_TIME))
    }

    if (ref.current) {
      ref.current.position.set(state.x, 0, state.z)
      ref.current.rotation.y = state.heading
    }
    if (lean.current) {
      lean.current.rotation.z = -state.lean
      lean.current.rotation.x = state.pitch
    }
    if (steering.current) steering.current.rotation.y = state.steer * MAX_FRONT_WHEEL_ANGLE
    if (frontWheel.current) frontWheel.current.rotation.x = state.wheelSpin
    if (rearWheel.current) rearWheel.current.rotation.x = state.wheelSpin
  })

  return (
    <group ref={ref}>
      <BlobShadow />
      <group ref={lean}>
        <ScooterBody />
        <Wheel spinRef={rearWheel} z={-0.62} />
        <group ref={steering} position={[0, 0, 0.56]}>
          <Handlebars />
          <Wheel spinRef={frontWheel} z={0.14} />
        </group>
      </group>
    </group>
  )
}
