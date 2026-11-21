import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { findColour, HELMETS } from '../game/garage'
import { useGameStore } from '../game/gameStore'
import { getModel, PEOPLE_MODELS_URL } from '../traffic/modelFiles'
import { GAIT as STREET_GAIT, IDLE_POSE, STRIDE_PER_METRE } from '../traffic/gait'
import { Walker, type WalkerPose } from '../traffic/Traffic'
import { useRoomStore } from '../net/room'
import { livePlayer } from '../game/livePlayer'
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

const LOOK = { jacket: BRAND_DYE, glove: '#1c1d20', trousers: '#2b3a55', shoe: '#17171a', ownGear: true }
/**
 * On foot the rider is drawn as the pedestrians are: a standing body of their build, walking by
 * their shader (traffic/Traffic.tsx's Walker), in the jacket and the helmet. The seated model is a
 * rider's shape, made to sit; stood up it was hunched, with its arms against its sides. It is kept
 * for the seat, for getting on and off, and for a fall. `swapAt` is how far off the vehicle they
 * are when the standing body takes over; `full` the pace by which they're fully walking; above
 * `jogFrom` the strides lengthen (so a jog isn't a blur of tiny steps), by `longer` per metre a second.
 */
const ON_FOOT = { swapAt: 0.97, full: 0.6, jogFrom: 1.6, longer: 0.45, response: 9, helmetDown: 0.13, shuffle: 0.4 }
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
/**
 * Standing about, they don't stand like a statue. After `after` seconds still, and then every
 * `every` seconds or so (lowest to highest), one of: a look round (the head turns one way, then
 * the other), the weight shifted onto one leg, or the phone checked (a hand up in front, the head
 * down to it). Each takes `lasts` seconds, eased in and out, and stops the moment they move.
 */
const FIDGET = { after: 3.5, every: [4, 9], lasts: { look: 2.6, shift: 3.4, phone: 3.2 }, look: 0.55, shift: 0.04, tilt: 0.035, nod: 0.3 }
type Fidget = keyof typeof FIDGET.lasts
const FIDGETS: Fidget[] = ['look', 'shift', 'phone', 'look', 'shift']
const phoneHand = new THREE.Vector3()

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
function handTarget(sign: number, steerAngle: number, off: number, limp: number, moving: number, gait: Gait, step: FootStep, shoulderAt: THREE.Vector3, armLength: number, raised = 0) {
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
    // Checking the phone: the hand up in front of the chest.
    if (raised > 0) offHand.lerp(phoneHand.set(sign * 0.1, shoulderAt.y - 0.26, shoulderAt.z + 0.3), raised)
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
  /** The seated model's own parts (hidden while the standing body is drawn), and what holds the head, bare or helmeted. */
  const seated = useRef<THREE.Group>(null)
  const headRoot = useRef<THREE.Group>(null)
  const walkerPose = useRef<WalkerPose>({ stride: 0, walking: 0, idle: IDLE_POSE.still, visible: false })
  const footDown = useRef(0)
  /** On foot: the gait just now, how fast they're turning (eased), the heading last frame, and the strides taken turning on the spot. */
  const gait = useRef<Gait>({ ...WALK }).current
  const turning = useRef({ rate: 0, heading: 0, stride: 0 })
  /** Standing: seconds they've been still, until the next fidget, which it is, how far through, and which way it goes. */
  const fidget = useRef({ still: 0, wait: FIDGET.after, kind: null as Fidget | null, time: 0, side: 1, count: 0 })

  // The rider is the bike rider from people.glb, in the Deliver It jacket and helmet over his own riding suit and boots.
  const { scene: people } = useGLTF(PEOPLE_MODELS_URL)
  // On foot: one of the pedestrians' own bodies (long sleeves that take the jacket's colour, trousers, shoes), and how high his head is.
  const standing = useMemo(() => {
    const geometry = getModel(people, 'office')
    geometry.computeBoundingBox()
    return { geometry, top: geometry.boundingBox?.max.y ?? 1.7 }
  }, [people])
  // In a room with friends the jacket is this rider's colour there, as the others see it; alone it's Deliver It's yellow.
  const roomColour = useRoomStore((state) => (state.status === 'on' ? state.me.colour : null))
  const model: RiderModel = useMemo(() => createRiderModel(getModel(people, 'biker'), roomColour ? { ...LOOK, jacket: roomColour } : LOOK), [people, roomColour])
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
    // Standing about on foot: now and then a look round, a shift of weight, a look at the phone.
    const idle = fidget.current
    let looking = 0
    let shifted = 0
    let phone = 0
    if (state.rider.phase === 'afoot' && moving < 0.05) {
      idle.still += delta
      if (idle.kind) {
        idle.time += delta
        const through = idle.time / FIDGET.lasts[idle.kind]
        // In over the first fifth, out over the last.
        const amount = Math.min(1, through * 5, (1 - through) * 5)
        const eased = Math.max(0, amount * amount * (3 - 2 * amount))
        if (idle.kind === 'look') looking = Math.sin(through * Math.PI * 2) * FIDGET.look * idle.side
        else if (idle.kind === 'shift') shifted = eased * idle.side
        else phone = eased
        if (through >= 1) idle.kind = null
      } else if (idle.still > idle.wait) {
        idle.kind = FIDGETS[idle.count++ % FIDGETS.length]
        idle.time = 0
        idle.side = idle.count % 2 === 0 ? 1 : -1
        idle.wait = idle.still + FIDGET.lasts[idle.kind] + FIDGET.every[0] + Math.random() * (FIDGET.every[1] - FIDGET.every[0])
      }
    } else {
      idle.still = 0
      idle.wait = FIDGET.after
      idle.kind = null
    }
    const breath = Math.sin(clock.elapsedTime * BREATH.rate)
    const bob = -(gait.crouch + gait.sink * Math.max(leftStep.load, rightStep.load)) * moving * off + BREATH.rise * breath * still
    const sway = gait.sway * (leftStep.load - rightStep.load) * moving * off + FIDGET.shift * shifted
    // Leans into a bend harder than the scooter. Off it, they stand up straight, tip a little into a walk, more into a jog.
    const afoot = state.rider.phase === 'afoot' ? off : 0
    const torso = (seat.lean + crouch * (seat.footDown ? 0.16 : 0)) * (1 - off) + (0.02 + gait.lean * moving + BREATH.tip * breath * still) * off + state.rider.tip * afoot
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
    // On foot they lean into a turn from the feet, which stay where they are: the hips move over with the lean.
    // The shoulders turn with each step, against the legs: what makes a walk look loose from behind.
    const twist = gait.twist * Math.cos(phase) * moving * afoot
    group.rotation.set(torso, twist, -state.lean * 0.35 * (1 - off) - state.rider.lean * afoot - FIDGET.tilt * shifted)
    group.position.x += state.rider.lean * afoot * 0.5
    group.updateMatrix()
    // The model's own space: the body group's, with the hips raised to where the model has them.
    toRider.copy(group.matrix).multiply(lowerToFeet.makeTranslation(0, -hipsUp, 0))
    toModel.copy(toRider).invert()
    bodyProbes.forEach((point, index) => probes[index].point.copy(point).applyMatrix4(group.matrix))

    const armLength = size.upperArm + size.forearm
    for (const [index, sign] of [[0, 1], [1, -1]] as const) {
      shoulder.copy(joints.shoulders[index]).applyMatrix4(toRider)
      handTarget(sign, steer, off, limp, moving, gait, sign > 0 ? leftStep : rightStep, shoulder, armLength, sign > 0 ? phone : 0)
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

    // On foot, the standing body: walking by the distance covered (so the feet don't slide), standing when still.
    const afootNow = (state.rider.phase === 'afoot' || state.rider.phase === 'walking') && off >= ON_FOOT.swapAt && limp < 0.02
    const walker = walkerPose.current
    walker.visible = afootNow
    walker.indoors = livePlayer.indoors
    if (seated.current) seated.current.visible = !afootNow
    if (afootNow) {
      const perMetre = STRIDE_PER_METRE / (1 + Math.max(0, pace - ON_FOOT.jogFrom) * ON_FOOT.longer)
      walker.stride += pace * delta * perMetre + Math.abs(turned) * SHUFFLE_STRIDE_PER_RADIAN * (shuffle > 0 ? 1 : 0)
      const wanted = Math.max(Math.min(1, pace / ON_FOOT.full), shuffle * ON_FOOT.shuffle)
      walker.walking += (wanted - walker.walking) * (1 - Math.exp(-ON_FOOT.response * delta))
      walker.idle = phone > 0.5 ? IDLE_POSE.phone : IDLE_POSE.still
      // The head (helmet or bare) rides on the standing body: upright, dipping with each step as the hips do.
      const bothDown = (STREET_GAIT.stance - 0.5) / 2
      const dip = -STREET_GAIT.hipDip * (0.5 + 0.5 * Math.cos(4 * Math.PI * (walker.stride / (2 * Math.PI) - bothDown))) * walker.walking
      group.position.set(0, HIP.y, HIP.z)
      group.rotation.set(0, 0, 0)
      group.updateMatrix()
      headRoot.current?.position.set(0, standing.top - ON_FOOT.helmetDown + dip - HIP.y, 0.01)
    } else {
      walker.walking = 0
      headRoot.current?.position.set(size.head.x, size.head.y - hipsUp, size.head.z)
    }

    // Looks where it's going: the head turns back against the torso's lean, so the eyes stay level.
    if (head.current) {
      // The head stays facing the way they're going while the shoulders turn under it.
      head.current.rotation.y = state.steer * 0.3 * (1 - off) + looking - (afootNow ? 0 : twist)
      head.current.rotation.z = state.lean * 0.45 * (1 - off) + FIDGET.tilt * shifted
      head.current.rotation.x = (afootNow ? 0 : -torso + 0.08) - crouch * 0.02 * (1 - off) + FIDGET.nod * phone
    }
  })

  return (
    <>
    {/* On foot: the standing body, its feet on the ground under where the hips are. */}
    <group position={[0, 0, HIP.z]}>
      <Walker body={standing.geometry} pose={walkerPose} colour={roomColour ?? LOOK.jacket} />
    </group>
    <group ref={body} position={HIP} matrixAutoUpdate={false}>
      <group ref={seated}>
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
      </group>

      <group ref={headRoot} position={[size.head.x, size.head.y - hipsUp, size.head.z]}>
      {/* Bare-headed, when the helmet is left off: a head and hair where the helmet would be. */}
      <group visible={!helmetOn}>
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
      <group ref={head} visible={helmetOn}>
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
    </group>
    </>
  )
}
