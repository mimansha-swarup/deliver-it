import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { TitleCamera } from '../camera/TitleCamera'
import { useGameStore } from '../game/gameStore'
import { Handoff } from '../missions/Handoff'
import { MissionMarker } from '../missions/MissionMarker'
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

type PlayerProps = {
  /** The home store first, then the rest across the map. */
  stores: DarkStore[]
  collisions: CollisionWorld
  graph: RoadGraph
  traffic: TrafficWorld
  surface: Surface
  /** Petrol bunks, where the nitro fills. */
  bunks: FuelStation[]
}

export function Player({ stores, collisions, graph, traffic, surface, bunks }: PlayerProps) {
  const started = useGameStore((state) => state.started)
  const scooter = useRef<Group>(null)
  const scooterState = useRef(createScooterState())
  useEffect(() => {
    const { x, z } = scooterState.current
    useGameStore.getState().startMissions(createMissionPlanner(stores, collisions, graph), x, z)
  }, [stores, collisions, graph])

  return (
    <>
      <Scooter ref={scooter} scooterState={scooterState} collisions={collisions} surface={surface} />
      <Headlight scooter={scooterState} />
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
      <Handoff scooter={scooterState} stores={stores} collisions={collisions} />
      <Traffic scooter={scooterState} world={traffic} />
      <TrafficLights world={traffic} />
    </>
  )
}
