import { useEffect, useMemo, useRef, type Ref, type RefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
  type Group,
} from 'three'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { getStreetReflection } from '../traffic/carModel'
import {
  DELIVERY_BIKE_COLOR,
  getModel,
  paintModel,
  TRAFFIC_MODELS_URL,
} from '../traffic/modelFiles'
import type { CollisionWorld } from '../world/collision'
import { Rider, STEERING_Z } from './Rider'
import { HIP } from './riderShape'
import { HOLD_INPUT, stepScooter, type ScooterState } from './ScooterController'
import { useDriveInput } from './useDriveInput'

/** Longest a single frame may count for, so a paused tab can't cause a huge jump. */
const MAX_FRAME_TIME = 0.05

/** How far the front wheel visibly turns at full lock, in radians. */
const MAX_FRONT_WHEEL_ANGLE = 0.45

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

type Materials = ReturnType<typeof createMaterials>

function createMaterials(reflection: THREE.Texture) {
  return {
    bike: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.35,
      envMap: reflection,
    }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
    headlight: new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 0.7 }),
    tail: new THREE.MeshStandardMaterial({ color: '#a51d16', emissive: '#ff2a1a', emissiveIntensity: 0 }),
  }
}

/** Night lifts the brake light and headlight, and dims what the shiny parts reflect. */
function updateLights(materials: Materials, braking: boolean) {
  const { look } = liveSky
  materials.tail.emissiveIntensity = (braking ? 2.2 : 0.3) + look.night * 0.9
  materials.headlight.emissiveIntensity = 0.7 + look.night * 1.6
  materials.bike.envMapIntensity = look.ambientIntensity * 0.9
}

function Wheel({
  spinRef,
  position,
  geometry,
  material,
}: {
  spinRef: Ref<Group>
  position: [number, number, number]
  geometry: THREE.BufferGeometry
  material: THREE.Material
}) {
  return (
    <group ref={spinRef} position={position}>
      <mesh geometry={geometry} material={material} castShadow />
    </group>
  )
}

type WheelData = { wheelPositions: [number, number, number][] }

const seatHip = new Vector3()
const seatTurn = new Quaternion()
const thrownHip = new Vector3()
const thrownTurn = new Quaternion()
const roll = new Quaternion()
const rollAxis = new Vector3()
const unscaled = new Vector3(1, 1, 1)
const riderWorld = new Matrix4()
const hipOffset = new Matrix4()
const toLean = new Matrix4()
const UP = new Vector3(0, 1, 0)

/**
 * Puts the rider where they are. On the scooter, that's simply the seat. Once
 * thrown, they have their own place and turn in the world, from
 * `stepThrownRider`. The rider is still inside the scooter's lean group, so
 * their world pose is turned into one relative to that group. While they're
 * getting back on, the two poses blend by `rider.off`.
 */
function placeRider(root: Group, lean: Group, scooter: Group, state: ScooterState) {
  const rider = state.rider
  if (rider.off === 0) {
    root.matrix.identity()
    root.matrixWorldNeedsUpdate = true
    return
  }

  scooter.updateMatrixWorld(true)
  seatHip.copy(HIP).applyMatrix4(lean.matrixWorld)
  lean.matrixWorld.decompose(thrownHip, seatTurn, unscaled)

  thrownHip.set(rider.x, rider.y, rider.z)
  rollAxis.set(rider.rollAxisX, 0, rider.rollAxisZ)
  roll.setFromAxisAngle(rollAxis, rider.roll)
  thrownTurn.setFromAxisAngle(UP, rider.heading).premultiply(roll)

  thrownHip.lerp(seatHip, 1 - rider.off)
  thrownTurn.slerp(seatTurn, 1 - rider.off)

  // The rider's own space has its origin at the scooter's middle, so the hips are moved to the origin first.
  hipOffset.makeTranslation(-HIP.x, -HIP.y, -HIP.z)
  riderWorld.compose(thrownHip, thrownTurn, unscaled.set(1, 1, 1)).multiply(hipOffset)
  toLean.copy(lean.matrixWorld).invert()
  root.matrix.multiplyMatrices(toLean, riderWorld)
  root.matrixWorldNeedsUpdate = true
}

/**
 * The bike's nesting matches how it moves. The outer group carries position and
 * direction, the lean group tilts everything, and the steering group turns only
 * the front end. Each part inherits the movement of the groups around it.
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
  const gl = useThree((state) => state.gl)
  const reflection = getStreetReflection(gl)
  const materials = useMemo(() => createMaterials(reflection), [reflection])
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)

  const parts = useMemo(
    () => ({
      body: paintModel(getModel(scene, 'delivery'), DELIVERY_BIKE_COLOR),
      front: paintModel(getModel(scene, 'delivery-front'), DELIVERY_BIKE_COLOR),
    }),
    [scene],
  )
  const wheelGeometry = useMemo(() => getModel(scene, 'delivery-wheel'), [scene])
  const [frontAxle, rearAxle] = useMemo(() => {
    const { wheelPositions } = scene.getObjectByName('delivery')?.userData as WheelData
    return [...wheelPositions].sort((a, b) => b[2] - a[2])
  }, [scene])

  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose())
      Object.values(parts).forEach((geometry) => geometry.dispose())
    },
    [materials, parts],
  )

  const lean = useRef<Group>(null)
  const riderRoot = useRef<Group>(null)
  const steering = useRef<Group>(null)
  const frontWheel = useRef<Group>(null)
  const rearWheel = useRef<Group>(null)

  useFrame((_, delta) => {
    const state = scooterState.current
    updateLights(materials, input.current.backward && state.speed > 0.5)
    const { started, phase } = useGameStore.getState()
    if (started) {
      const handingOver = phase === 'collecting' || phase === 'handingOver'
      const controls = handingOver ? HOLD_INPUT : input.current
      stepScooter(state, controls, collisions, Math.min(delta, MAX_FRAME_TIME))
    }

    if (ref.current) {
      ref.current.position.set(state.x, 0, state.z)
      ref.current.rotation.y = state.heading
    }
    if (lean.current) {
      lean.current.rotation.z = -state.lean
      lean.current.rotation.x = state.pitch
    }
    if (riderRoot.current && lean.current && ref.current) {
      placeRider(riderRoot.current, lean.current, ref.current, state)
    }
    if (steering.current) steering.current.rotation.y = state.steer * MAX_FRONT_WHEEL_ANGLE
    if (frontWheel.current) frontWheel.current.rotation.x = state.wheelSpin
    if (rearWheel.current) rearWheel.current.rotation.x = state.wheelSpin
  })

  return (
    <group ref={ref}>
      <BlobShadow />
      <group ref={lean}>
        <mesh geometry={parts.body} material={materials.bike} />
        <Wheel
          spinRef={rearWheel}
          position={rearAxle}
          geometry={wheelGeometry}
          material={materials.wheel}
        />
        <mesh position={[0, 0.72, -0.9]} material={materials.tail}>
          <boxGeometry args={[0.16, 0.05, 0.03]} />
        </mesh>

        {/* Everything that turns with the bars, moved so that it turns around the steering axis. */}
        <group ref={steering} position={[0, 0, STEERING_Z]}>
          <group position={[0, 0, -STEERING_Z]}>
            <mesh geometry={parts.front} material={materials.bike} />
            <Wheel
              spinRef={frontWheel}
              position={frontAxle}
              geometry={wheelGeometry}
              material={materials.wheel}
            />
            <mesh position={[0, 0.91, 0.62]} scale={[1, 1, 0.4]} material={materials.headlight}>
              <sphereGeometry args={[0.07, 14, 12]} />
            </mesh>
          </group>
        </group>
        <group ref={riderRoot} matrixAutoUpdate={false}>
          <Rider scooter={scooterState} steerAngle={MAX_FRONT_WHEEL_ANGLE} reflection={reflection} />
        </group>
      </group>
    </group>
  )
}
