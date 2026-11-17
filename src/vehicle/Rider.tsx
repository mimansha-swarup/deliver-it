import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { findColour, HELMETS } from '../game/garage'
import { useGameStore } from '../game/gameStore'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { HIP, JOG, type Probe } from './riderShape'
import { createRiderMaterial, createRiderModel, type RiderModel, type RiderPose } from './riderModel'
import { getTravelSpeed, type ScooterState } from './ScooterController'
import { tuning } from './tuning'
import { BRAND_DYE, BRAND_INK, createJacketPrintTexture } from './brandPrint'

/*
 * The rider, on the same character base as the people in the street: the man
 * model, dressed in the Deliver It jacket with gloves, under a full-face helmet,
 * and bent by a shader as the walkers are (riderModel.ts). Each frame this
 * works out where the hands and feet must be (on the grips, which swing as the
 * bars turn; on the footboard, or one down when the scooter stops; hanging,
 * jogging back or limp after a fall), then the shoulder, elbow, hip and knee
 * angles that put them there.
 */

const LOOK = { jacket: BRAND_DYE, glove: '#1c1d20', trousers: '#2b3a55', shoe: '#17171a' }
const HELMET = '#f4f3ef'
const VISOR = '#14191e'

/** How far around the back the print wraps, in radians, how tall it is, and how far off the jacket it sits. */
const PRINT_WRAP = 1.9
const PRINT_HEIGHT = 0.22
const PRINT_LIFT = 0.008

/** How far the rider's back leans forward when sitting still, in radians. */
const SIT_LEAN = 0.5
/** Where each hand grips, measured from the steering column. */
const GRIP = new THREE.Vector3(0.38, 1.05, -0.18)
export const STEERING_Z = 0.45
const FOOT_REST = new THREE.Vector3(0.17, 0.42, -0.08)
/**
 * Where the left foot lands when the scooter stops: the ankle, on tiptoe, a
 * little back from the footboard. A real-sized leg doesn't reach the ground
 * flat from the seat, so the rider also shifts their hips over to that side.
 */
const FOOT_DOWN = new THREE.Vector3(0.3, 0.12, -0.24)
const FOOT_DOWN_HIP_SHIFT = new THREE.Vector3(0.08, -0.05, 0)
const FOOT_DOWN_SPEED = 1
const FOOT_RESPONSE = 9

/** Off the scooter: how far a jogging hand swings forward and back, in metres. */
const ARM_SWING = 0.22

const toModel = new THREE.Matrix4()
const lowerToFeet = new THREE.Matrix4()
const toRider = new THREE.Matrix4()
const target = new THREE.Vector3()
const reach = new THREE.Vector3()
const shoulder = new THREE.Vector3()
const hand = new THREE.Vector3()
const foot = new THREE.Vector3()
const elbow = new THREE.Vector3()
const offHand = new THREE.Vector3()
const limpHand = new THREE.Vector3()
const offFoot = new THREE.Vector3()
const limpFoot = new THREE.Vector3()

/**
 * Poses one limb so its end reaches `end` (in the rider's space): turned forward
 * and out at its joint, and bent in the middle, as the shader bends it. The
 * bend comes from how far the end is (law of cosines); the turns then aim the
 * bent limb at it. Angles are set relative to how the limb hangs as modelled.
 * Returns where the middle joint ends up, in the rider's space, for the probes.
 */
function poseLimb(
  angles: THREE.Vector3,
  joint: THREE.Vector3,
  end: THREE.Vector3,
  first: number,
  second: number,
  rest: { forward: number; out: number },
  side: number,
  bendsBack: boolean,
  middle: THREE.Vector3,
) {
  target.copy(end).applyMatrix4(toModel)
  reach.subVectors(target, joint)
  const distance = Math.min(Math.max(reach.length(), Math.abs(first - second) + 0.001), first + second - 0.001)
  reach.setLength(distance)
  const bend = Math.acos(THREE.MathUtils.clamp((distance * distance - first * first - second * second) / (2 * first * second), -1, 1))
  // How far forward of the first bone the end lies, once bent.
  const lead = Math.atan2(second * Math.sin(bend) * (bendsBack ? -1 : 1), first + second * Math.cos(bend))
  const forward = Math.asin(THREE.MathUtils.clamp(reach.z / distance, -1, 1)) - lead
  const out = Math.atan2(reach.x * side, -reach.y)
  angles.set(forward - rest.forward, out - rest.out, bend)
  // The middle joint, where the first bone ends.
  middle.set(
    joint.x + first * Math.cos(forward) * Math.sin(out * side),
    joint.y - first * Math.cos(forward) * Math.cos(out),
    joint.z + first * Math.sin(forward),
  ).applyMatrix4(toRider)
}

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
 * Where a hand goes. On the scooter it holds its grip, which swings round the
 * steering column as the bars turn. Off it, the hand hangs, pumps back and
 * forth against the legs while jogging, or flings out when limp.
 */
function handTarget(sign: number, steerAngle: number, off: number, limp: number, jog: number, step: FootStep, shoulderAt: THREE.Vector3, armLength: number) {
  const x = sign * GRIP.x
  hand.set(
    x * Math.cos(steerAngle) + GRIP.z * Math.sin(steerAngle),
    GRIP.y,
    STEERING_Z - x * Math.sin(steerAngle) + GRIP.z * Math.cos(steerAngle),
  )
  if (off > 0) {
    const swing = (-step.forward / JOG.reach) * ARM_SWING
    offHand.set(shoulderAt.x + sign * (0.05 - 0.04 * jog), shoulderAt.y - armLength * 0.95 + 0.24 * jog, shoulderAt.z + (0.14 + swing) * jog)
    limpHand.set(sign * 0.62, shoulderAt.y + 0.12, shoulderAt.z + 0.12 * sign)
    offHand.lerp(limpHand, limp)
    hand.lerp(offHand, off)
  }
  return hand
}

/** Moves a foot from the scooter to where it is off it: under the hip standing, in its stride jogging, or straight out when limp. */
function placeOffFoot(footPosition: THREE.Vector3, sign: number, off: number, limp: number, jog: number, step: FootStep) {
  if (off === 0) return
  offFoot.set(sign * 0.12, 0.08 + step.lift * jog, HIP.z + step.forward * jog)
  limpFoot.set(sign * 0.2, 0.05, HIP.z - 0.05)
  offFoot.lerp(limpFoot, limp)
  footPosition.lerp(offFoot, off)
}

/** The hips, waist and chest probes, as shares of the way up to the shoulders. The helmet's is the fourth. */
const BODY_PROBE_SHARES = [0, 0.5, 0.95]

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

  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const model: RiderModel = useMemo(() => createRiderModel(getModel(scene, 'man'), LOOK), [scene])
  const pose: RiderPose = useMemo(
    () => ({ leftArm: new THREE.Vector3(), rightArm: new THREE.Vector3(), leftLeg: new THREE.Vector3(), rightLeg: new THREE.Vector3() }),
    [],
  )
  const riderMaterial = useMemo(() => createRiderMaterial(model, pose), [model, pose])
  useEffect(
    () => () => {
      model.geometry.dispose()
      riderMaterial.dispose()
    },
    [model, riderMaterial],
  )

  const materials = useMemo(
    () => ({
      trim: new THREE.MeshStandardMaterial({ color: BRAND_INK, roughness: 0.7 }),
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

  const printTexture = useMemo(() => createJacketPrintTexture(), [])

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

  const { size } = model
  // The body group's origin is the hips; the model stands with its feet at 0.
  const hipsUp = size.hipY
  // The print wraps the back of the jacket: a strip of a cylinder as wide as the torso, squashed to its depth.
  const printRadius = size.printHalfWidth + PRINT_LIFT
  const printDepth = Math.max(0.3, (-size.printBack + PRINT_LIFT) / printRadius)
  const joints = useMemo(
    () => ({
      shoulders: [new THREE.Vector3(size.shoulderX, size.shoulderY, 0), new THREE.Vector3(-size.shoulderX, size.shoulderY, 0)],
      hips: [new THREE.Vector3(size.hipX, size.hipY, 0), new THREE.Vector3(-size.hipX, size.hipY, 0)],
    }),
    [size],
  )
  const bodyProbes = useMemo(
    () => [
      ...BODY_PROBE_SHARES.map((share) => new THREE.Vector3(0, (size.shoulderY - hipsUp) * share, 0)),
      size.head.clone().setY(size.head.y - hipsUp),
    ],
    [size, hipsUp],
  )

  useFrame((_, delta) => {
    const state = scooter.current
    const group = body.current
    if (!group) return
    const speed = getTravelSpeed(state)
    const steer = state.steer * steerAngle
    const crouch = Math.min(speed / tuning.maxSpeed, 1) * (state.boostLeft > 0 || state.nitroOn ? 1 : 0.45)

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
    // Stopped, the hips shift over to the side the foot goes down on.
    const shift = footDown.current * (1 - off)

    // The body first: everything else is worked out in its frame.
    group.position.set(HIP.x + FOOT_DOWN_HIP_SHIFT.x * shift, HIP.y + bob + FOOT_DOWN_HIP_SHIFT.y * shift, HIP.z)
    group.rotation.set(torso, 0, -state.lean * 0.35 * (1 - off))
    group.updateMatrix()
    // The model's own space: the body group's, with the hips raised to where the model has them.
    toRider.copy(group.matrix).multiply(lowerToFeet.makeTranslation(0, -hipsUp, 0))
    toModel.copy(toRider).invert()
    bodyProbes.forEach((point, index) => probes[index].point.copy(point).applyMatrix4(group.matrix))

    const armLength = size.upperArm + size.forearm
    for (const [index, sign] of [[0, 1], [1, -1]] as const) {
      shoulder.copy(joints.shoulders[index]).applyMatrix4(toRider)
      handTarget(sign, steer, off, limp, jog, sign > 0 ? leftStep : rightStep, shoulder, armLength)
      poseLimb(index === 0 ? pose.leftArm : pose.rightArm, joints.shoulders[index], hand, size.upperArm, size.forearm, size.armRest, sign, false, elbow)
      probes[4 + index].point.copy(elbow)
      probes[6 + index].point.copy(hand)
    }
    for (const [index, sign] of [[0, 1], [1, -1]] as const) {
      if (sign > 0) foot.copy(FOOT_REST).lerp(FOOT_DOWN, footDown.current)
      else foot.set(-FOOT_REST.x, FOOT_REST.y, FOOT_REST.z)
      placeOffFoot(foot, sign, off, limp, jog, sign > 0 ? leftStep : rightStep)
      poseLimb(index === 0 ? pose.leftLeg : pose.rightLeg, joints.hips[index], foot, size.thigh, size.shin, size.legRest, sign, true, elbow)
      probes[8 + index].point.copy(elbow)
      probes[10 + index].point.copy(foot)
    }

    // Looks where it's going: the head turns back against the torso's lean, so the eyes stay level.
    if (head.current) {
      head.current.rotation.y = state.steer * 0.3 * (1 - off)
      head.current.rotation.z = state.lean * 0.45 * (1 - off)
      head.current.rotation.x = -torso - crouch * 0.02 * (1 - off) + 0.08
    }
  })

  return (
    <group ref={body} position={HIP} matrixAutoUpdate={false}>
      <mesh geometry={model.geometry} material={riderMaterial} position={[0, -hipsUp, 0]} frustumCulled={false} />
      {/* The jacket's dark collar, round the neck. */}
      <mesh position={[0, size.shoulderY - hipsUp + 0.04, size.head.z]} material={materials.trim}>
        <cylinderGeometry args={[0.07, 0.09, 0.07, 12]} />
      </mesh>
      {/* The print: a curved strip of the torso's own shape, wrapped around the back. */}
      <mesh position={[0, size.printY - hipsUp, 0]} scale={[1, 1, printDepth]}>
        <cylinderGeometry args={[printRadius, printRadius, PRINT_HEIGHT, 16, 1, true, Math.PI - PRINT_WRAP / 2, PRINT_WRAP]} />
        <meshStandardMaterial map={printTexture} transparent roughness={0.8} depthWrite={false} />
      </mesh>

      <group ref={head} position={[size.head.x, size.head.y - hipsUp, size.head.z]}>
        {/* Helmet, over the model's head */}
        <mesh scale={[0.96, 1, 1.08]} material={materials.helmet}>
          <sphereGeometry args={[0.15, 18, 14]} />
        </mesh>
        {/* Visor */}
        <mesh position={[0, -0.01, 0.045]} scale={[0.94, 0.68, 1.08]} material={materials.visor}>
          <sphereGeometry args={[0.145, 16, 12]} />
        </mesh>
        {/* A stripe over the top, so the helmet shows which way it faces */}
        <mesh position={[0, 0.03, -0.01]} scale={[0.2, 1, 1.1]} material={materials.trim}>
          <sphereGeometry args={[0.135, 12, 10]} />
        </mesh>
      </group>
    </group>
  )
}
