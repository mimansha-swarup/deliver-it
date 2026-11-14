import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { findColour, HELMETS } from '../game/garage'
import { useGameStore } from '../game/gameStore'
import { HIP, JOG, type Probe } from './riderShape'
import { getTravelSpeed, type ScooterState } from './ScooterController'
import { tuning } from './tuning'
import { createPrintTexture, SHIRT_COLOR } from './shirtPrint'

const SKIN = '#b98a68'
const TROUSERS = '#2b3a55'
const SHOE = '#17171a'
const GLOVE = '#1c1d20'
const HELMET = '#f4f3ef'
const VISOR = '#14191e'

/** How far around the back the print wraps, in radians. */
const PRINT_WRAP = 1.9
const PRINT_HEIGHT = 0.24
/** How far up the torso the print sits. */
const PRINT_Y = 0.36
/** The print sits just off the shirt, so that the two never flicker. */
const PRINT_LIFT = 0.006
/** The torso's width where the print's top and bottom edges sit. */
const PRINT_TOP_RADIUS = 0.195
const PRINT_BOTTOM_RADIUS = 0.186

const SHOULDER_HEIGHT = 1.39
const SHOULDER_Z = -0.18
/** How far the rider's back leans forward when sitting still, in radians. */
const SIT_LEAN = 0.5
const SHOULDER_WIDTH = 0.2
/** Where each hand grips, measured from the steering column. */
const GRIP = new THREE.Vector3(0.38, 1.05, -0.18)
export const STEERING_Z = 0.45
const FOOT_REST = new THREE.Vector3(0.17, 0.42, -0.08)
/** Where the left foot lands when the scooter stops. */
const FOOT_DOWN = new THREE.Vector3(0.34, 0.05, -0.1)
const FOOT_DOWN_SPEED = 1
const FOOT_RESPONSE = 9

const UPPER_ARM = 0.36
const FOREARM = 0.35
const THIGH = 0.46
const SHIN = 0.48

const UP = new THREE.Vector3(0, 1, 0)
const direction = new THREE.Vector3()
const middle = new THREE.Vector3()
const side = new THREE.Vector3()

/** Stretches a one-metre cylinder so that it runs from one point to another. */
function placeLimb(limb: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
  direction.subVectors(to, from)
  const length = direction.length()
  limb.position.copy(from).addScaledVector(direction, 0.5)
  limb.quaternion.setFromUnitVectors(UP, direction.divideScalar(length))
  limb.scale.set(1, length, 1)
}

/**
 * Inverse kinematics: given a shoulder and a hand, it finds the elbow. Two bones
 * of fixed length can only meet at a point on a circle, and `bend` picks the side
 * of it that a real joint would bend towards.
 */
function findJoint(
  joint: THREE.Vector3,
  start: THREE.Vector3,
  end: THREE.Vector3,
  first: number,
  second: number,
  bend: THREE.Vector3,
) {
  direction.subVectors(end, start)
  const distance = Math.min(direction.length(), first + second - 0.001)
  direction.normalize()

  const along = (distance * distance + first * first - second * second) / (2 * distance)
  const out = Math.sqrt(Math.max(0, first * first - along * along))

  // The part of `bend` that's square to the limb is the way the joint pokes out.
  middle.copy(bend).addScaledVector(direction, -bend.dot(direction)).normalize()
  joint.copy(start).addScaledVector(direction, along).addScaledVector(middle, out)
}

const ELBOW_BEND = new THREE.Vector3(0, -1, -0.4)
const KNEE_BEND = new THREE.Vector3(0, 0.35, 1)

type LimbGroup = RefObject<THREE.Group | null>

/** The four parts of a limb inside its group, in the order they're drawn. */
function partsOf(limb: LimbGroup) {
  const [upper, lower, middleJoint, end] = (limb.current?.children ?? []) as THREE.Mesh[]
  return { upper, lower, middleJoint, end }
}

/** A tapered limb, with a ball at the joint so that the two parts never show a gap. */
function Limb({
  limb,
  topRadius,
  bottomRadius,
  material,
  lowerMaterial = material,
  endMaterial,
  endSize,
}: {
  limb: LimbGroup
  topRadius: number
  bottomRadius: number
  material: THREE.Material
  /** The part below the joint, if it's different, like a bare forearm under a sleeve. */
  lowerMaterial?: THREE.Material
  endMaterial: THREE.Material
  endSize: [number, number, number]
}) {
  return (
    <group ref={limb}>
      <mesh material={material}>
        <cylinderGeometry args={[bottomRadius * 1.15, topRadius, 1, 9]} />
      </mesh>
      <mesh material={lowerMaterial}>
        <cylinderGeometry args={[bottomRadius * 0.82, bottomRadius * 1.1, 1, 9]} />
      </mesh>
      <mesh material={lowerMaterial}>
        <sphereGeometry args={[bottomRadius * 1.14, 10, 8]} />
      </mesh>
      <mesh material={endMaterial}>
        <boxGeometry args={endSize} />
      </mesh>
    </group>
  )
}

const shoulder = new THREE.Vector3()
const hand = new THREE.Vector3()
const hip = new THREE.Vector3()
const foot = new THREE.Vector3()
const joint = new THREE.Vector3()

/** Off the scooter: how far a jogging hand swings forward and back, in metres. */
const ARM_SWING = 0.22
const offHand = new THREE.Vector3()
const limpHand = new THREE.Vector3()

/** The shoulders, from the hips, as they are sitting on the scooter. */
const SHOULDER_UP = SHOULDER_HEIGHT - HIP.y
const SHOULDER_FORWARD = SHOULDER_Z - HIP.z

/** Where each foot is in a jog, from `jogFoot`: forward of the hip, height off the ground, and how much weight is on it. */
type FootStep = { forward: number; lift: number; load: number }
const leftStep: FootStep = { forward: 0, lift: 0, load: 0 }
const rightStep: FootStep = { forward: 0, lift: 0, load: 0 }

/**
 * Where a foot is at this point in a jogging stride. For `JOG.stance` of the
 * stride it's planted, sliding back under the hip as fast as the body runs
 * forward, so it doesn't skate. Then it lifts and swings through to land in
 * front again. The right foot is half a stride behind the left.
 */
function jogFoot(step: FootStep, stride: number, sign: number) {
  const turns = stride / (Math.PI * 2) + (sign > 0 ? 0 : 0.5)
  const phase = turns - Math.floor(turns)
  if (phase < JOG.stance) {
    step.forward = JOG.reach * (1 - (2 * phase) / JOG.stance)
    step.lift = 0
    step.load = Math.sin((Math.PI * phase) / JOG.stance)
    return
  }
  const swing = (phase - JOG.stance) / (1 - JOG.stance)
  const eased = swing * swing * (3 - 2 * swing)
  step.forward = JOG.reach * (2 * eased - 1)
  step.lift = JOG.footLift * Math.sin(Math.PI * swing)
  step.load = 0
}

/**
 * `off` is how far off the scooter the rider is, `limp` how limp, and `jog` how
 * much they're jogging. On the scooter the hands hold the grips. Off it, they
 * hang, pump back and forth against the legs while jogging, or fling out when limp.
 * `torso` is how far the body leans forward, and `bob` how far the hips have
 * sunk, which the shoulders follow.
 */
function placeArm(
  limb: LimbGroup,
  sign: number,
  steerAngle: number,
  crouch: number,
  off: number,
  limp: number,
  jog: number,
  step: FootStep,
  torso: number,
  bob: number,
) {
  const { upper, lower, middleJoint, end } = partsOf(limb)
  if (!end) return

  // Off the scooter, the shoulders turn with the torso about the hips, from where they are when sitting.
  const turn = (torso - SIT_LEAN) * off
  shoulder.set(
    sign * SHOULDER_WIDTH,
    HIP.y + bob + SHOULDER_UP * Math.cos(turn) - SHOULDER_FORWARD * Math.sin(turn) - crouch * 0.08,
    HIP.z + SHOULDER_UP * Math.sin(turn) + SHOULDER_FORWARD * Math.cos(turn) + crouch * 0.08,
  )

  // The grip swings around the steering column as the bars turn.
  const x = sign * GRIP.x
  hand.set(
    x * Math.cos(steerAngle) + GRIP.z * Math.sin(steerAngle),
    GRIP.y,
    STEERING_Z - x * Math.sin(steerAngle) + GRIP.z * Math.cos(steerAngle),
  )

  if (off > 0) {
    // Hanging at the side, or, jogging, bent at the elbow and swinging against the leg on the same side.
    const swing = (-step.forward / JOG.reach) * ARM_SWING
    offHand.set(
      sign * (0.25 - 0.04 * jog),
      shoulder.y - 0.62 + 0.24 * jog,
      shoulder.z + (0.14 + swing) * jog,
    )
    limpHand.set(sign * 0.62, shoulder.y + 0.12, shoulder.z + 0.12 * sign)
    offHand.lerp(limpHand, limp)
    hand.lerp(offHand, off)
  }

  side.set(sign * 0.7, ELBOW_BEND.y, ELBOW_BEND.z)
  findJoint(joint, shoulder, hand, UPPER_ARM, FOREARM, side)
  placeLimb(upper, shoulder, joint)
  placeLimb(lower, joint, hand)
  middleJoint.position.copy(joint)
  end.position.copy(hand)
}

function placeLeg(limb: LimbGroup, sign: number, footPosition: THREE.Vector3, bob: number) {
  const { upper, lower, middleJoint, end } = partsOf(limb)
  if (!end) return

  hip.set(sign * 0.1, HIP.y + bob, HIP.z)
  side.set(sign * 0.25, KNEE_BEND.y, KNEE_BEND.z)
  findJoint(joint, hip, footPosition, THIGH, SHIN, side)
  placeLimb(upper, hip, joint)
  placeLimb(lower, joint, footPosition)
  middleJoint.position.copy(joint)
  end.position.set(footPosition.x, footPosition.y - 0.03, footPosition.z + 0.05)
}

const offFoot = new THREE.Vector3()
const limpFoot = new THREE.Vector3()

/** Moves a foot from the scooter to where it is off it: under the hip standing, in its stride jogging, or straight out when limp. */
function placeOffFoot(footPosition: THREE.Vector3, sign: number, off: number, limp: number, jog: number, step: FootStep) {
  if (off === 0) return
  offFoot.set(sign * 0.12, 0.05 + step.lift * jog, HIP.z + step.forward * jog)
  limpFoot.set(sign * 0.2, 0.02, HIP.z - 0.05)
  offFoot.lerp(limpFoot, limp)
  footPosition.lerp(offFoot, off)
}

/** Where the hips, waist, chest and helmet are in the body group. */
const BODY_PROBE_POINTS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0.25, 0.05),
  new THREE.Vector3(0, 0.52, 0.05),
  new THREE.Vector3(0, 0.72, 0.06),
]

/**
 * The rider. Hands stay on the grips, and a foot comes down when the scooter
 * stops. Each frame it also fills `probes`, in the rider's own space, so the
 * scooter can keep the body out of the ground when it falls or is thrown.
 */
export function Rider({
  scooter,
  steerAngle,
  reflection,
  probes,
}: {
  scooter: RefObject<ScooterState>
  steerAngle: number
  reflection: THREE.Texture
  probes: Probe[]
}) {
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const footDown = useRef(0)

  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)

  const materials = useMemo(
    () => ({
      shirt: new THREE.MeshStandardMaterial({ color: SHIRT_COLOR, roughness: 0.85 }),
      skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 }),
      trousers: new THREE.MeshStandardMaterial({ color: TROUSERS, roughness: 0.8 }),
      shoe: new THREE.MeshStandardMaterial({ color: SHOE, roughness: 0.6 }),
      glove: new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.7 }),
      helmet: new THREE.MeshStandardMaterial({
        color: HELMET,
        roughness: 0.2,
        metalness: 0.3,
        envMap: reflection,
      }),
      visor: new THREE.MeshStandardMaterial({
        color: VISOR,
        roughness: 0.08,
        metalness: 0.8,
        envMap: reflection,
      }),
    }),
    [reflection],
  )

  const printTexture = useMemo(() => createPrintTexture(), [])

  useEffect(
    () => () => Object.values(materials).forEach((material) => material.dispose()),
    [materials],
  )

  // The helmet colour bought at the Garage. Only the colour changes, so the material is kept.
  const helmetId = useGameStore((state) => state.helmetId)
  useEffect(() => {
    materials.helmet.color.set(findColour(HELMETS, helmetId).color)
  }, [materials, helmetId])
  useEffect(() => () => printTexture.dispose(), [printTexture])

  useFrame((_, delta) => {
    const state = scooter.current
    const speed = getTravelSpeed(state)
    const steer = state.steer * steerAngle
    const crouch = Math.min(speed / tuning.maxSpeed, 1) * (state.boostLeft > 0 ? 1 : 0.45)

    const wantsFoot = speed < FOOT_DOWN_SPEED && state.crashLeft === 0 ? 1 : 0
    footDown.current += (wantsFoot - footDown.current) * (1 - Math.exp(-FOOT_RESPONSE * delta))

    const { off, limp, stride, pace } = state.rider
    // Jogging back, the hips sit a little low on bent knees, and sink a little more as each foot lands.
    const jog = Math.min(1, pace / JOG.speed) * (1 - limp)
    jogFoot(leftStep, stride, 1)
    jogFoot(rightStep, stride, -1)
    const bob = -(JOG.crouch + JOG.sink * Math.max(leftStep.load, rightStep.load)) * jog * off
    // Leans into a bend harder than the scooter. Off it, they stand up straight, or lean into a jog.
    const torso = (SIT_LEAN + crouch * 0.16) * (1 - off) + (0.05 + 0.2 * jog) * off

    placeArm(leftArm, 1, steer, crouch, off, limp, jog, leftStep, torso, bob)
    probes[4].point.copy(joint)
    probes[6].point.copy(hand)
    placeArm(rightArm, -1, steer, crouch, off, limp, jog, rightStep, torso, bob)
    probes[5].point.copy(joint)
    probes[7].point.copy(hand)
    foot.copy(FOOT_REST).lerp(FOOT_DOWN, footDown.current)
    placeOffFoot(foot, 1, off, limp, jog, leftStep)
    placeLeg(leftLeg, 1, foot, bob)
    probes[8].point.copy(joint)
    probes[10].point.copy(foot)
    foot.set(-FOOT_REST.x, FOOT_REST.y, FOOT_REST.z)
    placeOffFoot(foot, -1, off, limp, jog, rightStep)
    placeLeg(rightLeg, -1, foot, bob)
    probes[9].point.copy(joint)
    probes[11].point.copy(foot)

    if (body.current) {
      body.current.position.y = HIP.y + bob
      body.current.rotation.z = -state.lean * 0.35 * (1 - off)
      body.current.rotation.x = torso
      body.current.updateMatrix()
      BODY_PROBE_POINTS.forEach((point, index) => probes[index].point.copy(point).applyMatrix4(body.current!.matrix))
    }
    // Looks where it's going: the head turns back against the torso's lean, so the eyes stay level.
    if (head.current) {
      head.current.rotation.y = state.steer * 0.3 * (1 - off)
      head.current.rotation.z = state.lean * 0.45 * (1 - off)
      head.current.rotation.x = -torso - crouch * 0.02 * (1 - off) + 0.08
    }
  })

  return (
    <>
      <group ref={body} position={HIP}>
        {/* Torso, with shoulders wider than the waist */}
        <mesh position={[0, 0.27, 0.05]} scale={[1, 1, 0.72]} material={materials.shirt}>
          <cylinderGeometry args={[0.2, 0.17, 0.54, 12]} />
        </mesh>
        <mesh position={[0, 0.54, 0.05]} scale={[1.08, 0.46, 0.74]} material={materials.shirt}>
          <sphereGeometry args={[0.2, 12, 10]} />
        </mesh>
        {/* The print: a curved strip of the torso's own shape, wrapped around the back. */}
        <mesh position={[0, PRINT_Y, 0.05]} scale={[1, 1, 0.72]}>
          <cylinderGeometry
            args={[
              PRINT_TOP_RADIUS + PRINT_LIFT,
              PRINT_BOTTOM_RADIUS + PRINT_LIFT,
              PRINT_HEIGHT,
              16,
              1,
              true,
              Math.PI - PRINT_WRAP / 2,
              PRINT_WRAP,
            ]}
          />
          <meshStandardMaterial map={printTexture} transparent roughness={0.8} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0, 0]} scale={[1, 0.8, 0.85]} material={materials.trousers}>
          <sphereGeometry args={[0.19, 12, 10]} />
        </mesh>

        <group ref={head} position={[0, 0.72, 0.06]}>
          {/* Helmet */}
          <mesh scale={[0.96, 1, 1.08]} material={materials.helmet}>
            <sphereGeometry args={[0.15, 18, 14]} />
          </mesh>
          {/* Visor */}
          <mesh
            position={[0, -0.01, 0.045]}
            scale={[0.94, 0.68, 1.08]}
            material={materials.visor}
          >
            <sphereGeometry args={[0.145, 16, 12]} />
          </mesh>
          {/* A stripe over the top, so the helmet shows which way it faces */}
          <mesh position={[0, 0.03, -0.01]} scale={[0.2, 1, 1.1]} material={materials.shirt}>
            <sphereGeometry args={[0.135, 12, 10]} />
          </mesh>
        </group>
      </group>

      <Limb
        limb={leftArm}
        topRadius={0.06}
        bottomRadius={0.046}
        material={materials.shirt}
        lowerMaterial={materials.skin}
        endMaterial={materials.glove}
        endSize={[0.08, 0.07, 0.1]}
      />
      <Limb
        limb={rightArm}
        topRadius={0.06}
        bottomRadius={0.046}
        material={materials.shirt}
        lowerMaterial={materials.skin}
        endMaterial={materials.glove}
        endSize={[0.08, 0.07, 0.1]}
      />
      <Limb
        limb={leftLeg}
        topRadius={0.092}
        bottomRadius={0.062}
        material={materials.trousers}
        endMaterial={materials.shoe}
        endSize={[0.1, 0.07, 0.25]}
      />
      <Limb
        limb={rightLeg}
        topRadius={0.092}
        bottomRadius={0.062}
        material={materials.trousers}
        endMaterial={materials.shoe}
        endSize={[0.1, 0.07, 0.25]}
      />
    </>
  )
}
