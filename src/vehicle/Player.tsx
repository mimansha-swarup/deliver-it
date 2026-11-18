import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Group } from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { TitleCamera } from '../camera/TitleCamera'
import { useGameStore } from '../game/gameStore'
import { Handoff } from '../missions/Handoff'
import { HomeMarker, MissionMarker } from '../missions/MissionMarker'
import { createMissionPlanner } from '../missions/missionPlanner'
import { MissionTracker } from '../missions/MissionTracker'
import type { CollisionWorld } from '../world/collision'
import type { DarkStore } from '../world/darkStore'
import type { RoadGraph } from '../world/roadGraph'
import type { Surface } from '../world/surface'
import type { FuelStation } from '../world/fuelStationData'
import { Traffic } from '../traffic/Traffic'
import { TrafficLights } from '../traffic/TrafficLights'
import type { TrafficWorld } from '../traffic/trafficLogic'
import { PlayerSounds } from '../audio/PlayerSounds'
import { BunkRefill } from './BunkRefill'
import { Headlight } from './Headlight'
import { Scooter } from './Scooter'
import { SkidMarks } from './SkidMarks'
import { Splashes } from './Splashes'
import { createScooterState } from './ScooterController'
// TEMPORARY: J jumps to the Jagannath temples, in the dev server only.
import { DevTeleport } from '../dev/DevTeleport'
import { placeAt, type Spawn } from '../dev/spawn'

type PlayerProps = {
  /** The home store first, then the rest across the map. */
  stores: DarkStore[]
  collisions: CollisionWorld
  graph: RoadGraph
  traffic: TrafficWorld
  /** Where the rider lives, where sleeping ends the day. */
  home: { x: number; z: number } | null
  surface: Surface
  /** Petrol bunks, where the nitro fills. */
  bunks: FuelStation[]
  /** Debug: a street to start on, from `?spawn=` (see dev/spawn.ts). */
  spawn?: Spawn | null
}

export function Player({ stores, collisions, graph, traffic, surface, bunks, spawn, home }: PlayerProps) {
  const started = useGameStore((state) => state.started)
  const scooter = useRef<Group>(null)
  const scooterState = useRef(createScooterState())
  useEffect(() => {
    if (spawn) placeAt(scooterState.current, spawn)
    const { x, z } = scooterState.current
    useGameStore.getState().startMissions(createMissionPlanner(stores, collisions, graph), x, z)
  }, [stores, collisions, graph, spawn])
  useEffect(() => {
    if (home) useGameStore.getState().setHome(home)
  }, [home])

  return (
    <>
      <Scooter ref={scooter} scooterState={scooterState} collisions={collisions} surface={surface} />
      <Headlight scooter={scooterState} />
      <DevTeleport scooter={scooterState} />
      <PlayerSounds scooter={scooterState} />
      <SkidMarks scooter={scooterState} />
      <Splashes scooter={scooterState} />
      {started ? (
        <FollowCamera scooter={scooterState} collisions={collisions} />
      ) : (
        <TitleCamera />
      )}
      <MissionTracker scooter={scooterState} />
      <BunkRefill scooter={scooterState} stations={bunks} />
      <MissionMarker />
      <HomeMarker />
      <Handoff scooter={scooterState} stores={stores} collisions={collisions} />
      {/* Built once riding has begun, so it doesn't hold up the loading screen. */}
      <AfterRideStarts>
        <Traffic scooter={scooterState} world={traffic} />
      </AfterRideStarts>
      <TrafficLights world={traffic} />
    </>
  )
}

/** Waits this long after the ride starts, so the loading screen has faded before traffic is built, in milliseconds. */
const TRAFFIC_DELAY = 600

/** Shows its children only once the ride has started, a moment after. */
function AfterRideStarts({ children }: { children: ReactNode }) {
  const started = useGameStore((state) => state.started)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => setReady(true), TRAFFIC_DELAY)
    return () => clearTimeout(timer)
  }, [started])
  return ready ? children : null
}
