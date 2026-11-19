import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useFleet } from '../game/fleet'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { IDLE_POSE } from '../traffic/gait'
import { TRAFFIC_MODELS_URL, YAMAHA_MODEL_URL } from '../traffic/modelFiles'
import { ShopPeople } from '../world/ShopPeople'
import { getTravelSpeed, type ScooterState } from './ScooterController'
import { createBuiltStill, createModelBody } from './vehicleBodies'
import { VEHICLES } from './vehicleCatalog'

/*
 * GaadiGo in the world (game/fleet.ts): drives the fleet's clock (running costs, the rental's
 * time, handovers), charges the week's EMIs on each new day, and draws a delivery once it has
 * arrived: the vehicle standing where the rider asked for it, the delivery person beside it.
 */

const TICK = 0.5
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 })

export function FleetClock({ scooter }: { scooter: RefObject<ScooterState> }) {
  const delivery = useFleet((state) => state.delivery)
  const day = useGameStore((state) => state.day)
  const since = useRef(0)
  const last = useRef<{ x: number; z: number; crashes: number } | null>(null)
  const arrived = useRef(false)
  const waiting = useRef<THREE.Group>(null)

  // A new day: the week's EMIs fall due.
  const dayBefore = useRef(day)
  useEffect(() => {
    if (day !== dayBefore.current) useFleet.getState().newDay(day)
    dayBefore.current = day
  }, [day])

  useFrame((_, delta) => {
    if (waiting.current) {
      const here = delivery !== null && liveSky.totalHours >= delivery.arrivesAt
      if (here !== arrived.current) {
        arrived.current = here
        waiting.current.visible = here
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
  const body = useMemo(() => {
    if (!delivery) return null
    const spec = VEHICLES[delivery.id]
    const paint = spec.paint ?? '#17181b'
    if (spec.body.rig === 'built') return createBuiltStill(spec.body.kind, paint)
    if (spec.body.rig === 'model') return createModelBody(spec.body.file === 'yamaha' ? yamaha : scene, spec.body, paint)
    // The scooter's rig, standing: the same model traffic's parked scooters use.
    return createModelBody(scene, { rig: 'model', file: 'traffic', model: 'delivery', scale: 1, riderSeat: null }, paint)
  }, [delivery, scene, yamaha])
  useEffect(() => () => body?.dispose(), [body])
  // The delivery person, beside the vehicle, phone in hand.
  const person = useMemo(
    () => ({ standing: delivery ? [{ x: delivery.x + 1.6, z: delivery.z + 0.4, heading: -Math.PI / 2, body: 0 as const, tint: 0.15, skin: 0.8, idle: IDLE_POSE.phone, phase: 1.1 }] : [], walkers: [] }),
    [delivery],
  )

  if (!delivery || !body) return null
  return (
    <group ref={waiting} visible={false}>
      <mesh geometry={body} material={material} position={[delivery.x, 0.02, delivery.z]} castShadow />
      <ShopPeople people={person} />
    </group>
  )
}
