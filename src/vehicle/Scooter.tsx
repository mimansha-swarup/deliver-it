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
import { findColour, PAINTS } from '../game/garage'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { getStreetReflection } from '../traffic/carModel'
import {
  getModel,
  paintModel,
  TRAFFIC_MODELS_URL,
} from '../traffic/modelFiles'
import type { CollisionWorld } from '../world/collision'
import type { Surface } from '../world/surface'
import { Rider, STEERING_Z } from './Rider'
import { createRiderProbes, HIP, type Probe } from './riderShape'
import { tuning } from './tuning'
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

/** Shapes are sorted into slices this tall and this long, in metres, and each slice's widest points kept. */
const PROBE_SLICE_HEIGHT = 0.08
const PROBE_SLICE_LENGTH = 0.25
/** The tyre's cross-section is round, about this radius, in metres. */
const TYRE_CROWN = 0.05

/**
 * The scooter's outline, as points, for finding what touches the ground when it
 * leans or lies on its side. The body is cut into slices by height and
 * length, and only the furthest point out on each side of each slice is kept:
 * a couple of hundred points instead of thousands of corners, and the only
 * ones that can ever be lowest. Each tyre is a row of balls round its bottom
 * half, the size of its rounded tread.
 */
function createScooterProbes(
  shapes: THREE.BufferGeometry[],
  axles: [number, number, number][],
  wheelRadius: number,
): Probe[] {
  const widest = new Map<string, Probe>()
  for (const shape of shapes) {
    const position = shape.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      const key = `${Math.round(y / PROBE_SLICE_HEIGHT)},${Math.round(z / PROBE_SLICE_LENGTH)},${Math.sign(x)}`
      const kept = widest.get(key)
      if (!kept || Math.abs(x) > Math.abs(kept.point.x)) widest.set(key, { point: new Vector3(x, y, z), radius: 0 })
    }
  }
  const probes = [...widest.values()]
  for (const [x, y, z] of axles) {
    for (const angle of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const out = wheelRadius - TYRE_CROWN
      probes.push({ point: new Vector3(x, y - out * Math.cos(angle), z + out * Math.sin(angle)), radius: TYRE_CROWN })
    }
  }
  return probes
}

/** The lowest any probe reaches, in the space `matrix` takes them to. Only the height is worked out. */
function lowestProbe(probes: Probe[], matrix: Matrix4): number {
  const m = matrix.elements
  let lowest = Infinity
  for (const { point, radius } of probes) {
    lowest = Math.min(lowest, m[1] * point.x + m[5] * point.y + m[9] * point.z + m[13] - radius)
  }
  return lowest
}

const seatHip = new Vector3()
const seatTurn = new Quaternion()
const thrownHip = new Vector3()
const thrownTurn = new Quaternion()
const roll = new Quaternion()
const rollAxis = new Vector3()
const unscaled = new Vector3(1, 1, 1)
const riderWorld = new Matrix4()
const hipOffset = new Matrix4()
const toParent = new Matrix4()
const riderInLean = new Matrix4()
const UP = new Vector3(0, 1, 0)

/**
 * Puts the rider where they are. On the scooter, that's simply the seat. Once
 * thrown, they have their own place and turn in the world, from
 * `stepThrownRider`. The rider is still inside the scooter's body group, so
 * their world pose is turned into one relative to that group. While they're
 * getting back on, the two poses blend by `rider.off`.
 *
 * Off the scooter, the body is lifted if any part of it would be in the
 * ground. The hips are where `stepThrownRider` says, but a helmet or an elbow
 * reaches further, and lying face down, the helmet would be in the road.
 */
function placeRider(root: Group, parent: Group, scooter: Group, state: ScooterState, probes: Probe[]) {
  const rider = state.rider
  if (rider.off === 0) {
    root.matrix.identity()
    root.matrixWorldNeedsUpdate = true
    return
  }

  scooter.updateMatrixWorld(true)
  seatHip.copy(HIP).applyMatrix4(parent.matrixWorld)
  parent.matrixWorld.decompose(thrownHip, seatTurn, unscaled)

  thrownHip.set(rider.x, rider.y, rider.z)
  rollAxis.set(rider.rollAxisX, 0, rider.rollAxisZ)
  roll.setFromAxisAngle(rollAxis, rider.roll)
  thrownTurn.setFromAxisAngle(UP, rider.heading).premultiply(roll)

  thrownHip.lerp(seatHip, 1 - rider.off)
  thrownTurn.slerp(seatTurn, 1 - rider.off)

  // The rider's own space has its origin at the scooter's middle, so the hips are moved to the origin first.
  hipOffset.makeTranslation(-HIP.x, -HIP.y, -HIP.z)
  riderWorld.compose(thrownHip, thrownTurn, unscaled.set(1, 1, 1)).multiply(hipOffset)
  const sunk = rider.ground - lowestProbe(probes, riderWorld)
  if (sunk > 0) riderWorld.elements[13] += sunk * rider.off
  toParent.copy(parent.matrixWorld).invert()
  root.matrix.multiplyMatrices(toParent, riderWorld)
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
  surface,
}: {
  ref: RefObject<Group | null>
  scooterState: RefObject<ScooterState>
  collisions: CollisionWorld
  surface: Surface
}) {
  const input = useDriveInput()
  const gl = useThree((state) => state.gl)
  const reflection = getStreetReflection(gl)
  const materials = useMemo(() => createMaterials(reflection), [reflection])
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)

  // The paint bought at the Garage. Changing it repaints a fresh copy of the model.
  const paintId = useGameStore((state) => state.paintId)
  const paint = findColour(PAINTS, paintId).color
  const parts = useMemo(
    () => ({
      body: paintModel(getModel(scene, 'delivery'), paint),
      front: paintModel(getModel(scene, 'delivery-front'), paint),
    }),
    [scene, paint],
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

  const scooterProbes = useMemo(
    () => createScooterProbes([parts.body, parts.front], [frontAxle, rearAxle], frontAxle[1]),
    [parts, frontAxle, rearAxle],
  )
  const riderProbes = useMemo(() => createRiderProbes(), [])
  // Where the axles are, from the model, for tilting the scooter as its wheels ride over a kerb.
  const wheelbase = frontAxle[2] - rearAxle[2]
  const axleMiddle = (frontAxle[2] + rearAxle[2]) / 2

  const terrain = useRef<Group>(null)
  const lean = useRef<Group>(null)
  const body = useRef<Group>(null)
  const riderRoot = useRef<Group>(null)
  const steering = useRef<Group>(null)
  const wheelSteering = useRef<Group>(null)
  const frontWheel = useRef<Group>(null)
  const rearWheel = useRef<Group>(null)

  useFrame((_, delta) => {
    const state = scooterState.current
    updateLights(materials, input.current.backward && state.speed > 0.5)
    tuning.wetness = liveSky.rain
    const { started, phase } = useGameStore.getState()
    if (started) {
      const handingOver = phase === 'collecting' || phase === 'handingOver'
      const controls = handingOver ? HOLD_INPUT : input.current
      stepScooter(state, controls, collisions, surface, Math.min(delta, MAX_FRAME_TIME))
    }

    if (!ref.current || !terrain.current || !lean.current || !body.current || !riderRoot.current) return
    ref.current.position.set(state.x, 0, state.z)
    ref.current.rotation.y = state.heading

    // Sits on the ground under its wheels, nose up while the front is on a kerb and the back isn't.
    const front = state.frontWheel.height
    const rear = state.rearWheel.height
    terrain.current.position.set(0, (front + rear) / 2, axleMiddle)
    terrain.current.rotation.x = -Math.atan2(front - rear, wheelbase)

    // Braking dips the nose and the throttle lifts it, but only the body moves: the tyres stay on the road.
    body.current.rotation.x = state.pitch
    body.current.updateMatrix()

    // Leans about its middle, then lifts by however far the lowest point went into the ground. Riding,
    // that's the edge of a tyre's rounded tread. On its side after a crash, it's the side of the body,
    // and the rider too if they came down with it.
    lean.current.rotation.z = -state.lean
    lean.current.position.y = 0
    lean.current.updateMatrix()
    let lowest = lowestProbe(scooterProbes, lean.current.matrix)
    if (state.rider.off === 0) {
      riderInLean.multiplyMatrices(lean.current.matrix, body.current.matrix)
      lowest = Math.min(lowest, lowestProbe(riderProbes, riderInLean))
    }
    lean.current.position.y = -lowest

    placeRider(riderRoot.current, body.current, ref.current, state, riderProbes)
    if (steering.current) steering.current.rotation.y = state.steer * MAX_FRONT_WHEEL_ANGLE
    if (wheelSteering.current) wheelSteering.current.rotation.y = state.steer * MAX_FRONT_WHEEL_ANGLE
    if (frontWheel.current) frontWheel.current.rotation.x = state.wheelSpin
    if (rearWheel.current) rearWheel.current.rotation.x = state.wheelSpin
  })

  return (
    <group ref={ref}>
      {/* Tilts with the ground under the wheels, about the point between the axles. */}
      <group ref={terrain}>
        <group position={[0, 0, -axleMiddle]}>
          <BlobShadow />
          <group ref={lean}>
            <Wheel
              spinRef={rearWheel}
              position={rearAxle}
              geometry={wheelGeometry}
              material={materials.wheel}
            />
            {/* The front wheel turns with the bars, around the steering axis. */}
            <group ref={wheelSteering} position={[0, 0, STEERING_Z]}>
              <group position={[0, 0, -STEERING_Z]}>
                <Wheel
                  spinRef={frontWheel}
                  position={frontAxle}
                  geometry={wheelGeometry}
                  material={materials.wheel}
                />
              </group>
            </group>

            {/* Everything the suspension carries, which pitches under braking and power. */}
            <group ref={body}>
              <mesh geometry={parts.body} material={materials.bike} />
              <mesh position={[0, 0.72, -0.9]} material={materials.tail}>
                <boxGeometry args={[0.16, 0.05, 0.03]} />
              </mesh>
              <group ref={steering} position={[0, 0, STEERING_Z]}>
                <group position={[0, 0, -STEERING_Z]}>
                  <mesh geometry={parts.front} material={materials.bike} />
                  <mesh position={[0, 0.91, 0.62]} scale={[1, 1, 0.4]} material={materials.headlight}>
                    <sphereGeometry args={[0.07, 14, 12]} />
                  </mesh>
                </group>
              </group>
              <group ref={riderRoot} matrixAutoUpdate={false}>
                <Rider
                  scooter={scooterState}
                  steerAngle={MAX_FRONT_WHEEL_ANGLE}
                  reflection={reflection}
                  probes={riderProbes}
                />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}
