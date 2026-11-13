import {
  HEADLIGHT_ANGLE,
  HEADLIGHT_COLOR,
  HEADLIGHT_INTENSITY,
  HEADLIGHT_RANGE,
  HEADLIGHT_SOFTNESS,
} from '../vehicle/Headlight'
import { playHorn } from '../audio/horns'
import { playImpact, updateTrafficSounds } from '../audio/trafficSounds'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { STEERING_Z } from '../vehicle/Rider'
import type { ScooterState } from '../vehicle/ScooterController'
import { getStreetReflection } from './carModel'
import { getModel, TRAFFIC_MODELS_URL, YAMAHA_MODEL_URL } from './modelFiles'
import { createWomanGeometry } from './peopleShapes'
import {
  takeHonks,
  takeImpacts,
  LOOSE_DRAW_DISTANCE,
  stepTraffic,
  type Pedestrian,
  type TrafficWorld,
  type Vehicle,
  type VehicleKind,
} from './trafficLogic'
import {
  createBikeRiderGeometry,
  createParkedScooterGeometry,
  createVehicleGlowGeometry,
} from './vehicleShapes'
import { CAR_COLORS, PARKED_COLORS, tintPaintOnly } from './vehiclePaint'


/** An auto's colours come from its model, so its tint changes nothing. */
const AUTO_COLORS = ['#ffffff']
const BIKE_COLORS = ['#1c3fd1', '#b3201e', '#1a1b1e', '#e8e8e8', '#2e7d4f']
/** Parked scooters are detailed, and smaller than a few pixels past this, in metres. */
const PARKED_DRAW_DISTANCE = 90
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

/** The furthest a front wheel turns, in radians. */
const MAX_STEER = 0.5
/** How quickly a wheel swings towards where it should point. */
const STEER_EASING = 8
/** Below this speed, in metres per second, steering is worked out as if at this speed. */
const LOWEST_STEER_SPEED = 2

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
  /** Not drawn, such as a thrown bike rider who is back on the bike. */
  hidden?: boolean
  /** A bike whose rider has been thrown off, so its seated rider isn't drawn. */
  riderOff?: boolean
}

const transform = new THREE.Object3D()


function writeTransforms(
  instances: THREE.InstancedMesh,
  items: Moving[],
  reach = Infinity,
  isSeatedRider = false,
) {
  items.forEach((item, index) => {
    const inRange =
      Math.hypot(item.x - livePlayer.x, item.z - livePlayer.z) < reach &&
      !item.hidden &&
      !(isSeatedRider && item.riderOff)
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

/**
 * For a long list of which only a few are near: writes just the near ones, one
 * after another, and draws only that many. A copy shrunk to nothing still costs
 * the GPU all its corners, which for 700 detailed scooters is far too many.
 */
function writeNearest(instances: THREE.InstancedMesh, items: Moving[], reach: number, palette: string[]) {
  const color = new THREE.Color()
  let drawn = 0
  for (const item of items) {
    if (item.hidden || Math.hypot(item.x - livePlayer.x, item.z - livePlayer.z) >= reach) continue
    transform.position.set(item.x, item.lift, item.z)
    if (item.rotation) transform.quaternion.set(...item.rotation)
    else transform.rotation.set(0, item.heading, 0)
    transform.scale.setScalar(1)
    transform.updateMatrix()
    instances.setMatrixAt(drawn, transform.matrix)
    instances.setColorAt(drawn, color.set(palette[Math.floor(item.tint * palette.length * 0.999)]))
    drawn++
  }
  instances.count = drawn
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
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
  baked,
  reflection,
  reach,
  seatedRider = false,
  nearestOnly = false,
}: {
  items: Moving[]
  geometry: THREE.BufferGeometry
  palette: string[]
  castShadow: boolean
  /** Whether it's a model from `traffic.glb`, which says which parts are paint. */
  baked?: boolean
  reflection: THREE.Texture
  /** Copies further from the rider than this aren't drawn. */
  reach?: number
  /** The rider sitting on a bike, who isn't drawn once thrown off. */
  seatedRider?: boolean
  /** Draw only the copies within `reach`, for long lists of detailed shapes. */
  nearestOnly?: boolean
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshStandardMaterial>(null)
  useInstanceColors(mesh, items, palette)

  useFrame(() => {
    if (!mesh.current) return
    if (nearestOnly && reach !== undefined) writeNearest(mesh.current, items, reach, palette)
    else writeTransforms(mesh.current, items, reach, seatedRider)
    if (material.current) updateReflection(material.current)
  })

  // With no copies there are no instance colours, and the paint shader relies on them.
  if (items.length === 0) return null

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
        envMap={reflection}
        roughness={baked ? 0.32 : 0.45}
        metalness={baked ? 0.35 : 0.1}
        onBeforeCompile={baked ? tintPaintOnly : undefined}
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

/** Only vehicles this close to the rider can get one of the real headlights, in metres. */
const CAR_LIGHT_REACH = 70

/**
 * A few real spotlights, handed each frame to the vehicles nearest the rider, so
 * their headlights light up the road, walls and people they point at. Further
 * vehicles keep only their painted glow, which is far cheaper. There's always
 * the same number of lights, turned down to nothing by day, as changing the
 * count makes three.js rebuild every material.
 */
function CarHeadlights({ items, count }: { items: Vehicle[]; count: number }) {
  const lights = useRef<(THREE.SpotLight | null)[]>([])
  const targets = useRef<(THREE.Object3D | null)[]>([])

  useEffect(() => {
    lights.current.forEach((light, index) => {
      const target = targets.current[index]
      if (light && target) light.target = target
    })
  }, [count])

  // Reused every frame: which vehicles have a light, so picking them makes no garbage.
  const chosen = useRef<(Vehicle | null)[]>([])

  useFrame(() => {
    const night = liveSky.look.night
    const picked = chosen.current
    picked.length = count
    picked.fill(null)

    // Picks the nearest few, one at a time, skipping any already picked. With a handful of
    // lights and a few dozen vehicles, that's cheaper than sorting.
    if (night > 0.01) {
      for (let slot = 0; slot < count; slot++) {
        let best: Vehicle | null = null
        let bestDistance = CAR_LIGHT_REACH
        for (const item of items) {
          if (item.lane === -1 || item.body || item.fallen || picked.includes(item)) continue
          const distance = Math.hypot(item.x - livePlayer.x, item.z - livePlayer.z)
          if (distance < bestDistance) {
            best = item
            bestDistance = distance
          }
        }
        picked[slot] = best
      }
    }

    lights.current.forEach((light, index) => {
      const target = targets.current[index]
      if (!light || !target) return
      const vehicle = picked[index]
      if (!vehicle) {
        light.intensity = 0
        return
      }
      const forwardX = Math.sin(vehicle.heading)
      const forwardZ = Math.cos(vehicle.heading)
      const front = vehicle.halfLength
      light.position.set(vehicle.x + forwardX * front, 0.85, vehicle.z + forwardZ * front)
      target.position.set(vehicle.x + forwardX * (front + 18), 0, vehicle.z + forwardZ * (front + 18))
      light.intensity = HEADLIGHT_INTENSITY * night
    })
  })

  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <group key={index}>
          <spotLight
            ref={(light) => {
              lights.current[index] = light
            }}
            color={HEADLIGHT_COLOR}
            intensity={0}
            distance={HEADLIGHT_RANGE}
            angle={HEADLIGHT_ANGLE}
            penumbra={HEADLIGHT_SOFTNESS}
            decay={1}
          />
          <object3D
            ref={(target) => {
              targets.current[index] = target
            }}
          />
        </group>
      ))}
    </>
  )
}

/** How far a limp person's arms and legs fling out, in radians. Arms go further than legs. */
const SPRAWL_ARM = 1.5
const SPRAWL_LEG = 0.45
/** Joints higher than this are shoulders, lower are hips. */
const SHOULDER_ABOVE = 1.1

/**
 * Walking happens on the graphics card. Each arm and leg rotates around its own
 * joint, by an amount that comes from that person's place in their stride.
 * Someone knocked over goes limp instead: their arms fling out one forward and
 * one back, and their legs part, by how limp they are (`aPerson.z`).
 * Clothes take the person's colour, and the rest take their skin tone.
 */
function addWalking(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = `
    attribute vec3 _limb;
    attribute vec3 aPerson;
    ${shader.vertexShader}
  `
    .replace(
      '#include <color_vertex>',
      `vColor = vec4(1.0);
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb = color.rgb * (_limb.z > 0.5 ? instanceColor.rgb : vec3(aPerson.y));
      #else
        vColor.rgb = color.rgb * (_limb.z > 0.5 ? vec3(1.0) : vec3(aPerson.y));
      #endif`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      if (_limb.x != 0.0) {
        float walking = sin(aPerson.x) * _limb.x * ${LIMB_SWING.toFixed(2)};
        float sprawl = _limb.x * (_limb.y > ${SHOULDER_ABOVE.toFixed(2)} ? ${SPRAWL_ARM.toFixed(2)} : ${SPRAWL_LEG.toFixed(2)});
        float angle = mix(walking, sprawl, aPerson.z);
        float down = position.y - _limb.y;
        transformed.z = position.z * cos(angle) + down * sin(angle);
        transformed.y = _limb.y + down * cos(angle) - position.z * sin(angle);
      }`,
    )
}

/** Gives a body shape room for each person's place in their stride, skin tone and limpness. */
function withPersonData(body: THREE.BufferGeometry, count: number): THREE.BufferGeometry {
  const geometry = body.clone()
  geometry.setAttribute(
    'aPerson',
    new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
  )
  return geometry
}

function writeStrides(geometry: THREE.BufferGeometry, people: Pedestrian[]) {
  const attribute = geometry.getAttribute('aPerson') as THREE.InstancedBufferAttribute
  people.forEach(({ stride, skin, down }, index) => attribute.setXYZ(index, stride, skin, down))
  attribute.needsUpdate = true
}

/** A crowd, or just one person, walking by the same shader. */
export function People({
  items,
  body,
  palette = CLOTHES_COLORS,
}: {
  items: Pedestrian[]
  body: THREE.BufferGeometry
  /** The colours their clothes can be. */
  palette?: string[]
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => withPersonData(body, items.length), [body, items.length])
  useInstanceColors(mesh, items, palette)

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

type WheelSet = {
  geometry: THREE.BufferGeometry
  positions: [number, number, number][]
  radius: number
  /** A borrowed wheel is scaled from its own size to this vehicle's. */
  scale: number
  wheelBase: number
}

/** What each vehicle's wheels are doing, kept between frames. */
type WheelState = { x: number; z: number; heading: number; roll: number; steer: number }

const wheelBody = new THREE.Matrix4()
const wheelPlace = new THREE.Matrix4()
const wheelSpin = new THREE.Matrix4()
const wheelSteer = new THREE.Matrix4()
const wheelFlip = new THREE.Matrix4().makeRotationY(Math.PI)
const wheelSize = new THREE.Matrix4()

/** Works out how far a vehicle moved, so its wheels roll that far and steer into the bend. */
function updateWheelState(state: WheelState, item: Moving, wheels: WheelSet, delta: number) {
  const moveX = item.x - state.x
  const moveZ = item.z - state.z
  const turned = Math.atan2(
    Math.sin(item.heading - state.heading),
    Math.cos(item.heading - state.heading),
  )
  const forward = moveX * Math.sin(item.heading) + moveZ * Math.cos(item.heading)

  state.roll += forward / wheels.radius
  state.x = item.x
  state.z = item.z
  state.heading = item.heading
  if (delta <= 0) return

  const speed = Math.max(Math.abs(forward) / delta, LOWEST_STEER_SPEED)
  const wanted = (turned / delta) * (wheels.wheelBase / speed)
  const clamped = Math.max(-MAX_STEER, Math.min(MAX_STEER, wanted))
  state.steer += (clamped - state.steer) * Math.min(1, delta * STEER_EASING)
}

/** The wheels of one kind of vehicle. They're separate so that they can roll and steer. */
function VehicleWheels({ items, wheels }: { items: Moving[]; wheels: WheelSet }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const states = useRef<WheelState[]>([])
  const count = items.length * wheels.positions.length

  useFrame((_, delta) => {
    if (!mesh.current) return
    const step = Math.min(delta, MAX_STEP)

    items.forEach((item, itemIndex) => {
      const state = (states.current[itemIndex] ??= {
        x: item.x,
        z: item.z,
        heading: item.heading,
        roll: 0,
        steer: 0,
      })
      // A tumbling vehicle's wheels stop being driven, and simply go with it.
      if (!item.rotation) updateWheelState(state, item, wheels, step)

      transform.position.set(item.x, item.lift, item.z)
      if (item.rotation) transform.quaternion.set(...item.rotation)
      else transform.rotation.set(0, item.heading, 0)
      transform.scale.setScalar(1)
      transform.updateMatrix()
      wheelBody.copy(transform.matrix)

      wheels.positions.forEach(([x, y, z], wheelIndex) => {
        const isLeft = x < 0
        wheelPlace.makeTranslation(x, y, z)
        wheelSteer.makeRotationY(z > 0 ? state.steer : 0)
        // Wheels on the far side are the same wheel turned around, so they spin the other way.
        wheelSpin.makeRotationX(isLeft ? -state.roll : state.roll)
        wheelSize.makeScale(wheels.scale, wheels.scale, wheels.scale)

        const matrix = wheelBody.clone().multiply(wheelPlace).multiply(wheelSteer)
        if (isLeft) matrix.multiply(wheelFlip)
        matrix.multiply(wheelSpin).multiply(wheelSize)
        mesh.current?.setMatrixAt(itemIndex * wheels.positions.length + wheelIndex, matrix)
      })
    })
    mesh.current.instanceMatrix.needsUpdate = true
  })

  if (count === 0) return null

  return (
    <instancedMesh
      key={count}
      ref={mesh}
      args={[wheels.geometry, undefined, count]}
      frustumCulled={false}
    >
      <meshStandardMaterial vertexColors roughness={0.55} />
    </instancedMesh>
  )
}

/** Pulls one model's wheels and their positions out of the loaded file. */
function getWheels(scene: THREE.Group, name: string): WheelSet {
  const model = scene.getObjectByName(name)
  const { wheelModel, wheelRadius, wheelPositions } = model?.userData as {
    wheelModel: string
    wheelRadius: number
    wheelPositions: [number, number, number][]
  }
  const source = scene.getObjectByName(`${wheelModel}-wheel`)
  const sourceRadius = (source?.userData as { wheelRadius: number }).wheelRadius
  const lengths = wheelPositions.map(([, , z]) => z)

  return {
    geometry: getModel(scene, `${wheelModel}-wheel`),
    positions: wheelPositions,
    radius: wheelRadius,
    scale: wheelRadius / sourceRadius,
    wheelBase: Math.max(...lengths) - Math.min(...lengths),
  }
}

const VEHICLES: { kind: VehicleKind; palette: string[] }[] = [
  { kind: 'sedan', palette: CAR_COLORS },
  { kind: 'hatchback', palette: CAR_COLORS },
  { kind: 'suv', palette: CAR_COLORS },
  { kind: 'mpv', palette: CAR_COLORS },
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
  const { vehicles, pedestrians, shadowSize, carLights } = useGameStore((state) => QUALITY_PRESETS[state.quality])

  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const { scene: yamaha } = useGLTF(YAMAHA_MODEL_URL)

  const shapes = useMemo(
    () => ({
      sedan: getModel(scene, 'sedan'),
      hatchback: getModel(scene, 'hatchback'),
      suv: getModel(scene, 'suv'),
      mpv: getModel(scene, 'mpv'),
      auto: getModel(scene, 'auto'),
      bike: getModel(yamaha, 'bike'),
    }),
    [scene, yamaha],
  )
  const wheels = useMemo(
    () => ({
      sedan: getWheels(scene, 'sedan'),
      hatchback: getWheels(scene, 'hatchback'),
      suv: getWheels(scene, 'suv'),
      mpv: getWheels(scene, 'mpv'),
      auto: getWheels(scene, 'auto'),
      bike: getWheels(yamaha, 'bike'),
    }),
    [scene, yamaha],
  )
  // The woman is built in code until a model with a clear origin takes her place.
  const woman = useMemo(() => createWomanGeometry(), [])
  const bodies = useMemo(
    () => [getModel(scene, 'man'), getModel(scene, 'teen'), woman],
    [scene, woman],
  )
  // These two are still built in code, so they need freeing. Loaded models don't.
  const drawn = useMemo(
    () => ({ rider: createBikeRiderGeometry(), parked: createParkedScooterGeometry(scene, STEERING_Z) }),
    [scene],
  )
  const lights = useMemo(
    () => ({
      sedan: createVehicleGlowGeometry(2.1, -2.1, 0.56, 0.7),
      hatchback: createVehicleGlowGeometry(1.8, -1.8, 0.52, 0.72),
      suv: createVehicleGlowGeometry(2.3, -2.3, 0.62, 0.9),
      mpv: createVehicleGlowGeometry(2, -2, 0.58, 0.8),
      auto: createVehicleGlowGeometry(1.3, -1.3, 0, 0.72),
      bike: createVehicleGlowGeometry(0.66, -0.9, 0, 0.9),
    }),
    [],
  )
  const gl = useThree((state) => state.gl)
  // Shared with the rider's scooter, so it's never disposed of here.
  const reflection = getStreetReflection(gl)

  useEffect(
    () => () => {
      Object.values(drawn).forEach((geometry) => geometry.dispose())
      Object.values(lights).forEach((geometry) => geometry.dispose())
      woman.dispose()
    },
    [drawn, lights, woman],
  )

  const inPlay = useMemo(() => world.vehicles.slice(0, vehicles), [world, vehicles])
  const people = useMemo(() => world.pedestrians.slice(0, pedestrians), [world, pedestrians])
  // Bike riders who can be thrown off. They're hidden while they're on the bike.
  const thrownRiders = useMemo(
    () => inPlay.flatMap(({ thrownRider }) => (thrownRider ? [thrownRider] : [])),
    [inPlay],
  )
  const crowds = useMemo(
    () => bodies.map((_, group) => people.filter((__, index) => index % bodies.length === group)),
    [bodies, people],
  )

  useFrame((_, delta) => {
    const rider = scooter.current
    stepTraffic(world, rider, vehicles, pedestrians, Math.min(delta, MAX_STEP))
    takeHonks(world, ({ kind, x, z }) => playHorn(kind, x, z, rider))
    takeImpacts(world, ({ x, z, strength }) => playImpact(x, z, strength, rider))
    updateTrafficSounds(inPlay, rider, Math.min(delta, MAX_STEP))
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
              baked
              reflection={reflection}
            />
            {kind === 'bike' && (
              <MovingInstances
                items={items}
                geometry={drawn.rider}
                palette={palette}
                castShadow={shadowSize > 0}
                reflection={reflection}
                seatedRider
              />
            )}
            <VehicleWheels items={items} wheels={wheels[kind]} />
            <VehicleLights items={items} geometry={lights[kind]} />
          </group>
        )
      })}
      <MovingInstances
        items={world.loose}
        geometry={drawn.parked}
        palette={PARKED_COLORS}
        castShadow={false}
        baked
        reflection={reflection}
        reach={Math.min(LOOSE_DRAW_DISTANCE, PARKED_DRAW_DISTANCE)}
        nearestOnly
      />
      {bodies.map((body, group) => (
        <People key={body.uuid} items={crowds[group]} body={body} />
      ))}
      {thrownRiders.length > 0 && <People items={thrownRiders} body={bodies[0]} palette={BIKE_COLORS} />}
      <CarHeadlights items={inPlay} count={carLights} />
    </>
  )
}

// Models aren't preloaded here: the title screen's loader downloads them (src/game/preload.ts).
