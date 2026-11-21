import {
  HEADLIGHT_ANGLE,
  HEADLIGHT_COLOR,
  HEADLIGHT_INTENSITY,
  HEADLIGHT_RANGE,
  HEADLIGHT_SOFTNESS,
} from '../vehicle/Headlight'
import { borrow } from '../game/borrow'
import { playHorn } from '../audio/horns'
import { playImpact, updateTrafficSounds } from '../audio/trafficSounds'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { JunctionWatch } from './JunctionWatch'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { PAVEMENT_HEIGHT, ROAD_HEIGHT } from '../world/surface'
import { livePlayer, liveSky } from '../game/livePlayer'
import { dayPeriod } from '../game/duty'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { STEERING_Z } from '../vehicle/Rider'
import { isDebug } from '../dev/spawn'
import { createRiderModel, createSeatedRiderGeometry, type RiderLook, type Seat } from '../vehicle/riderModel'
import type { ScooterState } from '../vehicle/ScooterController'
import { getStreetReflection } from './carModel'
import { getModel, TRAFFIC_MODELS_URL, SPORT_BIKE_MODEL_URL, EXTRA_PEOPLE, FLEET_MODELS_URL, PEOPLE_MODELS_URL } from './modelFiles'
import { GAIT, HIP, IDLE_POSE, KNEE } from './gait'
import { createWomanFrom } from './peopleShapes'
import { createBusFromModel, createBusGeometry } from './bus'
import { cameraDistance, isDetailed, lodCamera } from './vehicleLod'
import {
  takeHonks,
  takeImpacts,
  LOOSE_DRAW_DISTANCE,
  easeDensity,
  stepTraffic,
  type Pedestrian,
  type TrafficWorld,
  type Vehicle,
  type VehicleKind,
} from './trafficLogic'
import {
  createFarBikeGeometry,
  createParkedCarGeometry,
  createParkedScooterGeometry,
} from './vehicleShapes'
import { CAR_COLORS, PARKED_COLORS, tintPaintOnly } from './vehiclePaint'
import { groundLift } from '../world/groundLift'
import { seeThrough } from '../camera/seeThrough'
import { addLampGlow, lampUniforms, withLamps } from './vehicleLamps'
import { createMotorcycleGeometry, createScooterGeometry } from './twoWheelers'
import { createProxyGeometry } from './vehicleProxies'
import { createPlateAtlas, createPlateGeometry, plateCell, showPlateCell, type PlateFit } from './numberPlates'


/** An auto's colours come from its model, so its tint changes nothing. */

/**
 * People riding bikes in traffic: a jacket in the colour each rider is given (only the jacket
 * takes it, see vehiclePaint.ts), bare hands, dark trousers and shoes, and a dark helmet. They
 * sit where the old figure of shapes sat on the bikes: hips on the seat leaning forward, hands
 * on the bars and feet on the pegs, in the bike's own space.
 */
const COMMUTER_LOOK: RiderLook = { jacket: '#ffffff', glove: '#8d5a3b', trousers: '#2b2f3a', shoe: '#1c1c1f' }
const COMMUTER_SEAT: Seat = {
  hip: new THREE.Vector3(0, 0.9, -0.3),
  lean: 0.38,
  hands: new THREE.Vector3(0.3, 0.98, 0.33),
  feet: new THREE.Vector3(0.18, 0.42, -0.12),
}
const COMMUTER_HELMET = '#26282c'
/** The riders who come in their own kit: nothing of theirs is changed but the pale panels' colour. */
const SUITED_LOOK: RiderLook = { ...COMMUTER_LOOK, asIs: true }
/** Jackets and shirts on bikes: everyday colours, a few bright. */
const JACKET_COLORS = ['#3b4a6b', '#6b6f75', '#2a2c30', '#8a3b34', '#c9c3b4', '#3f6a55', '#b8862f', '#e0dcd2']
const AUTO_COLORS = ['#ffffff']
const BIKE_COLORS = ['#1c3fd1', '#b3201e', '#1a1b1e', '#e8e8e8', '#2e7d4f']
/** Made-up city bus liveries, a little faded: green, red, blue and ochre. No real operator's colours and name together. */
const BUS_COLORS = ['#3f7a4a', '#a8352c', '#2f5a8f', '#b98a2c']
/** Parked scooters are detailed, and smaller than a few pixels past this, in metres. */
const PARKED_DRAW_DISTANCE = 90
/** Parked scooters nearer than this get the detailed model; the rest, out to PARKED_DRAW_DISTANCE, the far one. */
const PARKED_DETAIL_DISTANCE = 30
/** A bus is big, few, and only a few hundred triangles more than a car: it keeps its shape this far out. */
const BUS_DETAIL_DISTANCE = 80
/**
 * Everyday clothes in HSR: shirts and kurtas in white, cream and pale blue,
 * sarees and salwars in saffron, maroon, mustard, peacock blue, bottle green
 * and rani pink, and the odd grey or navy. Whites come up most.
 */
const CLOTHES_COLORS = [
  '#f0eee6', // white
  '#f0eee6',
  '#e8dcc2', // cream
  '#b9cde0', // pale blue shirt
  '#e07b24', // saffron
  '#7d2430', // maroon
  '#d9a62e', // mustard
  '#1f6f8b', // peacock blue
  '#2f5e3e', // bottle green
  '#c2307a', // rani pink
  '#3a4a6b', // navy
  '#7c7f86', // grey
  '#a8502e', // rust
  '#5a3f8e', // indigo
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

type Moving = {
  x: number
  z: number
  /** Drawn with its detailed model (vehicleLod.ts). */
  detailed?: boolean
  heading: number
  lift: number
  /** Up on a flyover: its deck's height, which `lift` includes. */
  deck?: number
  tint: number
  /** A full 3D rotation, when physics has it tumbling. */
  rotation?: [number, number, number, number] | null
  /** Not drawn, such as a thrown bike rider who is back on the bike. */
  hidden?: boolean
  /** A bike whose rider has been thrown off, so its seated rider isn't drawn. */
  riderOff?: boolean
  /** What its lamps are doing (vehicleLamps.ts): on the brakes, indicating a side (1 left, -1 right), hazard lamps on. */
  braking?: boolean
  indicator?: -1 | 0 | 1
  hazard?: boolean
}

/** Indicators flash this many times a second, and are lit for this share of each flash. */
const BLINK_RATE = 1.5
const BLINK_ON = 0.55

const transform = new THREE.Object3D()


function writeTransforms(
  instances: THREE.InstancedMesh,
  items: Moving[],
  reach = Infinity,
  isSeatedRider = false,
  ground = ROAD_HEIGHT,
  from = 0,
  /** A level of detail: `reach` (the detailed model) or `from` (the far one) is the vehicle's cutoff (vehicleLod.ts). */
  lod = false,
) {
  items.forEach((item, index) => {
    const distance = cameraDistance(item.x, item.z)
    const near = lod ? (from > 0 ? !isDetailed(item, from) : reach === Infinity || isDetailed(item, reach)) : distance < reach && distance >= from
    const inRange =
      near &&
      !item.hidden &&
      !(isSeatedRider && item.riderOff)
    // On a raised footpath, walk on top of it.
    // Up on a flyover, its lift is the deck's height: no footpath below lifts it.
    transform.position.set(item.x, (item.deck ? ground : Math.max(ground, groundLift.at(item.x, item.z))) + item.lift, item.z)
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
const nearColor = new THREE.Color()
/** Things near enough to be drawn are looked for among those within reach plus this, in metres, listed every few frames. */
const CANDIDATE_SLACK = 15
const CANDIDATE_FRAMES = 10

/**
 * Lists the things that could be drawn soon: within `reach` plus a margin. Scanning every parked
 * scooter on the map each frame was the biggest single piece of the game's JavaScript; this scan
 * runs every few frames, and each frame only looks through the short list.
 */
function listCandidates(items: Moving[], reach: number): Moving[] {
  const limit = reach + CANDIDATE_SLACK
  return items.filter((item) => Math.abs(item.x - livePlayer.x) < limit && Math.abs(item.z - livePlayer.z) < limit)
}

function writeNearest(instances: THREE.InstancedMesh, items: Moving[], reach: number, palette: string[], from = 0) {
  const color = nearColor
  let drawn = 0
  for (const item of items) {
    if (item.hidden) continue
    if (from > 0 ? isDetailed(item, from) || cameraDistance(item.x, item.z) >= reach : !isDetailed(item, reach)) continue
    transform.position.set(item.x, ROAD_HEIGHT + item.lift, item.z)
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

/** Traffic waiting off the map (quiet hours) sits a million metres away: nothing past this is drawn. */
const NOWHERE = 5000

/**
 * A vehicle's level of detail, drawing only the copies it applies to: they're written one after
 * another and only that many are drawn. `reach` (the detailed model) or `from` (the far one) is the
 * vehicle's cutoff (vehicleLod.ts). Before, every copy went to the GPU each frame, the ones on the
 * other level shrunk to nothing, which still cost all their corners: with 22,000-triangle near cars
 * that was most of a million triangles for traffic nowhere near.
 */
function writePacked(instances: THREE.InstancedMesh, items: Moving[], reach: number, isSeatedRider: boolean, from: number, palette: string[], signal?: THREE.InstancedBufferAttribute | null, time = 0) {
  const color = nearColor
  let drawn = 0
  for (const item of items) {
    if (item.hidden || (isSeatedRider && item.riderOff)) continue
    const near = from > 0 ? !isDetailed(item, from) : reach === Infinity || isDetailed(item, reach)
    if (!near || Math.abs(item.x) > NOWHERE) continue
    // On a raised footpath, on top of it. Up on a flyover, its lift is the deck's height: no footpath below lifts it.
    transform.position.set(item.x, (item.deck ? ROAD_HEIGHT : Math.max(ROAD_HEIGHT, groundLift.at(item.x, item.z))) + item.lift, item.z)
    if (item.rotation) transform.quaternion.set(...item.rotation)
    else transform.rotation.set(0, item.heading, 0)
    transform.scale.setScalar(1)
    transform.updateMatrix()
    instances.setMatrixAt(drawn, transform.matrix)
    instances.setColorAt(drawn, color.set(palette[Math.floor(item.tint * palette.length * 0.999)]))
    if (signal) {
      // Its lamps: the brakes, and whichever indicators are lit at this moment. Each flashes in its own time, as no two cars' ever keep step.
      const lit = (item.indicator || item.hazard) && (time * BLINK_RATE + item.tint * 7) % 1 < BLINK_ON
      signal.setXYZ(drawn, item.braking ? 1 : 0, lit && (item.hazard || item.indicator === 1) ? 1 : 0, lit && (item.hazard || item.indicator === -1) ? 1 : 0)
    }
    drawn++
  }
  instances.count = drawn
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  if (signal) signal.needsUpdate = true
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
  from = 0,
  cloth = false,
  lamps = false,
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
  /** Copies nearer than this aren't drawn: the far-away stand-ins start here. */
  from?: number
  /** Cloth, not paint: matte, with only the parts marked `_paint` (a jacket) taking the copy's colour. */
  cloth?: boolean
  /** A vehicle whose shape has its lamps marked (vehicleLamps.ts' `withLamps`): they glow, each copy's by what it's doing. */
  lamps?: boolean
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshStandardMaterial>(null)
  const candidates = useRef<{ items: Moving[] | null; frames: number }>({ items: null, frames: 0 })
  useInstanceColors(mesh, items, palette)
  // Each copy's lamps (`aSignal`), kept on the shape, which is this vehicle's alone.
  const signal = useMemo(() => {
    if (!lamps || items.length === 0) return null
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3)
    attribute.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aSignal', attribute)
    return attribute
  }, [lamps, items.length, geometry])

  useFrame(({ clock }) => {
    if (!mesh.current) return
    if (nearestOnly && reach !== undefined) {
      const near = candidates.current
      if (near.frames-- <= 0 || near.items === null) {
        near.items = listCandidates(items, reach)
        near.frames = CANDIDATE_FRAMES
      }
      writeNearest(mesh.current, near.items, reach, palette, from)
    }
    else writePacked(mesh.current, items, reach ?? Infinity, seatedRider, from, palette, signal, clock.elapsedTime)
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
        // Satin rather than mirror: the re-wrapped panels aren't perfectly smooth, and glossier paint
        // caught a different bit of sky in every dent, which read as speckled paint.
        roughness={cloth ? 0.85 : baked ? 0.5 : 0.45}
        metalness={cloth ? 0 : baked ? 0.15 : 0.1}
        onBeforeCompile={lamps ? LAMPS_SEEN_THROUGH : baked || cloth ? PAINT_SEEN_THROUGH : SEEN_THROUGH}
      />
    </instancedMesh>
  )
}

/**
 * Puts the camera's position where the vehicles' levels of detail read it (vehicleLod.ts). First
 * among the traffic's parts, so its frame runs before theirs.
 */
function LodCamera() {
  useFrame(({ camera }) => {
    lodCamera.x = camera.position.x
    lodCamera.z = camera.position.z
  })
  return null
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

/** The time, for animations that run on their own: waving and the small movements of standing still. */
const peopleClock = { uTime: { value: 0 } }
/** A wave: the arm raised forwards and up, in radians from hanging down, and how far and fast it swings. */
const WAVE = { raise: 2.7, swing: 0.35, speed: 9 }
/** Standing still: a slow breath, and weight shifting from foot to foot. */
const IDLE = { breath: 0.006, breathSpeed: 1.7, sway: 0.012, swaySpeed: 0.55, armSway: 0.05 }
/** The weight shift: how far the hips move, in metres, and how slowly. */
const WEIGHT = { shift: 0.04, speed: 0.38 }
/** The elbow sits this far below the shoulder on every body. */
const ELBOW_DROP = 0.28
/** Holding a phone: the upper arm forward a little, the forearm up across the body, the head bowed over it. */
const PHONE = { upper: 0.32, forearm: 1.35, head: 0.32, neck: 1.44 }
/** Talking: how often a hand comes up, and how far. */
const CHAT = { speed: 0.55, upper: 0.3, forearm: 0.9, beat: 3.3 }

/** How far a limp person's arms and legs fling out, in radians. Arms go further than legs. */
const SPRAWL_ARM = 1.5
const SPRAWL_LEG = 0.45
/** Joints higher than this are shoulders, lower are hips. */
const SHOULDER_ABOVE = 1.1

const glsl = (value: number) => value.toFixed(4)

/**
 * The walk, in GLSL, run for every corner of every person. `footAt` is where a
 * foot is at a point in its stride (forward of the hip, and height off the
 * ground), from `GAIT`. `legAngles` then finds the thigh and shin angles that put
 * the foot there: inverse kinematics, the same law of cosines the rider's arms
 * use (`findJoint` in Rider.tsx), done here as angles. `turnForward` swings a
 * point about a joint, positive angles carrying what hangs below it forwards.
 */
const WALK_FUNCTIONS = /* glsl */ `
  const float STANCE = ${glsl(GAIT.stance)};
  const float REACH = ${glsl(GAIT.reach)};
  // The knee sits this share of the way up from the sole to the hip.
  const float KNEE_SHARE = ${glsl(KNEE / HIP)};
  const float PI = 3.14159265;

  vec2 footAt(float phase) {
    if (phase < STANCE) {
      // Planted, sliding back under the body. Rolling from heel to toe raises it a little at either end.
      float through = 2.0 * phase / STANCE - 1.0;
      return vec2(-REACH * through, 0.03 * through * through);
    }
    float swing = (phase - STANCE) / (1.0 - STANCE);
    float eased = swing * swing * (3.0 - 2.0 * swing);
    return vec2(REACH * (2.0 * eased - 1.0), 0.03 + ${glsl(GAIT.footLift)} * sin(PI * swing));
  }

  float walkDip(float stride) {
    float bothDown = (STANCE - 0.5) / 2.0;
    return -${glsl(GAIT.hipDip)} * (0.5 + 0.5 * cos(4.0 * PI * (stride / (2.0 * PI) - bothDown)));
  }

  // Returns (thigh, shin) angles from straight down, forwards positive, for a leg whose hip
  // stands \`legLength\` above the ground and has dipped by \`dip\`.
  vec2 legAngles(vec2 foot, float legLength, float dip) {
    float SHIN = legLength * KNEE_SHARE;
    float THIGH = legLength - SHIN;
    vec2 toFoot = vec2(foot.x, foot.y - legLength - dip);
    float reach = min(length(toFoot), THIGH + SHIN - 0.001);
    float aim = atan(toFoot.x, -toFoot.y);
    float atHip = acos(clamp((THIGH * THIGH + reach * reach - SHIN * SHIN) / (2.0 * THIGH * reach), -1.0, 1.0));
    float atKnee = acos(clamp((THIGH * THIGH + SHIN * SHIN - reach * reach) / (2.0 * THIGH * SHIN), -1.0, 1.0));
    float thigh = aim + atHip;
    return vec2(thigh, thigh - (PI - atKnee));
  }

  // (z, y) about a joint at height jointY.
  vec2 turnForward(vec2 point, float jointY, float angle) {
    float down = point.y - jointY;
    float c = cos(angle);
    float s = sin(angle);
    return vec2(point.x * c - down * s, jointY + point.x * s + down * c);
  }
`

/**
 * Walking happens on the graphics card. Each foot follows its stride (planted,
 * then lifted and swung forward), the knee and hip bend to reach it, and each
 * arm swings against the leg on its side. Someone standing (`aPerson.w` 0)
 * keeps their feet under them. Someone knocked over goes limp instead: their
 * arms fling out one forward and one back, and their legs part, by how limp they
 * are (`aPerson.z`). Clothes take the person's colour, and the rest take their skin tone.
 */
function addWalking(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, peopleClock)
  shader.vertexShader = `
    attribute vec3 _limb;
    attribute vec4 aPerson;
    attribute vec2 aWave;
    uniform float uTime;
    ${WALK_FUNCTIONS}
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
      float walking = aPerson.w * (1.0 - aPerson.z);
      // Standing still isn't standing frozen: each person breathes and shifts their weight, in their own time.
      float still = (1.0 - walking) * (1.0 - aPerson.z);
      float own = aPerson.x * 3.7;
      // What they're doing while they stand (IDLE_POSE), only while standing.
      float pose = aWave.y;
      float weight = still * (1.0 - step(0.5, abs(pose - ${IDLE_POSE.weight.toFixed(1)})));
      float phone = still * (1.0 - step(0.5, abs(pose - ${IDLE_POSE.phone.toFixed(1)})));
      float chat = still * (1.0 - step(0.5, abs(pose - ${IDLE_POSE.chat.toFixed(1)})));
      // Talking comes in bursts: a hand up for a few seconds, then down while the other talks.
      float burst = pow(max(0.0, sin(uTime * ${glsl(CHAT.speed)} + own)), 2.0);
      // The hips dip as weight passes from foot to foot, and the whole body with them.
      float dip = walkDip(aPerson.x) * walking;
      if (_limb.x != 0.0) {
        bool isArm = _limb.y > ${glsl(SHOULDER_ABOVE)};
        // Legs swing +1 on the left and -1 on the right; arms the other way round. Less than 1 is a
        // part that only half follows, such as the cloth where a leg meets the body.
        float side = isArm ? -_limb.x : _limb.x;
        float follow = abs(_limb.x);
        float phase = fract(aPerson.x / (2.0 * PI) + (side > 0.0 ? 0.0 : 0.5));
        vec2 foot = mix(vec2(0.0), footAt(phase), walking);
        vec2 point = vec2(position.z, position.y);
        if (isArm) {
          float swing = -${glsl(GAIT.armSwing)} * foot.x / REACH * follow;
          swing += still * ${glsl(IDLE.armSway)} * sin(uTime * 1.3 + own + side) * follow;
          // The phone and the talking hand are the arm that doesn't wave.
          float other = _limb.x > 0.0 ? follow : 0.0;
          float bend = 0.0;
          swing += other * (phone * ${glsl(PHONE.upper)} + chat * burst * ${glsl(CHAT.upper)});
          bend += other * phone * (${glsl(PHONE.forearm)} + 0.03 * sin(uTime * 2.3 + own));
          bend += other * chat * burst * ${glsl(CHAT.forearm)} * (0.75 + 0.25 * sin(uTime * ${glsl(CHAT.beat)} + own));
          bend += follow * still * 0.12;
          // One arm waves: raised forwards and up, swinging to and fro.
          float waving = _limb.x < 0.0 ? aWave.x * follow : 0.0;
          float wave = ${glsl(WAVE.raise)} + ${glsl(WAVE.swing)} * sin(uTime * ${glsl(WAVE.speed)} + own);
          swing = mix(swing, wave, waving);
          bend *= (1.0 - aPerson.z);
          float angle = mix(swing, -_limb.x * ${glsl(SPRAWL_ARM)}, aPerson.z);
          // The forearm bends up at the elbow first, as the shin does at the knee, then the whole arm turns.
          float elbowY = _limb.y - ${glsl(ELBOW_DROP)};
          if (position.y < elbowY) point = turnForward(point, elbowY, bend);
          point = turnForward(point, _limb.y, angle);
        } else {
          // The leg reaches from the dipped hip down to the foot on the ground. Each model has its
          // own hip height, carried in \`_limb.y\`.
          float hipY = _limb.y;
          float kneeY = hipY * KNEE_SHARE;
          vec2 angles = legAngles(foot, hipY, dip) * follow;
          float sprawl = -_limb.x * ${glsl(SPRAWL_LEG)};
          angles = mix(angles, vec2(sprawl), aPerson.z);
          // The shin bends at the knee first, then the whole leg turns at the hip.
          if (position.y < kneeY) point = turnForward(point, kneeY, angles.y - angles.x);
          point = turnForward(point, hipY, angles.x);
        }
        transformed.z = point.x;
        transformed.y = point.y;
      }
      // Head bowed over the phone, and leaning in a little to talk.
      if (_limb.x == 0.0 && position.y > ${glsl(PHONE.neck)}) {
        vec2 bowed = turnForward(vec2(transformed.z, transformed.y), ${glsl(PHONE.neck)}, phone * ${glsl(PHONE.head)} + chat * 0.08 * burst);
        transformed.z = bowed.x;
        transformed.y = bowed.y;
      }
      // Weight on one hip, held there a while, then on the other: the feet stay put and the body moves over them.
      float onHip = sin(uTime * ${glsl(WEIGHT.speed)} + own);
      float hips = weight * ${glsl(WEIGHT.shift)} * sign(onHip) * pow(abs(onHip), 0.35);
      transformed.x += hips * clamp(position.y / ${glsl(HIP)}, 0.0, 1.0) - hips * 0.5 * smoothstep(1.1, 1.6, position.y);
      transformed.y += dip;
      transformed.y += still * ${glsl(IDLE.breath)} * sin(uTime * ${glsl(IDLE.breathSpeed)} + own) * smoothstep(0.8, 1.5, position.y);
      transformed.x += still * ${glsl(IDLE.sway)} * sin(uTime * ${glsl(IDLE.swaySpeed)} + own) * position.y;`,
    )
}

/** Gives a body shape room for each person's place in their stride, skin tone, limpness and how much they're walking. */
function withPersonData(body: THREE.BufferGeometry, count: number): THREE.BufferGeometry {
  const geometry = body.clone()
  geometry.setAttribute(
    'aPerson',
    new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4),
  )
  // How much they're waving, and what they're doing while they stand (IDLE_POSE).
  geometry.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2))
  return geometry
}

function writeStrides(geometry: THREE.BufferGeometry, people: Pedestrian[]) {
  const attribute = geometry.getAttribute('aPerson') as THREE.InstancedBufferAttribute
  const wave = geometry.getAttribute('aWave') as THREE.InstancedBufferAttribute
  people.forEach(({ stride, skin, down, walking = 1, wave: waving = 0, idle = 0 }, index) => {
    attribute.setXYZW(index, stride, skin, down, walking)
    wave.setXY(index, waving, idle)
  })
  attribute.needsUpdate = true
  wave.needsUpdate = true
}

/**
 * People in a room (world/Rooms.tsx) stand under the city, where the sun and the sky's light don't
 * reach them, beside walls that are drawn unlit. So they glow with this share of their own colours,
 * as lit by the room's tube lights: about as bright as the walls around them.
 */
const INDOOR_GLOW = 0.62
// People and traffic give way to the camera's view of the rider on foot (camera/seeThrough.ts).
const WALKING_SEEN_THROUGH = seeThrough((shader) => addWalking(shader))
const WALKING_INDOORS_SEEN_THROUGH = seeThrough((shader) => addWalkingIndoors(shader))
/** A far-away stand-in with plain tail and head lamps. */
const farWithLamps = (geometry: THREE.BufferGeometry, kind: VehicleKind) => withLamps(geometry, kind, true)
const PAINT_SEEN_THROUGH = seeThrough(tintPaintOnly)
const LAMPS_SEEN_THROUGH = seeThrough((shader) => {
  tintPaintOnly(shader)
  addLampGlow(shader)
})
const SEEN_THROUGH = seeThrough()

function addWalkingIndoors(shader: Parameters<typeof addWalking>[0]) {
  addWalking(shader)
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * ${INDOOR_GLOW.toFixed(2)};`)
}

/** A crowd, or just one person, walking by the same shader. */
export function People({
  items,
  body,
  palette = CLOTHES_COLORS,
  ground = PAVEMENT_HEIGHT,
  indoors = false,
}: {
  /** Standing in a room: lit by the room, not the sky. */
  indoors?: boolean
  items: Pedestrian[]
  body: THREE.BufferGeometry
  /** The colours their clothes can be. */
  palette?: string[]
  /** The surface they walk on, in metres up. Pedestrians keep to the pavement. */
  ground?: number
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => withPersonData(body, items.length), [body, items.length])
  useInstanceColors(mesh, items, palette)

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(({ clock }) => {
    if (!mesh.current) return
    peopleClock.uTime.value = clock.elapsedTime % 1000
    writeTransforms(mesh.current, items, Infinity, false, ground)
    writeStrides(geometry, items)
  })

  return (
    <instancedMesh
      key={items.length}
      ref={mesh}
      args={[geometry, undefined, items.length]}
      frustumCulled={false}
    >
      <meshStandardMaterial vertexColors roughness={0.8} onBeforeCompile={indoors ? WALKING_INDOORS_SEEN_THROUGH : WALKING_SEEN_THROUGH} />
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
function VehicleWheels({ items, wheels, reach = Infinity }: { items: Moving[]; wheels: WheelSet; reach?: number }) {
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

      transform.position.set(item.x, ROAD_HEIGHT + item.lift, item.z)
      if (item.rotation) transform.quaternion.set(...item.rotation)
      else transform.rotation.set(0, item.heading, 0)
      // Past `reach` the vehicle is a stand-in with wheels of its own, so these shrink to nothing.
      transform.scale.setScalar(reach === Infinity || isDetailed(item, reach) ? 1 : 0)
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
  { kind: 'bus', palette: BUS_COLORS },
]

/** Number plates are small, so past this they aren't drawn, in metres. */
const PLATE_REACH = 70

/** Where each kind carries its plates: size, height, and front and back. Autos have yellow commercial plates. */
const PLATES: Record<VehicleKind, PlateFit & { commercial: boolean }> = {
  sedan: { width: 0.5, height: 0.12, at: 0.45, front: true, back: true, commercial: false },
  hatchback: { width: 0.5, height: 0.12, at: 0.45, front: true, back: true, commercial: false },
  suv: { width: 0.5, height: 0.12, at: 0.55, front: true, back: true, commercial: false },
  mpv: { width: 0.5, height: 0.12, at: 0.48, front: true, back: true, commercial: false },
  auto: { width: 0.32, height: 0.11, at: 0.42, front: true, back: true, commercial: true },
  bike: { width: 0.2, height: 0.12, at: 0.68, front: false, back: true, commercial: false },
  bus: { width: 0.52, height: 0.13, at: 0.5, front: true, back: true, commercial: true },
}

/** Which of the three two-wheeler shapes a bike is: the model, a scooter or a motorcycle. Fixed for each bike. */
function bikeShapeOf(item: Moving): number {
  return Math.floor(item.tint * 997) % 3
}

/** Who rides a bike: 0 the man in a jacket, 1 and 2 the riders in suits (people.glb). Half are the man. */
function riderOf(item: Moving): number {
  const pick = Math.floor(item.tint * 613) % 4
  return pick < 2 ? 0 : pick - 1
}

/** Each vehicle's own KA plate, picked once from the shared picture (numberPlates.ts). */
function NumberPlates({ items, geometry, commercial, atlas, reach = PLATE_REACH }: { items: Moving[]; geometry: THREE.BufferGeometry; commercial: boolean; atlas: THREE.Texture; reach?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const plates = useMemo(() => {
    const instanced = geometry.clone()
    const cells = new Float32Array(items.length * 2)
    items.forEach((item, index) => cells.set(plateCell(item.tint * 1000 + index, commercial), index * 2))
    instanced.setAttribute('aPlate', new THREE.InstancedBufferAttribute(cells, 2))
    return instanced
  }, [geometry, items, commercial])
  useEffect(() => () => plates.dispose(), [plates])
  useFrame(() => {
    if (mesh.current) writeTransforms(mesh.current, items, reach)
  })
  if (items.length === 0 || geometry.getAttribute('position').count === 0) return null
  return (
    <instancedMesh key={items.length} ref={mesh} args={[plates, undefined, items.length]} frustumCulled={false}>
      <meshStandardMaterial map={atlas} roughness={0.45} onBeforeCompile={showPlateCell} />
    </instancedMesh>
  )
}

/** Vehicles and people around the rider. Only those nearby exist at all. */
export function Traffic({
  scooter,
  world,
}: {
  scooter: RefObject<ScooterState>
  world: TrafficWorld
}) {
  const { vehicles, pedestrians, shadowSize, carLights, vehicleDetailDistance: detail } = useGameStore((state) => QUALITY_PRESETS[state.quality])

  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const { scene: sportBike } = useGLTF(SPORT_BIKE_MODEL_URL)
  const { scene: extraPeople } = useGLTF(PEOPLE_MODELS_URL)

  // The bus is a model with the game's wheels in its arches (bus.ts), or the one built in code if the model isn't there: either needs freeing.
  const { scene: fleet } = useGLTF(FLEET_MODELS_URL)
  const busShape = useMemo(() => {
    const arches = (fleet.getObjectByName('bus')?.userData as { arches?: { z: number }[] } | undefined)?.arches
    try {
      return arches ? createBusFromModel(getModel(fleet, 'bus'), arches) : createBusGeometry()
    } catch {
      return createBusGeometry()
    }
  }, [fleet])
  useEffect(() => () => busShape.dispose(), [busShape])
  // Each with its lamps marked, and added where the model has none (vehicleLamps.ts): copies, so they need freeing.
  const shapes = useMemo(
    () => ({
      sedan: withLamps(getModel(scene, 'sedan'), 'sedan'),
      hatchback: withLamps(getModel(scene, 'hatchback'), 'hatchback'),
      suv: withLamps(getModel(scene, 'suv'), 'suv'),
      mpv: withLamps(getModel(scene, 'mpv'), 'mpv'),
      auto: withLamps(getModel(scene, 'auto'), 'auto'),
      bike: withLamps(getModel(sportBike, 'bike'), 'bike'),
      bus: withLamps(busShape, 'bus'),
    }),
    [scene, sportBike, busShape],
  )
  useEffect(() => () => Object.values(shapes).forEach((geometry) => geometry.dispose()), [shapes])
  const wheels = useMemo(
    () => ({
      sedan: getWheels(scene, 'sedan'),
      hatchback: getWheels(scene, 'hatchback'),
      suv: getWheels(scene, 'suv'),
      mpv: getWheels(scene, 'mpv'),
      auto: getWheels(scene, 'auto'),
      bike: getWheels(sportBike, 'bike'),
    }),
    [scene, sportBike],
  )
  // Two women, made from the modelled man in a kurta (peopleShapes.ts): they need freeing, the loaded models don't.
  const women = useMemo(() => [createWomanFrom(getModel(scene, 'man'), 'elder'), createWomanFrom(getModel(scene, 'man'), 'young')], [scene])
  const bodies = useMemo(
    () => [getModel(scene, 'man'), getModel(scene, 'teen'), ...EXTRA_PEOPLE.map((name) => getModel(extraPeople, name)), ...women],
    [scene, extraPeople, women],
  )
  // These two are still built in code, so they need freeing. Loaded models don't.
  const drawn = useMemo(
    () => ({
      // The same man as the walkers and the player's rider, seated on the bike in one pose.
      rider: createSeatedRiderGeometry(createRiderModel(getModel(scene, 'man'), COMMUTER_LOOK), COMMUTER_LOOK, COMMUTER_SEAT, COMMUTER_HELMET),
      // Two riders in riding suits and their own helmets (people.glb), seated the same way: every other bike has one or the other.
      suited: (['rider-m', 'rider-f'] as const).map((name) => createSeatedRiderGeometry(createRiderModel(getModel(extraPeople, name), SUITED_LOOK), SUITED_LOOK, COMMUTER_SEAT, null)),
      parked: createParkedScooterGeometry(scene, STEERING_Z),
      parkedFar: createParkedScooterGeometry(scene, STEERING_Z, true),
    }),
    [scene, extraPeople],
  )
  // Two of the three two-wheeler shapes are built in code (twoWheelers.ts).
  const bikeShapes = useMemo(() => {
    const built = [createScooterGeometry(), createMotorcycleGeometry()]
    const lit = built.map((geometry) => withLamps(geometry, 'bike'))
    built.forEach((geometry) => geometry.dispose())
    return [shapes.bike, ...lit]
  }, [shapes])
  const bikePlates = useMemo(() => bikeShapes.map((shape) => createPlateGeometry(shape, PLATES.bike)), [bikeShapes])
  useEffect(() => () => {
    bikeShapes.slice(1).forEach((geometry) => geometry.dispose())
    bikePlates.forEach((geometry) => geometry.dispose())
  }, [bikeShapes, bikePlates])
  // Beyond the detail distance, each vehicle's far version: under 1,000 triangles with its wheels
  // (prepare_traffic_models.mjs), against about 6,500 near. Bikes add a simple rider. The bus is built
  // in code, not baked, so far away it's still a few boxes, and it keeps its own shape further out.
  const proxies = useMemo(
    () =>
      Object.fromEntries(
        VEHICLES.map(({ kind }) => [
          kind,
          farWithLamps(kind === 'bus' ? createProxyGeometry(shapes.bus) : kind === 'bike' ? createFarBikeGeometry(sportBike, 'bike') : createParkedCarGeometry(scene, kind, true), kind),
        ]),
      ) as Record<VehicleKind, THREE.BufferGeometry>,
    [shapes, scene, sportBike],
  )
  useEffect(() => () => Object.values(proxies).forEach((geometry) => geometry.dispose()), [proxies])
  const plateAtlas = useMemo(() => createPlateAtlas(), [])
  const plates = useMemo(
    () => Object.fromEntries(VEHICLES.map(({ kind }) => [kind, createPlateGeometry(shapes[kind], PLATES[kind])])) as Record<VehicleKind, THREE.BufferGeometry>,
    [shapes],
  )
  useEffect(() => () => {
    plateAtlas.dispose()
    Object.values(plates).forEach((geometry) => geometry.dispose())
  }, [plateAtlas, plates])
  const gl = useThree((state) => state.gl)
  // Shared with the rider's scooter, so it's never disposed of here.
  const reflection = getStreetReflection(gl)

  useEffect(
    () => () => {
      Object.values(drawn).flat().forEach((geometry) => geometry.dispose())
      women.forEach((woman) => woman.dispose())
    },
    [drawn, women],
  )

  // "Use any vehicle" looks for one to take among the vehicles in play (game/borrow.ts).
  useEffect(() => {
    borrow.world = world
    borrow.count = vehicles
    return () => {
      borrow.world = null
    }
  }, [world, vehicles])
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
    // Busier at the rush hours, quiet at night (duty.ts).
    easeDensity(world, dayPeriod(liveSky.hours).traffic, delta)
    // Traffic's lamps come up with the dark (vehicleLamps.ts).
    lampUniforms.uLampNight.value = liveSky.look.night
    stepTraffic(world, rider, vehicles, pedestrians, Math.min(delta, MAX_STEP))
    // Debug: the traffic, for checking from the console that no two vehicles overlap.
    if (isDebug()) (window as unknown as { __deliverItTraffic?: unknown }).__deliverItTraffic = { vehicles: world.vehicles.slice(0, vehicles) }
    takeHonks(world, ({ kind, x, z }) => playHorn(kind, x, z, rider))
    takeImpacts(world, ({ x, z, strength }) => playImpact(x, z, strength, rider))
    updateTrafficSounds(inPlay, rider, Math.min(delta, MAX_STEP))
  })

  return (
    <>
      <LodCamera />
      <JunctionWatch scooter={scooter} world={world} />
      {VEHICLES.map(({ kind, palette }) => {
        const items = inPlay.filter((vehicle) => vehicle.kind === kind)
        if (kind === 'bike') {
          const byShape = bikeShapes.map((_, shape) => items.filter((item) => bikeShapeOf(item) === shape))
          const byRider = [0, 1, 2].map((who) => items.filter((item) => riderOf(item) === who))
          return (
            <group key={kind}>
              {bikeShapes.map((geometry, shape) => (
                <group key={shape}>
                  <MovingInstances items={byShape[shape]} geometry={geometry} palette={palette} castShadow={shadowSize > 0} baked lamps reflection={reflection} reach={detail} />
                  <NumberPlates items={byShape[shape]} geometry={bikePlates[shape]} commercial={false} atlas={plateAtlas} reach={Math.min(detail, PLATE_REACH)} />
                </group>
              ))}
              {/* Who's riding: the man in a jacket, or one of the two riders in suits, by the bike. */}
              {[drawn.rider, ...drawn.suited].map((geometry, who) => (
                <MovingInstances key={who} items={byRider[who]} geometry={geometry} palette={JACKET_COLORS} castShadow={shadowSize > 0} reflection={reflection} seatedRider cloth reach={detail} />
              ))}
              <MovingInstances items={items} geometry={proxies.bike} palette={palette} castShadow={false} baked lamps reflection={reflection} from={detail} />
              {/* Only the model has separate wheels to spin. The built shapes carry theirs. */}
              <VehicleWheels items={byShape[0]} wheels={wheels.bike} reach={detail} />
            </group>
          )
        }
        const near = kind === 'bus' ? Math.max(detail, BUS_DETAIL_DISTANCE) : detail
        return (
          <group key={kind}>
            <MovingInstances
              items={items}
              geometry={shapes[kind]}
              palette={palette}
              castShadow={shadowSize > 0}
              baked
              lamps
              reflection={reflection}
              reach={near}
            />
            <MovingInstances items={items} geometry={proxies[kind]} palette={palette} castShadow={false} baked lamps reflection={reflection} from={near} />
            {/* The bus's wheels are part of its shape. */}
            {kind !== 'bus' && <VehicleWheels items={items} wheels={wheels[kind]} reach={detail} />}
            <NumberPlates items={items} geometry={plates[kind]} commercial={PLATES[kind].commercial} atlas={plateAtlas} reach={Math.min(detail, PLATE_REACH)} />
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
        reach={Math.min(LOOSE_DRAW_DISTANCE, PARKED_DETAIL_DISTANCE)}
        nearestOnly
      />
      <MovingInstances
        items={world.loose}
        geometry={drawn.parkedFar}
        palette={PARKED_COLORS}
        castShadow={false}
        baked
        reflection={reflection}
        reach={Math.min(LOOSE_DRAW_DISTANCE, PARKED_DRAW_DISTANCE)}
        from={PARKED_DETAIL_DISTANCE}
        nearestOnly
      />
      {bodies.map((body, group) => (
        <People key={body.uuid} items={crowds[group]} body={body} />
      ))}
      {thrownRiders.length > 0 && <People items={thrownRiders} body={bodies[0]} palette={BIKE_COLORS} ground={ROAD_HEIGHT} />}
      {/* Drivers who have got out of a vehicle the player took ("Use any vehicle"). */}
      <People items={world.drivers} body={bodies[0]} ground={ROAD_HEIGHT} />
      <CarHeadlights items={inPlay} count={carLights} />
    </>
  )
}

// Models aren't preloaded here: the title screen's loader downloads them (src/game/preload.ts).
