import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { findColour, HELMETS } from '../game/garage'
import { useGameStore } from '../game/gameStore'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { gaitAt, HIP, SHUFFLE, WALK, type Gait, type Probe } from './riderShape'
import { createRiderMaterial, createRiderModel, poseLimb, type RiderModel, type RiderPose } from './riderModel'
import { getTravelSpeed, type ScooterState } from './ScooterController'
import { liveSeat } from './riderSeat'
import { tuning } from './tuning'
import { BICYCLE_BRACKET, BICYCLE_CRANK } from './vehicleBodies'
import { liveVehicle } from './vehicleCatalog'
import { BRAND_DYE, BRAND_INK, createHelmetDecalTexture, createJacketPrintTexture } from './brandPrint'

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

export const STEERING_Z = 0.45
/**
 * Where the left foot lands when the scooter stops: the ankle, on tiptoe, a
 * little back from the footboard. A real-sized leg doesn't reach the ground
 * flat from the seat, so the rider also shifts their hips over to that side.
 */
const FOOT_DOWN = new THREE.Vector3(0.3, 0.12, -0.24)
const FOOT_DOWN_HIP_SHIFT = new THREE.Vector3(0.08, -0.05, 0)
const FOOT_DOWN_SPEED = 1
const FOOT_RESPONSE = 9

/** Standing: the chest rises and falls this far, in metres, this many times a second (in radians). */
const BREATH = { rise: 0.004, rate: 1.7, tip: 0.006 }
/** Turning on the spot: the feet shuffle fully at this turning speed, in radians per second, and take a stride for each this many radians turned. */
const SHUFFLE_AT = 2.2
const SHUFFLE_STRIDE_PER_RADIAN = 3.6

const toModel = new THREE.Matrix4()
const lowerToFeet = new THREE.Matrix4()
const toRider = new THREE.Matrix4()
const shoulder = new THREE.Vector3()
const hand = new THREE.Vector3()
const foot = new THREE.Vector3()
const footGround = new THREE.Vector3()
const elbow = new THREE.Vector3()
const offHand = new THREE.Vector3()
const limpHand = new THREE.Vector3()
const offFoot = new THREE.Vector3()
const limpFoot = new THREE.Vector3()

/** Where each foot is in a jog, from `jogFoot`: forward of the hip, height off the ground, and how much weight is on it. */
type FootStep = { forward: number; lift: number; load: number }
const leftStep: FootStep = { forward: 0, lift: 0, load: 0 }
const rightStep: FootStep = { forward: 0, lift: 0, load: 0 }

/**
 * Where a foot is at this point in a stride of a gait (riderShape.ts). For `stance` of the stride
 * it's planted, sliding back under the hip as fast as the body goes forward, so it doesn't skate.
 * Then it lifts and swings through to land in front again. The right foot is half a stride behind
 * the left.
 */
function strideFoot(step: FootStep, stride: number, sign: number, gait: Gait) {
  const turns = stride / (Math.PI * 2) + (sign > 0 ? 0 : 0.5)
  const phase = turns - Math.floor(turns)
  if (phase < gait.stance) {
    step.forward = gait.reach * (1 - (2 * phase) / gait.stance)
    step.lift = 0
    step.load = Math.sin((Math.PI * phase) / gait.stance)
    return
  }
  const swing = (phase - gait.stance) / (1 - gait.stance)
  const eased = swing * swing * (3 - 2 * swing)
  step.forward = gait.reach * (2 * eased - 1)
  step.lift = gait.footLift * Math.sin(Math.PI * swing)
  step.load = 0
}

/**
 * Where a hand goes. On the scooter it holds its grip, which swings round the
 * steering column as the bars turn. Off it, the hand hangs and swings against the legs in a walk,
 * pumps with the elbow bent in a jog, or flings out when limp. `moving` is how much of a stride
 * there is at all.
 */
function handTarget(sign: number, steerAngle: number, off: number, limp: number, moving: number, gait: Gait, step: FootStep, shoulderAt: THREE.Vector3, armLength: number) {
  // The vehicle's own bars or wheel (vehicleCatalog.ts' seat): the grips swing about its column.
  const { grip, column, side } = liveVehicle.spec.seat
  const x = sign * grip[0]
  hand.set(
    side + x * Math.cos(steerAngle) + grip[2] * Math.sin(steerAngle),
    grip[1],
    column - x * Math.sin(steerAngle) + grip[2] * Math.cos(steerAngle),
  )
  if (off > 0) {
    // Against the leg on its own side: forward as that foot goes back.
    const swing = (-step.forward / Math.max(0.05, gait.reach)) * gait.armSwing * moving
    const bend = gait.armBend * moving
    // A hanging hand rises a little at each end of its swing, as an arm swung from the shoulder does.
    const arc = (Math.abs(swing) / Math.max(0.05, gait.armSwing)) * 0.035 * (1 - bend)
    offHand.set(shoulderAt.x + sign * (0.06 - 0.05 * bend), shoulderAt.y - armLength * 0.95 + 0.24 * bend + arc, shoulderAt.z + 0.02 + 0.12 * bend + swing)
    limpHand.set(sign * 0.62, shoulderAt.y + 0.12, shoulderAt.z + 0.12 * sign)
    offHand.lerp(limpHand, limp)
    hand.lerp(offHand, off)
  }
  return hand
}

/** Moves a foot from the scooter to where it is off it: under the hip standing, in its stride walking or jogging, or straight out when limp. */
function placeOffFoot(footPosition: THREE.Vector3, sign: number, off: number, limp: number, moving: number, gait: Gait, step: FootStep) {
  if (off === 0) return
  offFoot.set(sign * gait.feetApart, 0.08 + step.lift * moving, HIP.z + step.forward * moving)
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
  /** On foot: the gait just now, how fast they're turning (eased), the heading last frame, and the strides taken turning on the spot. */
  const gait = useRef<Gait>({ ...WALK }).current
  const turning = useRef({ rate: 0, heading: 0, stride: 0 })

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
      rubber: new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.85 }),
      decal: new THREE.MeshStandardMaterial({ map: createHelmetDecalTexture(), transparent: true, alphaTest: 0.4, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1 }),
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
    () => () => {
      materials.decal.map?.dispose()
      Object.values(materials).forEach((material) => material.dispose())
    },
    [materials],
  )

  // The helmet colour bought at the Garage. Only the colour changes, so the material is kept.
  const helmetId = useGameStore((state) => state.helmetId)
  const helmetOn = useGameStore((state) => state.helmetOn)
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

  useFrame(({ clock }, delta) => {
    const state = scooter.current
    const group = body.current
    if (!group) return
    const speed = getTravelSpeed(state)
    const steer = state.steer * steerAngle
    const crouch = Math.min(speed / tuning.maxSpeed, 1) * (state.boostLeft > 0 || state.nitroOn ? 1 : 0.45)

    // How the rider sits on this vehicle (vehicleCatalog.ts' seat).
    const seat = liveVehicle.spec.seat
    const wantsFoot = seat.footDown && speed < FOOT_DOWN_SPEED && state.crashLeft === 0 ? 1 : 0
    footDown.current += (wantsFoot - footDown.current) * (1 - Math.exp(-FOOT_RESPONSE * delta))

    const { off, limp, stride, pace } = state.rider
    // Turning on the spot they shuffle round: short steps, a stride for so much of a turn.
    const turn = turning.current
    const turned = state.rider.phase === 'afoot' ? Math.atan2(Math.sin(state.rider.heading - turn.heading), Math.cos(state.rider.heading - turn.heading)) : 0
    turn.heading = state.rider.heading
    turn.rate += (Math.abs(turned) / Math.max(delta, 0.001) - turn.rate) * (1 - Math.exp(-10 * delta))
    const shuffle = Math.min(1, turn.rate / SHUFFLE_AT) * Math.max(0, 1 - pace / SHUFFLE.pace)
    turn.stride += Math.abs(turned) * SHUFFLE_STRIDE_PER_RADIAN * (shuffle > 0 ? 1 : 0)
    // The gait for their speed: a walk, a jog, or between; and how much of a stride there is at all.
    const moving = Math.max(gaitAt(pace, gait), shuffle) * (1 - limp)
    if (shuffle > 0 && pace < SHUFFLE.pace) {
      gait.reach = Math.max(gait.reach * (pace / SHUFFLE.pace), SHUFFLE.reach)
      gait.footLift = Math.max(gait.footLift * (pace / SHUFFLE.pace), SHUFFLE.footLift)
    }
    const phase = stride + turn.stride
    strideFoot(leftStep, phase, 1, gait)
    strideFoot(rightStep, phase, -1, gait)
    // The hips sit a little low on bent knees, sink a little more as each foot lands, and move over the foot that's down.
    const still = (1 - moving) * off * (1 - limp)
    const breath = Math.sin(clock.elapsedTime * BREATH.rate)
    const bob = -(gait.crouch + gait.sink * Math.max(leftStep.load, rightStep.load)) * moving * off + BREATH.rise * breath * still
    const sway = gait.sway * (leftStep.load - rightStep.load) * moving * off
    // Leans into a bend harder than the scooter. Off it, they stand up straight, tip a little into a walk, more into a jog.
    const torso = (seat.lean + crouch * (seat.footDown ? 0.16 : 0)) * (1 - off) + (0.02 + gait.lean * moving + BREATH.tip * breath * still) * off
    // Stopped, the hips shift over to the side the foot goes down on.
    const shift = footDown.current * (1 - off)

    // The body first: everything else is worked out in its frame.
    // On the vehicle the hips are on its seat; off it (a crash), they're where the scooter's are, as the fall and the jog back expect.
    const on = 1 - off
    group.position.set(
      HIP.x + (seat.hip[0] + seat.side - HIP.x) * on + FOOT_DOWN_HIP_SHIFT.x * shift + sway,
      HIP.y + (seat.hip[1] - HIP.y) * on + bob + FOOT_DOWN_HIP_SHIFT.y * shift,
      HIP.z + (seat.hip[2] - HIP.z) * on,
    )
    group.rotation.set(torso, 0, -state.lean * 0.35 * (1 - off))
    group.updateMatrix()
    // The model's own space: the body group's, with the hips raised to where the model has them.
    toRider.copy(group.matrix).multiply(lowerToFeet.makeTranslation(0, -hipsUp, 0))
    toModel.copy(toRider).invert()
    bodyProbes.forEach((point, index) => probes[index].point.copy(point).applyMatrix4(group.matrix))

    const armLength = size.upperArm + size.forearm
    for (const [index, sign] of [[0, 1], [1, -1]] as const) {
      shoulder.copy(joints.shoulders[index]).applyMatrix4(toRider)
      handTarget(sign, steer, off, limp, moving, gait, sign > 0 ? leftStep : rightStep, shoulder, armLength)
      poseLimb(index === 0 ? pose.leftArm : pose.rightArm, joints.shoulders[index], hand, size.upperArm, size.forearm, size.armRest, sign, false, elbow, toModel, toRider)
      probes[4 + index].point.copy(elbow)
      probes[6 + index].point.copy(hand)
    }
    for (const [index, sign] of [[0, 1], [1, -1]] as const) {
      if (seat.pedals) {
        // On the pedals, going round with the cranks: the right foot half a turn from the left.
        const angle = liveSeat.crank + (sign > 0 ? Math.PI : 0)
        foot.set(sign * seat.foot[0], BICYCLE_BRACKET[1] - Math.cos(angle) * BICYCLE_CRANK + 0.1, BICYCLE_BRACKET[2] - Math.sin(angle) * BICYCLE_CRANK)
      } else foot.set(seat.side + sign * seat.foot[0], seat.foot[1], seat.foot[2])
      // A foot down at a stop, on the left: beside where it rests, on the ground.
      if (sign > 0 && footDown.current > 0) {
        foot.lerp(footGround.set(seat.foot[0] + 0.17, FOOT_DOWN.y, seat.hip[2] + 0.12), footDown.current)
      }
      placeOffFoot(foot, sign, off, limp, moving, gait, sign > 0 ? leftStep : rightStep)
      poseLimb(index === 0 ? pose.leftLeg : pose.rightLeg, joints.hips[index], foot, size.thigh, size.shin, size.legRest, sign, true, elbow, toModel, toRider)
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

      {/* Bare-headed, when the helmet is left off: a head and hair where the helmet would be. */}
      <group visible={!helmetOn} position={[size.head.x, size.head.y - hipsUp, size.head.z]}>
        <mesh scale={[0.9, 1.05, 0.98]} position={[0, -0.01, 0.005]}>
          <sphereGeometry args={[0.108, 14, 10]} />
          <meshStandardMaterial color="#9a6a48" roughness={0.75} />
        </mesh>
        <mesh scale={[0.95, 0.8, 1.02]} position={[0, 0.035, -0.012]}>
          <sphereGeometry args={[0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color="#1c1714" roughness={0.9} />
        </mesh>
      </group>
      {/* Left off (the Garage's choice), the traffic police have something to say about it. */}
      <group ref={head} visible={helmetOn} position={[size.head.x, size.head.y - hipsUp, size.head.z]}>
        {/* The helmet, over the model's head (+z forward). Seen from behind and a little above, as the
            camera sees it: a shell with a dark rubber rim, the visor wrapping round to the sides on
            its pivots, a chin bar, vents on top and at the back, twin stripes, the Deliver It decal and
            the straps. */}
        <mesh scale={[0.96, 1, 1.08]} material={materials.helmet}>
          <sphereGeometry args={[0.15, 18, 14]} />
        </mesh>
        {/* The rim round the bottom edge, higher at the front. */}
        <mesh position={[0, -0.1, -0.01]} rotation={[Math.PI / 2 - 0.22, 0, 0]} scale={[0.98, 1.1, 1]} material={materials.rubber}>
          <torusGeometry args={[0.108, 0.013, 6, 24]} />
        </mesh>
        {/* The visor: a band across the eyes, wrapping well round the sides. */}
        <mesh scale={[0.985, 1, 1.1]} material={materials.visor}>
          <sphereGeometry args={[0.153, 20, 4, Math.PI / 2 - 1.3, 2.6, Math.PI * 0.4, Math.PI * 0.2]} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.146, -0.002, 0.012]} rotation={[0, 0, Math.PI / 2]} material={materials.rubber}>
            <cylinderGeometry args={[0.026, 0.026, 0.014, 12]} />
          </mesh>
        ))}
        {/* The chin bar, a little proud of the shell at the front and bottom. */}
        <mesh scale={[0.97, 1, 1.13]} material={materials.helmet}>
          <sphereGeometry args={[0.152, 18, 4, Math.PI / 2 - 1.15, 2.3, Math.PI * 0.6, Math.PI * 0.2]} />
        </mesh>
        {/* Two vents on top. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.035, 0.143, 0.045]} rotation={[0.3, 0, 0]} material={materials.rubber}>
            <boxGeometry args={[0.024, 0.012, 0.055]} />
          </mesh>
        ))}
        {/* Twin stripes, front to back over the top, either side of the middle. */}
        {[-1, 1].map((side) => (
          // A part ring in the front-to-back plane: from the rim at the back, under the decal, over the
          // top to the visor. Stopped short of the decal, the two stripes over it read as eyes.
          <mesh key={side} position={[side * 0.034, 0, 0]} rotation={[0, Math.PI / 2, -0.5]} scale={[1.08, 1, 1]} material={materials.trim}>
            <torusGeometry args={[0.1475, 0.006, 4, 24, Math.PI * 0.82]} />
          </mesh>
        ))}
        {/* An exhaust vent high on the crown between the stripes, and the Deliver It decal low on the back.
            One vent, not two either side: a pair of dark marks over the decal read as a face. */}
        <mesh position={[0, 0.128, -0.082]} rotation={[-0.58, 0, 0]} material={materials.rubber}>
          <boxGeometry args={[0.04, 0.01, 0.034]} />
        </mesh>
        <mesh scale={[0.96, 1, 1.08]} material={materials.decal}>
          <sphereGeometry args={[0.1508, 12, 3, (Math.PI * 3) / 2 - 0.52, 1.04, Math.PI * 0.5, Math.PI * 0.15]} />
        </mesh>
        {/* The strap's buckle end, across the back under the rim. */}
        <mesh position={[0, -0.122, -0.09]} rotation={[0.5, 0, 0]} material={materials.rubber}>
          <boxGeometry args={[0.1, 0.012, 0.012]} />
        </mesh>
        {/* The chin straps, down from under the rim at each side. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.085, -0.14, 0.035]} rotation={[0.2, 0, side * 0.35]} material={materials.rubber}>
            <boxGeometry args={[0.012, 0.075, 0.014]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
