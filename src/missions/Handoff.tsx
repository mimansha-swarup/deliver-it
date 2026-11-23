import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { playPing } from '../audio/uiSounds'
import { isDebug } from '../dev/spawn'
import { sayLine } from '../audio/voiceCues'
import { useGLTF } from '@react-three/drei'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import type { MissionPhase, WaitingCustomer } from '../game/gameTypes'
import { liveShot } from '../game/livePlayer'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { STRIDE_PER_METRE } from '../traffic/gait'
import { createWomanFrom } from '../traffic/peopleShapes'
import { People } from '../traffic/Traffic'
import { createPerson } from '../traffic/person'
import type { Pedestrian } from '../traffic/trafficLogic'
import { isAfoot, type ScooterState } from '../vehicle/ScooterController'
import { liveRoom } from '../game/rooms'
import { errandLive } from '../game/doorsteps'
import { PAVEMENT_HEIGHT } from '../world/surface'
import { ROOM_SPOTS } from '../world/roomShapes'
import { createPrintTexture, SHIRT_COLOR } from '../vehicle/shirtPrint'
import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { DarkStore } from '../world/darkStore'
import { box, merge } from '../world/simpleShapes'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('missions and markers')

/** Seconds for each step of a handover. */
const TIMES = {
  lift: 0.45,
  flight: 0.8,
  /** The customer's moment of joy, before the reward shows. */
  joy: 1.1,
  /** Staff pass the parcel over, and it drops into the box. */
  pass: 0.6,
  sink: 0.25,
}

const WALK_SPEED = 2.4
const STROLL_SPEED = 1.4
const LONGEST_WALK = 2.2
/** How far from the box people stop, in metres. Far enough to see the parcel cross the gap. */
const STAND_OFF = 1.5
const TURN_RESPONSE = 7

/** Where a parcel sits on the bike and in someone's arms. */
const BOX_BACK = 0.74
const BOX_TOP = 1.28
const LIFT_HEIGHT = 0.42
const HANDS_FORWARD = 0.36
const HANDS_HEIGHT = 1.02
const ARC_HEIGHT = 0.75
const SPIN = 5

const HOP_RATE = 11
const HOP_HEIGHT = 0.16

/** A customer starts watching the rider from this far, in metres. */
const WATCH_RANGE = 40

const SHOT_DISTANCE = 4.6
const SHOT_DRIFT = 0.07
const SHOT_CLEARANCE = 0.5

const CONFETTI_COUNT = 34
const CONFETTI_COLORS = ['#3ddc97', '#ffb02e', '#ffffff', '#4aa8ff', '#ff6b5e']
const CONFETTI_GRAVITY = 4.2
const CONFETTI_LIFE = 1.5

const STAFF_SKIN = 0.85
const STAFF_CLOTHES = [SHIRT_COLOR]

/** The shirt's print, fitted to the staff model's back, in metres. */
const PRINT_Y = 1.27
const PRINT_HEIGHT = 0.2
/** Nearly flat, as this model's back is. */
const PRINT_WRAP = 0.27
const PRINT_RADIUS = 1.2
/** The model stands with a twist, so its back faces a little to one side, as measured. */
const PRINT_TURN = -0.35
const PRINT_X = 0
const PRINT_Z = -0.152
/** The print shows within this distance, in metres, and only from behind. */
const PRINT_RANGE = 30
const PRINT_MIN_FACING = 0.3

const HIDDEN_LIFT = -50

function turnTowards(person: Pedestrian, heading: number, dt: number) {
  const turn = Math.atan2(Math.sin(heading - person.heading), Math.cos(heading - person.heading))
  person.heading += turn * (1 - Math.exp(-TURN_RESPONSE * dt))
}

/** Moves a person towards a spot, and says when they've got there. */
function walkTo(person: Pedestrian, x: number, z: number, speed: number, dt: number): boolean {
  const awayX = x - person.x
  const awayZ = z - person.z
  const distance = Math.hypot(awayX, awayZ)

  if (distance < 0.05) {
    person.walking = 0
    return true
  }

  const step = Math.min(distance, speed * dt)
  person.x += (awayX / distance) * step
  person.z += (awayZ / distance) * step
  person.stride += step * STRIDE_PER_METRE
  person.walking = 1
  turnTowards(person, Math.atan2(awayX, awayZ), dt)
  return false
}

/** Puts a new customer on their spot. */
/** Whoever of these people is nearest a spot. */
function nearestTo(people: Pedestrian[], x: number, z: number): Pedestrian {
  let nearest = people[0]
  for (const person of people) {
    if (Math.hypot(person.x - x, person.z - z) < Math.hypot(nearest.x - x, nearest.z - z)) nearest = person
  }
  return nearest
}

/** A customer starts waving when the rider is this close, in metres, raising their arm at this rate. */
const WAVE_RANGE = 35
const WAVE_RESPONSE = 5

/** Raises or lowers a waving arm smoothly. */
function easeWave(person: Pedestrian, target: number, dt: number) {
  const wave = person.wave ?? 0
  person.wave = wave + (target - wave) * (1 - Math.exp(-WAVE_RESPONSE * dt))
}

function placeCustomer(person: Pedestrian, { x, z, rotation, tint }: WaitingCustomer, upstairs = false) {
  // On a floor of its own (a corridor), the footpath's height doesn't apply: `lift` alone places them.
  person.deck = upstairs ? 1 : undefined
  person.x = x
  person.z = z
  person.heading = rotation
  person.tint = tint
}

function setLift(person: Pedestrian, lift: number) {
  person.lift = lift
}

/** Shifting on their feet, as anyone waiting for a parcel does. */
function fidget(person: Pedestrian, time: number) {
  // A hint of a step, coming and going: their weight shifting from foot to foot.
  person.stride = Math.PI / 2
  person.walking = 0.12 + Math.sin(time * 1.4) * 0.1
}

function createParcelGeometry(): THREE.BufferGeometry {
  return merge([
    box([0.36, 0.24, 0.3], [0, 0, 0], '#b98a55'),
    box([0.37, 0.245, 0.05], [0, 0, 0], '#d9cdb4'),
    box([0.13, 0.01, 0.1], [0.08, 0.122, 0.08], '#f4f1e8'),
  ])
}

type Confetti = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number }

function burstConfetti(pieces: Confetti[], x: number, y: number, z: number) {
  for (const piece of pieces) {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.8 + Math.random() * 1.6
    piece.x = x
    piece.y = y
    piece.z = z
    piece.vx = Math.cos(angle) * speed
    piece.vy = 2.4 + Math.random() * 1.8
    piece.vz = Math.sin(angle) * speed
    piece.spin = Math.random() * 6
  }
}

const place = new THREE.Object3D()

function stepConfetti(mesh: THREE.InstancedMesh, pieces: Confetti[], age: number, dt: number) {
  const size = age < CONFETTI_LIFE ? 1 : 0

  pieces.forEach((piece, index) => {
    piece.vy -= CONFETTI_GRAVITY * dt
    piece.vx *= Math.exp(-1.2 * dt)
    piece.vz *= Math.exp(-1.2 * dt)
    piece.x += piece.vx * dt
    piece.y = Math.max(0.03, piece.y + piece.vy * dt)
    piece.z += piece.vz * dt

    place.position.set(piece.x, piece.y, piece.z)
    place.rotation.set(age * piece.spin, age * piece.spin * 0.7, 0)
    place.scale.setScalar(size)
    place.updateMatrix()
    mesh.setMatrixAt(index, place.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
}

/** Finds a side-on view of the rider and a spot, on whichever side has room for a camera. */
function setShot(
  from: { x: number; z: number },
  [spotX, spotZ]: [number, number],
  collisions: CollisionWorld,
) {
  const lookX = (from.x + spotX) / 2
  const lookZ = (from.z + spotZ) / 2
  const awayX = spotX - from.x
  const awayZ = spotZ - from.z
  const length = Math.hypot(awayX, awayZ) || 1

  for (const side of [1, -1]) {
    const cameraX = lookX + (awayZ / length) * side * SHOT_DISTANCE
    const cameraZ = lookZ - (awayX / length) * side * SHOT_DISTANCE
    // In a room the camera is kept inside its walls anyway (FollowCamera.tsx).
    const isClear = liveRoom.kind !== null || !isNearBuilding(collisions, cameraX, cameraZ, SHOT_CLEARANCE)
    if (isClear || side === -1) {
      liveShot.cameraX = cameraX
      liveShot.cameraZ = cameraZ
    }
    if (isClear) break
  }

  liveShot.lookX = lookX
  liveShot.lookZ = lookZ
  liveShot.active = true
}

/** A slow drift, which keeps the shot alive while it's held. */
function driftShot(dt: number) {
  const offsetX = liveShot.cameraX - liveShot.lookX
  const offsetZ = liveShot.cameraZ - liveShot.lookZ
  const turn = SHOT_DRIFT * dt
  liveShot.cameraX = liveShot.lookX + offsetX * Math.cos(turn) - offsetZ * Math.sin(turn)
  liveShot.cameraZ = liveShot.lookZ + offsetX * Math.sin(turn) + offsetZ * Math.cos(turn)
}

function pickBody(bodies: THREE.BufferGeometry[], look: number) {
  return bodies[Math.floor(look * bodies.length * 0.999)]
}

/** Where a person should stop beside the box (or the rider holding the parcel), from the side they came from. */
function getStandingSpot(boxX: number, boxZ: number, person: Pedestrian): [number, number] {
  const awayX = person.x - boxX
  const awayZ = person.z - boxZ
  const length = Math.hypot(awayX, awayZ) || 1
  return [boxX + (awayX / length) * STAND_OFF, boxZ + (awayZ / length) * STAND_OFF]
}

const HELD = { forward: 0.34, height: 1.06 }
/** How long a customer is inside trying something on, in seconds, and what they say going in. */
const TRY_ON_SECONDS = 3.8

/** Where the parcel is before it's handed over: on top of the vehicle's box, or held in front of the rider on foot. */
function carrier(state: ScooterState): { x: number; y: number; z: number } {
  if (isAfoot(state)) {
    const { rider } = state
    return { x: rider.x + Math.sin(rider.heading) * HELD.forward, y: rider.ground + HELD.height, z: rider.z + Math.cos(rider.heading) * HELD.forward }
  }
  return { x: state.x - Math.sin(state.heading) * BOX_BACK, y: BOX_TOP, z: state.z - Math.cos(state.heading) * BOX_BACK }
}

/**
 * Stages both ends of a delivery. At the dark store, staff walk out and put the
 * parcel in the box. At the customer's, they walk up, the parcel flies to them,
 * and they celebrate. It's all a show, so the bike just waits and the mission
 * only moves on when `finishHandoff` is called at the end.
 */
export function Handoff({
  scooter,
  stores,
  collisions,
}: {
  scooter: RefObject<ScooterState>
  /** One staff member waits at each. */
  stores: DarkStore[]
  collisions: CollisionWorld
}) {
  const mission = useGameStore((state) => state.mission)
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  // Two women, made from the modelled man in a kurta (peopleShapes.ts): they need freeing, the loaded models don't.
  const women = useMemo(() => [createWomanFrom(getModel(scene, 'man'), 'elder'), createWomanFrom(getModel(scene, 'man'), 'young')], [scene])
  const bodies = useMemo(
    () => [getModel(scene, 'man'), getModel(scene, 'teen'), ...women],
    [scene, women],
  )
  const parcelGeometry = useMemo(() => createParcelGeometry(), [])
  const printTexture = useMemo(() => createPrintTexture(), [])

  useEffect(
    () => () => {
      women.forEach((woman) => woman.dispose())
      parcelGeometry.dispose()
      printTexture.dispose()
    },
    [women, parcelGeometry, printTexture],
  )

  const customers = useMemo(() => [createPerson(0, 0, 0, 0.5, 1)], [])
  // Debug: the customer, to put a camera on them from the console.
  if (isDebug()) Object.assign(window, { __deliverItCustomer: customers[0] })
  const staff = useMemo(
    () => stores.map((store) => createPerson(store.staffX, store.staffZ, store.rotation, 0, STAFF_SKIN)),
    [stores],
  )
  const confetti = useMemo(
    () =>
      Array.from(
        { length: CONFETTI_COUNT },
        (): Confetti => ({ x: 0, y: -5, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 }),
      ),
    [],
  )

  const parcel = useRef<THREE.Mesh>(null)
  const staffPrint = useRef<THREE.Group>(null)
  const confettiMesh = useRef<THREE.InstancedMesh>(null)

  const shownPhase = useRef<MissionPhase>('toPickup')
  const shownWaiting = useRef<WaitingCustomer | null>(null)
  const shownAt = useRef<typeof errandLive.customerAt>(null)
  const saidTrying = useRef(0)
  const confettiDone = useRef(0)
  const phaseTime = useRef(0)
  const arrivedAt = useRef<number | null>(null)
  const confettiAge = useRef(Infinity)
  const idleTime = useRef(0)

  useEffect(() => {
    const mesh = confettiMesh.current
    if (!mesh) return

    const color = new THREE.Color()
    for (let index = 0; index < CONFETTI_COUNT; index++) {
      mesh.setColorAt(index, color.set(CONFETTI_COLORS[index % CONFETTI_COLORS.length]))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.05)
    const game = useGameStore.getState()
    const state = scooter.current
    // The order's own store hands it over. The print goes on whichever staff member is nearest the camera.
    const pickupNode = game.mission?.pickup.node
    const active = Math.max(0, stores.findIndex(({ node }) => node === pickupNode))
    const staffMember = staff[active]
    const shownStaff = nearestTo(staff, camera.position.x, camera.position.z)
    const customer = customers[0]
    const parcelMesh = parcel.current

    // A new order means a new person waiting somewhere else: at the order's own spot (a gate, a front
    // door, the kerb), or where the errand has put them (outside their flat, upstairs).
    const waiting = game.mission?.waiting ?? null
    const moved = errandLive.customerAt
    if (waiting !== shownWaiting.current || moved !== shownAt.current) {
      shownWaiting.current = waiting
      shownAt.current = moved
      // Upstairs they stand on that floor, not on the street's footpath.
      if (waiting) placeCustomer(customer, moved ? { ...waiting, x: moved.x, z: moved.z, rotation: moved.rotation } : waiting, moved?.floorY != null)
    }
    const home = moved ?? waiting
    const floor = moved?.floorY != null ? moved.floorY - PAVEMENT_HEIGHT : 0
    const scene = errandLive.scene

    if (game.phase !== shownPhase.current) {
      shownPhase.current = game.phase
      phaseTime.current = 0
      arrivedAt.current = null
      if (game.phase === 'handingOver') setShot(carrier(state), getStandingSpot(carrier(state).x, carrier(state).z, customer), collisions)
      // The shot of the two of them is held under the result card, and let go when it closes.
      else if (!game.lastReward) liveShot.active = false
    }
    if (liveShot.active && game.phase !== 'handingOver' && !game.lastReward) liveShot.active = false
    phaseTime.current += dt
    idleTime.current += dt

    // The parcel starts from the box on the vehicle, or from the rider's hands when they've walked it over.
    const { x: boxX, z: boxZ, y: boxY } = carrier(state)

    const handsOf = (person: Pedestrian) =>
      new THREE.Vector3(
        person.x + Math.sin(person.heading) * HANDS_FORWARD,
        HANDS_HEIGHT + person.lift,
        person.z + Math.cos(person.heading) * HANDS_FORWARD,
      )
    const boxTop = new THREE.Vector3(boxX, boxY, boxZ)
    let parcelAt: THREE.Vector3 | null = null
    let parcelScale = 1
    let parcelSpin = 0

    // --- At the dark store ---
    if (game.phase === 'collecting') {
      const [spotX, spotZ] = getStandingSpot(boxX, boxZ, staffMember)
      const away = Math.hypot(spotX - staffMember.x, spotZ - staffMember.z)
      const arrived = walkTo(staffMember, spotX, spotZ, Math.max(WALK_SPEED, away / LONGEST_WALK), dt)
      if (arrived) {
        arrivedAt.current ??= phaseTime.current
        turnTowards(staffMember, Math.atan2(boxX - staffMember.x, boxZ - staffMember.z), dt)
      }

      const since = arrivedAt.current === null ? -1 : phaseTime.current - arrivedAt.current
      if (since < 0) parcelAt = handsOf(staffMember)
      else if (since < TIMES.pass) {
        const progress = since / TIMES.pass
        parcelAt = handsOf(staffMember).lerp(boxTop, progress)
        parcelAt.y += Math.sin(progress * Math.PI) * ARC_HEIGHT * 0.5
      } else if (since < TIMES.pass + TIMES.sink) {
        parcelAt = boxTop
        parcelScale = 1 - (since - TIMES.pass) / TIMES.sink
      } else {
        game.finishHandoff()
      }
    }
    staff.forEach((member, index) => {
      if (index === active && game.phase === 'collecting') return
      const store = stores[index]
      const atPost = walkTo(member, store.staffX, store.staffZ, STROLL_SPEED, dt)
      if (atPost) {
        const riderHeading = Math.atan2(state.x - member.x, state.z - member.z)
        const nearby = Math.hypot(state.x - member.x, state.z - member.z) < WATCH_RANGE
        turnTowards(member, nearby ? riderHeading : store.rotation, dt)
      }
    })

    // --- At the customer's ---
    // Seen once they've come to the door (the bell, Errand.tsx); never, when they asked for it to be left outside.
    const waitingForRider = game.phase === 'toCustomer'
    const onShow = (waitingForRider || game.phase === 'handingOver' || game.phase === 'delivered') && errandLive.customerOut && scene !== 'outside'
    setLift(customer, onShow ? floor : HIDDEN_LIFT)

    // Waving: as the rider comes near, and while the parcel reaches them, then not on the way home.
    const riderDistance = Math.hypot(state.x - customer.x, state.z - customer.z)
    const waveTarget =
      (waitingForRider && riderDistance < WAVE_RANGE) || game.phase === 'handingOver' ? 1 : 0
    easeWave(customer, waveTarget, dt)

    if (waitingForRider) {
      fidget(customer, idleTime.current)
      const nearby = riderDistance < WATCH_RANGE
      const heading = Math.atan2(state.x - customer.x, state.z - customer.z)
      if (nearby && waiting) turnTowards(customer, heading, dt)
    }

    if (game.phase === 'handingOver' && scene === 'outside' && home) {
      // "Keep it outside": the parcel is set down at the door, and that's that.
      const since = phaseTime.current
      const down = new THREE.Vector3(home.x, floor + PAVEMENT_HEIGHT + 0.14, home.z)
      if (since < TIMES.lift + TIMES.flight) {
        const progress = since / (TIMES.lift + TIMES.flight)
        const eased = progress * progress * (3 - 2 * progress)
        parcelAt = boxTop.clone().lerp(down, eased)
        parcelAt.y += Math.sin(progress * Math.PI) * 0.25
      } else {
        parcelAt = down
        if (since >= TIMES.lift + TIMES.flight + 0.9) game.finishHandoff()
      }
    } else if (game.phase === 'handingOver') {
      const [spotX, spotZ] = getStandingSpot(boxX, boxZ, customer)
      const distance = Math.hypot(spotX - customer.x, spotZ - customer.z)
      const speed = Math.max(WALK_SPEED, distance / LONGEST_WALK)
      const arrived = arrivedAt.current !== null || walkTo(customer, spotX, spotZ, speed, dt)

      if (arrived) {
        arrivedAt.current ??= phaseTime.current
        turnTowards(customer, Math.atan2(boxX - customer.x, boxZ - customer.z), dt)
        driftShot(dt)

        const since = phaseTime.current - arrivedAt.current
        const hands = handsOf(customer)
        const raised = boxTop.clone().setY(boxY + LIFT_HEIGHT)

        if (since < TIMES.lift) {
          const progress = since / TIMES.lift
          parcelAt = boxTop.clone().lerp(raised, progress)
          parcelScale = Math.min(1, progress * 2)
        } else if (since < TIMES.lift + TIMES.flight) {
          const progress = (since - TIMES.lift) / TIMES.flight
          const eased = progress * progress * (3 - 2 * progress)
          parcelAt = raised.clone().lerp(hands, eased)
          parcelAt.y += Math.sin(progress * Math.PI) * ARC_HEIGHT
          parcelSpin = (1 - eased) * SPIN
        } else {
          parcelAt = hands
          // "Wait, trying them on": they take it inside for a moment before the verdict.
          const trying = scene === 'tryOn' ? TRY_ON_SECONDS : 0
          const joy = since - TIMES.lift - TIMES.flight - trying
          if (joy < 0) {
            if (saidTrying.current !== game.missionNumber && joy > -trying + 0.3) {
              saidTrying.current = game.missionNumber
              sayLine('cust.tryon', game.mission?.story.customer ?? 'Customer')
              window.setTimeout(() => sayLine('cust.fits', game.mission?.story.customer ?? 'Customer'), (trying - 0.4) * 1000)
            }
            // Gone in to try it; back out by the end.
            if (joy > -trying + 0.5 && joy < -0.45) {
              setLift(customer, HIDDEN_LIFT)
              parcelAt = null
            }
          } else {
            if (confettiAge.current === Infinity && confettiDone.current !== game.missionNumber) {
              confettiDone.current = game.missionNumber
              // Confetti is for a delivery worth it: three stars or more. Under that, a quiet "delivered" and no more.
              if ((game.pendingReward?.stars ?? 5) >= 3) {
                confettiAge.current = 0
                burstConfetti(confetti, hands.x, hands.y + 0.3, hands.z)
              } else playPing('delivered')
            }
            setLift(customer, floor + Math.abs(Math.sin(joy * HOP_RATE)) * HOP_HEIGHT)
            if (joy >= TIMES.joy) game.finishHandoff()
          }
        }
      }
    }

    // Waiting on the dark store's counter, until it's picked up.
    if (game.phase === 'toPickup' && game.mission && liveRoom.kind === 'store') {
      const { bag } = ROOM_SPOTS.store
      parcelAt = new THREE.Vector3(liveRoom.x + bag.x, liveRoom.floorY + bag.y + 0.12, liveRoom.z + bag.z)
    }
    // Carried in the rider's hands while they walk it from the counter, and on to the door.
    if (game.phase === 'toCustomer' && isAfoot(state)) parcelAt = boxTop

    if (game.phase === 'delivered' && home) {
      if (scene === 'outside') parcelAt = new THREE.Vector3(home.x, floor + PAVEMENT_HEIGHT + 0.14, home.z)
      else {
        // Back home, with their parcel.
        setLift(customer, floor)
        const back = walkTo(customer, home.x, home.z, STROLL_SPEED, dt)
        if (!back) parcelAt = handsOf(customer)
      }
    }

    if (parcelMesh) {
      parcelMesh.visible = parcelAt !== null
      if (parcelAt) {
        parcelMesh.position.copy(parcelAt)
        parcelMesh.scale.setScalar(Math.max(0.001, parcelScale))
        parcelMesh.rotation.set(0, customer.heading + phaseTime.current * parcelSpin, 0)
      }
    }

    // Staff are drawn by the crowd shader, so their print follows them by hand. It's drawn
    // over the shirt, so it only shows when their back is towards the camera and they're close.
    if (staffPrint.current) {
      staffPrint.current.position.set(shownStaff.x, PRINT_Y + shownStaff.lift, shownStaff.z)
      staffPrint.current.rotation.y = shownStaff.heading

      const toCameraX = camera.position.x - shownStaff.x
      const toCameraZ = camera.position.z - shownStaff.z
      const distance = Math.hypot(toCameraX, toCameraZ)
      const backHeading = shownStaff.heading + PRINT_TURN + Math.PI
      const facing =
        (Math.sin(backHeading) * toCameraX + Math.cos(backHeading) * toCameraZ) / distance
      staffPrint.current.visible = distance < PRINT_RANGE && facing > PRINT_MIN_FACING
    }

    if (confettiMesh.current && confettiAge.current !== Infinity) {
      confettiAge.current += dt
      stepConfetti(confettiMesh.current, confetti, confettiAge.current, dt)
      if (confettiAge.current > CONFETTI_LIFE) confettiAge.current = Infinity
    }
  })

  const look = mission?.waiting.look ?? 0

  return (
    <>
      <People key={pickBody(bodies, look).uuid} items={customers} body={pickBody(bodies, look)} />
      <People items={staff} body={bodies[1]} palette={STAFF_CLOTHES} />
      <group ref={staffPrint}>
        <group position={[PRINT_X, 0, PRINT_Z]} rotation={[0, PRINT_TURN, 0]}>
          <mesh position={[0, 0, PRINT_RADIUS]}>
            <cylinderGeometry
              args={[
                PRINT_RADIUS,
                PRINT_RADIUS,
                PRINT_HEIGHT,
                10,
                1,
                true,
                Math.PI - PRINT_WRAP / 2,
                PRINT_WRAP,
              ]}
            />
            <meshStandardMaterial
              map={printTexture}
              transparent
              roughness={0.8}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        </group>
      </group>

      <mesh ref={parcel} geometry={parcelGeometry} visible={false} castShadow>
        <meshStandardMaterial vertexColors roughness={0.75} />
      </mesh>

      <instancedMesh ref={confettiMesh} args={[undefined, undefined, CONFETTI_COUNT]} frustumCulled={false}>
        <planeGeometry args={[0.09, 0.14]} />
        <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
      </instancedMesh>
    </>
  )
}
