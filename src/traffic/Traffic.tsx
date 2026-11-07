import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { ScooterState } from '../vehicle/ScooterController'
import {
  createCarGeometry,
  createCarTexture,
  createStreetReflection,
  HATCHBACK,
  SEDAN,
} from './carModel'
import { createManGeometry, createWomanGeometry } from './peopleShapes'
import {
  LOOSE_DRAW_DISTANCE,
  stepTraffic,
  type Pedestrian,
  type TrafficWorld,
  type VehicleKind,
} from './trafficLogic'
import {
  createAutoGeometry,
  createBikeGeometry,
  createParkedScooterGeometry,
  createVehicleGlowGeometry,
} from './vehicleShapes'

const CAR_COLORS = ['#e8e8e8', '#b9bcc2', '#30343b', '#8c2f2f', '#2f4f7f', '#d8d2c4', '#f4f4f2']
const AUTO_COLORS = ['#3f8f4a', '#d9b21f', '#3f8f4a']
const BIKE_COLORS = ['#22252b', '#7f2626', '#2a4a7a', '#c9cacc', '#30343b']
const PARKED_COLORS = ['#c8c9cc', '#2f3136', '#8c2f2f', '#2f4f7f', '#e6e4dc', '#3d6b4f']
const CLOTHES_COLORS = [
  '#c04a4a',
  '#3f6fa8',
  '#e0b13c',
  '#2f8f7a',
  '#7a4f9a',
  '#e8e4d8',
  '#d07a3a',
  '#c2447e',
  '#f0f0ea',
]

/** How strongly vehicles mirror the sky, by day. Night dims it along with the ambient light. */
const REFLECTION_STRENGTH = 0.9

/** Longest a single frame may count for, so a hidden tab doesn't move everything at once. */
const MAX_STEP = 0.05
/** How far an arm or leg swings on each step, in radians. */
const LIMB_SWING = 0.5

type Moving = {
  x: number
  z: number
  heading: number
  lift: number
  tint: number
  /** A full 3D rotation, when physics has it tumbling. */
  rotation?: [number, number, number, number] | null
}

const transform = new THREE.Object3D()

function writeTransforms(instances: THREE.InstancedMesh, items: Moving[], reach = Infinity) {
  items.forEach((item, index) => {
    const inRange = Math.hypot(item.x - livePlayer.x, item.z - livePlayer.z) < reach
    transform.position.set(item.x, item.lift, item.z)
    if (item.rotation) transform.quaternion.set(...item.rotation)
    else transform.rotation.set(0, item.heading, 0)
    // Size zero is the cheapest way to skip one copy of an instanced shape.
    transform.scale.setScalar(inRange ? 1 : 0)
    transform.updateMatrix()
    instances.setMatrixAt(index, transform.matrix)
  })
  instances.instanceMatrix.needsUpdate = true
}

function updateReflection(material: THREE.MeshStandardMaterial) {
  material.envMapIntensity = liveSky.look.ambientIntensity * REFLECTION_STRENGTH
}

function writeColors(instances: THREE.InstancedMesh, items: Moving[], palette: string[]) {
  const color = new THREE.Color()
  items.forEach((item, index) => {
    instances.setColorAt(index, color.set(palette[Math.floor(item.tint * palette.length * 0.999)]))
  })
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
}

/** Sets each copy's fixed colour. Only needed once. */
function useInstanceColors(
  mesh: RefObject<THREE.InstancedMesh | null>,
  items: Moving[],
  palette: string[],
) {
  useLayoutEffect(() => {
    if (mesh.current) writeColors(mesh.current, items, palette)
  }, [mesh, items, palette])
}

/** Copies of one shape, repositioned every frame from a list of moving things. */
function MovingInstances({
  items,
  geometry,
  palette,
  castShadow,
  map,
  reflection,
  reach,
}: {
  items: Moving[]
  geometry: THREE.BufferGeometry
  palette: string[]
  castShadow: boolean
  map?: THREE.Texture
  reflection: THREE.Texture
  /** Copies further from the rider than this aren't drawn. */
  reach?: number
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshStandardMaterial>(null)
  useInstanceColors(mesh, items, palette)

  useFrame(() => {
    if (mesh.current) writeTransforms(mesh.current, items, reach)
    if (material.current) updateReflection(material.current)
  })

  return (
    <instancedMesh
      key={items.length}
      ref={mesh}
      args={[geometry, undefined, items.length]}
      frustumCulled={false}
      castShadow={castShadow}
    >
      <meshStandardMaterial
        ref={material}
        vertexColors
        map={map ?? null}
        envMap={reflection}
        roughness={map ? 0.24 : 0.45}
        metalness={map ? 0.65 : 0.1}
      />
    </instancedMesh>
  )
}

/** Headlights and tail lights, which fade in after dark. */
function VehicleLights({ items, geometry }: { items: Moving[]; geometry: THREE.BufferGeometry }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(() => {
    if (!mesh.current || !material.current) return
    writeTransforms(mesh.current, items)
    material.current.opacity = liveSky.look.night
    mesh.current.visible = liveSky.look.night > 0.01
  })

  return (
    <instancedMesh
      key={items.length}
      ref={mesh}
      args={[geometry, undefined, items.length]}
      frustumCulled={false}
    >
      <meshBasicMaterial
        ref={material}
        vertexColors
        transparent
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        fog={false}
        polygonOffset
        polygonOffsetFactor={-6}
        polygonOffsetUnits={-6}
      />
    </instancedMesh>
  )
}

/**
 * Walking happens on the graphics card. Each arm and leg rotates around its own
 * joint, by an amount that comes from that person's place in their stride.
 * Clothes take the person's colour, and the rest take their skin tone.
 */
function addWalking(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = `
    attribute vec3 aLimb;
    attribute vec2 aPerson;
    ${shader.vertexShader}
  `
    .replace(
      '#include <color_vertex>',
      `vColor = vec4(1.0);
      vColor.rgb = color.rgb * (aLimb.z > 0.5 ? instanceColor.rgb : vec3(aPerson.y));`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      if (aLimb.x != 0.0) {
        float angle = sin(aPerson.x) * aLimb.x * ${LIMB_SWING.toFixed(2)};
        float down = position.y - aLimb.y;
        transformed.z = position.z * cos(angle) + down * sin(angle);
        transformed.y = aLimb.y + down * cos(angle) - position.z * sin(angle);
      }`,
    )
}

/** Gives a body shape room for each person's place in their stride, and their skin tone. */
function withPersonData(body: THREE.BufferGeometry, count: number): THREE.BufferGeometry {
  const geometry = body.clone()
  geometry.setAttribute(
    'aPerson',
    new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2),
  )
  return geometry
}

function writeStrides(geometry: THREE.BufferGeometry, people: Pedestrian[]) {
  const attribute = geometry.getAttribute('aPerson') as THREE.InstancedBufferAttribute
  people.forEach(({ stride, skin }, index) => attribute.setXY(index, stride, skin))
  attribute.needsUpdate = true
}

function People({ items, body }: { items: Pedestrian[]; body: THREE.BufferGeometry }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => withPersonData(body, items.length), [body, items.length])
  useInstanceColors(mesh, items, CLOTHES_COLORS)

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(() => {
    if (!mesh.current) return
    writeTransforms(mesh.current, items)
    writeStrides(geometry, items)
  })

  return (
    <instancedMesh
      key={items.length}
      ref={mesh}
      args={[geometry, undefined, items.length]}
      frustumCulled={false}
    >
      <meshStandardMaterial vertexColors roughness={0.8} onBeforeCompile={addWalking} />
    </instancedMesh>
  )
}

const VEHICLES: { kind: VehicleKind; palette: string[] }[] = [
  { kind: 'sedan', palette: CAR_COLORS },
  { kind: 'hatchback', palette: CAR_COLORS },
  { kind: 'auto', palette: AUTO_COLORS },
  { kind: 'bike', palette: BIKE_COLORS },
]

/** Vehicles and people around the rider. Only those nearby exist at all. */
export function Traffic({
  scooter,
  world,
}: {
  scooter: RefObject<ScooterState>
  world: TrafficWorld
}) {
  const { vehicles, pedestrians, shadowSize } = useGameStore((state) => QUALITY_PRESETS[state.quality])

  const shapes = useMemo(
    () => ({
      sedan: createCarGeometry(SEDAN),
      hatchback: createCarGeometry(HATCHBACK),
      auto: createAutoGeometry(),
      bike: createBikeGeometry(),
      parked: createParkedScooterGeometry(),
    }),
    [],
  )
  const lights = useMemo(
    () => ({
      sedan: createVehicleGlowGeometry(2.1, -2.1, 0.56, 0.7),
      hatchback: createVehicleGlowGeometry(1.8, -1.8, 0.56, 0.7),
      auto: createVehicleGlowGeometry(1.25, -1.2, 0, 0.72),
      bike: createVehicleGlowGeometry(0.66, -0.9, 0, 0.9),
    }),
    [],
  )
  const gl = useThree((state) => state.gl)
  const reflection = useMemo(() => createStreetReflection(gl), [gl])
  const paintJobs = useMemo(
    () => ({ sedan: createCarTexture(SEDAN), hatchback: createCarTexture(HATCHBACK) }),
    [],
  )
  const man = useMemo(() => createManGeometry(), [])
  const woman = useMemo(() => createWomanGeometry(), [])

  useEffect(
    () => () => {
      Object.values(shapes).forEach((geometry) => geometry.dispose())
      Object.values(lights).forEach((geometry) => geometry.dispose())
      man.dispose()
      woman.dispose()
      reflection.dispose()
      Object.values(paintJobs).forEach((texture) => texture.dispose())
    },
    [shapes, lights, man, woman, reflection, paintJobs],
  )

  const inPlay = useMemo(() => world.vehicles.slice(0, vehicles), [world, vehicles])
  const people = useMemo(() => world.pedestrians.slice(0, pedestrians), [world, pedestrians])
  const men = useMemo(() => people.filter((_, index) => index % 2 === 0), [people])
  const women = useMemo(() => people.filter((_, index) => index % 2 === 1), [people])

  useFrame((_, delta) => {
    stepTraffic(world, scooter.current, vehicles, pedestrians, Math.min(delta, MAX_STEP))
  })

  return (
    <>
      {VEHICLES.map(({ kind, palette }) => {
        const items = inPlay.filter((vehicle) => vehicle.kind === kind)
        return (
          <group key={kind}>
            <MovingInstances
              items={items}
              geometry={shapes[kind]}
              palette={palette}
              castShadow={shadowSize > 0}
              map={kind === 'sedan' || kind === 'hatchback' ? paintJobs[kind] : undefined}
              reflection={reflection}
            />
            <VehicleLights items={items} geometry={lights[kind]} />
          </group>
        )
      })}
      <MovingInstances
        items={world.loose}
        geometry={shapes.parked}
        palette={PARKED_COLORS}
        castShadow={false}
        reflection={reflection}
        reach={LOOSE_DRAW_DISTANCE}
      />
      <People items={men} body={man} />
      <People items={women} body={woman} />
    </>
  )
}
