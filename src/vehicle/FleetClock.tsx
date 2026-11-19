import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useFleet } from '../game/fleet'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { IDLE_POSE } from '../traffic/gait'
import { TRAFFIC_MODELS_URL, YAMAHA_MODEL_URL } from '../traffic/modelFiles'
import { ShopPeople } from '../world/ShopPeople'
import { getTravelSpeed, type ScooterState } from './ScooterController'
import { createBuiltStill, createModelBody } from './vehicleBodies'
import { VEHICLES, type VehicleId } from './vehicleCatalog'

/*
 * GaadiGo in the world (game/fleet.ts). It drives the fleet's clock (running costs, the rental's
 * time), charges the week's EMIs on each new day, and plays the handover:
 * 1. when the delivery is due, the delivery person rides the vehicle up from behind and stops at
 *    the kerb beside where the rider asked for it; the phone is put down so it's seen;
 * 2. they stand by it until the rider is beside it and stopped, then walk over with the keys;
 * 3. the rider is on the new vehicle, and the delivery person rides the old one away to the Garage.
 */

const TICK = 0.5
/** The ride in: from this far behind, over this long, in metres and seconds; and the ride away. */
const RIDE_IN = { from: 55, time: 5 }
const RIDE_OUT = { reach: 70, time: 7 }
/** The keys: this long from the walk starting to the keys in the rider's hand, in seconds. */
const HANDOVER_TIME = 2.6

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 })
const keyMaterial = new THREE.MeshStandardMaterial({ color: '#d9a93a', roughness: 0.4, metalness: 0.6 })
const riderMaterial = new THREE.MeshStandardMaterial({ color: '#19a974', roughness: 0.85 })
const helmetMaterial = new THREE.MeshStandardMaterial({ color: '#26282c', roughness: 0.5 })

/** Eases in and out. */
const ease = (t: number) => t * t * (3 - 2 * t)
/** Whether someone riding a vehicle is seen on it (two wheels) or is inside it. */
const ridesOpen = (id: VehicleId) => id === 'scooter' || id === 'bicycle' || id === 'ev' || id === 'bike'

export function FleetClock({ scooter }: { scooter: RefObject<ScooterState> }) {
  const delivery = useFleet((state) => state.delivery)
  const leaving = useFleet((state) => state.leaving)
  const day = useGameStore((state) => state.day)
  const since = useRef(0)
  const last = useRef<{ x: number; z: number; crashes: number } | null>(null)
  /** Seconds into the ride in, once it has begun; null before. */
  const rideIn = useRef<number | null>(null)
  const coming = useRef<THREE.Group>(null)
  const comingRider = useRef<THREE.Group>(null)
  const going = useRef<THREE.Group>(null)
  const keys = useRef<THREE.Mesh>(null)

  // A new day: the week's EMIs fall due.
  const dayBefore = useRef(day)
  useEffect(() => {
    if (day !== dayBefore.current) useFleet.getState().newDay(day)
    dayBefore.current = day
  }, [day])
  // A new delivery starts from the beginning.
  useEffect(() => {
    if (!delivery) rideIn.current = null
  }, [delivery])

  useFrame((_, delta) => {
    // The ride in, then standing at the spot.
    if (delivery && coming.current) {
      const due = liveSky.totalHours >= delivery.arrivesAt
      if (due && rideIn.current === null) {
        rideIn.current = 0
        // Put the phone down: the delivery is about to pull up, and it should be seen.
        window.dispatchEvent(new CustomEvent('deliver-it-lower-phone'))
      }
      coming.current.visible = rideIn.current !== null
      if (rideIn.current !== null) {
        rideIn.current = Math.min(RIDE_IN.time, rideIn.current + delta)
        const t = rideIn.current / RIDE_IN.time
        // Fast at first, braking to a stop at the spot.
        const back = RIDE_IN.from * (1 - t) * (1 - t)
        coming.current.position.set(delivery.x - delivery.dirX * back, 0.02, delivery.z - delivery.dirZ * back)
        coming.current.rotation.y = Math.atan2(delivery.dirX, delivery.dirZ)
        if (comingRider.current) comingRider.current.visible = t < 1 && ridesOpen(delivery.id)
        if (t >= 1 && !delivery.here) useFleet.getState().markHere()
      }
      // The keys: carried over by the delivery person, then held out to the rider.
      if (keys.current) {
        const handing = delivery.handing
        keys.current.visible = handing !== null
        if (handing !== null) {
          const t = Math.min(1, (performance.now() - handing) / 1000 / HANDOVER_TIME)
          const k = ease(t)
          const fromX = delivery.x + delivery.dirZ * 1.0
          const fromZ = delivery.z - delivery.dirX * 1.0
          keys.current.position.set(fromX + (livePlayer.x - fromX) * k, 1.05 + Math.sin(k * Math.PI) * 0.25, fromZ + (livePlayer.z - fromZ) * k)
          keys.current.rotation.y += delta * 4
          if (t >= 1) useFleet.getState().completeHandover()
        }
      }
    }
    // The old vehicle, ridden away.
    if (leaving && going.current) {
      const t = (performance.now() - leaving.since) / 1000 / RIDE_OUT.time
      if (t >= 1) useFleet.setState({ leaving: null })
      else {
        // A moment to get on, then away, gathering speed.
        const gone = RIDE_OUT.reach * Math.max(0, t - 0.12) ** 2 / (0.88 * 0.88)
        going.current.position.set(leaving.x + leaving.dirX * gone, 0.02, leaving.z + leaving.dirZ * gone)
        going.current.rotation.y = Math.atan2(leaving.dirX, leaving.dirZ)
      }
    }

    since.current += delta
    if (since.current < TICK || !useGameStore.getState().started) return
    since.current = 0
    const state = scooter.current
    const before = last.current ?? { x: state.x, z: state.z, crashes: state.crashCount }
    last.current = { x: state.x, z: state.z, crashes: state.crashCount }
    // A jump (a debug teleport, a respawn) isn't distance ridden.
    const moved = Math.hypot(state.x - before.x, state.z - before.z)
    useFleet.getState().tick(getTravelSpeed(state), moved < 60 ? moved : 0, Math.max(0, state.crashCount - before.crashes))
  })

  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const { scene: yamaha } = useGLTF(YAMAHA_MODEL_URL)
  /** A vehicle as one still shape, wheels and all. */
  const bodies = useMemo(() => {
    const build = (id: VehicleId) => {
      const spec = VEHICLES[id]
      const paint = spec.paint ?? '#17181b'
      if (spec.body.rig === 'built') return createBuiltStill(spec.body.kind, paint)
      if (spec.body.rig === 'model') return createModelBody(spec.body.file === 'yamaha' ? yamaha : scene, spec.body, paint)
      // The scooter's rig, standing: the same model traffic's parked scooters use.
      return createModelBody(scene, { rig: 'model', file: 'traffic', model: 'delivery', scale: 1, riderSeat: null }, paint)
    }
    return { coming: delivery ? build(delivery.id) : null, going: leaving ? build(leaving.id) : null }
  }, [delivery?.id, leaving?.id, scene, yamaha]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    bodies.coming?.dispose()
    bodies.going?.dispose()
  }, [bodies])

  // The delivery person on foot: standing by the vehicle once it's there, then walking the keys over.
  const person = useMemo(() => {
    if (!delivery || !delivery.here) return { standing: [], walkers: [] }
    const beside: [number, number] = [delivery.x + delivery.dirZ * 1.1, delivery.z - delivery.dirX * 1.1]
    const look = Math.atan2(delivery.dirZ, -delivery.dirX)
    if (delivery.handing === null) return { standing: [{ x: beside[0], z: beside[1], heading: look, body: 0 as const, tint: 0.15, skin: 0.8, idle: IDLE_POSE.phone, phase: 1.1 }], walkers: [] }
    const to: [number, number] = [livePlayer.x - delivery.dirZ * 0.9, livePlayer.z + delivery.dirX * 0.9]
    const distance = Math.hypot(to[0] - beside[0], to[1] - beside[1])
    return { standing: [], walkers: [{ from: beside, to, body: 0 as const, tint: 0.15, skin: 0.8, speed: Math.max(0.8, distance / (HANDOVER_TIME * 0.85)), start: 0, pause: 30 }] }
  }, [delivery])

  /** Someone riding a two-wheeler, simply: a body leaning to the bars and a helmet. */
  const rider = (
    <>
      <mesh material={riderMaterial} position={[0, 1.12, -0.18]} rotation={[0.35, 0, 0]}>
        <boxGeometry args={[0.38, 0.56, 0.26]} />
      </mesh>
      <mesh material={riderMaterial} position={[0, 0.86, 0]}>
        <boxGeometry args={[0.34, 0.16, 0.44]} />
      </mesh>
      <mesh material={helmetMaterial} position={[0, 1.52, -0.04]}>
        <sphereGeometry args={[0.15, 10, 8]} />
      </mesh>
    </>
  )

  return (
    <>
      {delivery && bodies.coming && (
        <>
          <group ref={coming} visible={false}>
            <mesh geometry={bodies.coming} material={material} castShadow />
            <group ref={comingRider}>{rider}</group>
          </group>
          <mesh ref={keys} material={keyMaterial} visible={false}>
            <torusGeometry args={[0.05, 0.014, 6, 12]} />
          </mesh>
          {/* Remounted at each step, so the person is placed afresh though the rider hasn't moved. */}
          <ShopPeople key={`${delivery.here}-${delivery.handing}`} people={person} />
        </>
      )}
      {leaving && bodies.going && (
        <group ref={going}>
          <mesh geometry={bodies.going} material={material} castShadow />
          {ridesOpen(leaving.id) && rider}
        </group>
      )}
    </>
  )
}
