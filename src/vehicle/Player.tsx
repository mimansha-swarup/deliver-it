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
import { Traffic } from '../traffic/Traffic'
import { TrafficLights } from '../traffic/TrafficLights'
import type { TrafficWorld } from '../traffic/trafficLogic'
import { PlayerSounds } from '../audio/PlayerSounds'
import { Headlight } from './Headlight'
import { Scooter } from './Scooter'
import { SkidMarks } from './SkidMarks'
import { createScooterState } from './ScooterController'

type PlayerProps = {
  store: DarkStore
  collisions: CollisionWorld
  graph: RoadGraph
  traffic: TrafficWorld
  surface: Surface
}

export function Player({ store, collisions, graph, traffic, surface }: PlayerProps) {
  const started = useGameStore((state) => state.started)
  const scooter = useRef<Group>(null)
  const scooterState = useRef(createScooterState())
  useEffect(() => {
    const { x, z } = scooterState.current
    useGameStore.getState().startMissions(createMissionPlanner(store, collisions, graph), x, z)
  }, [store, collisions, graph])

  return (
    <>
      <Scooter ref={scooter} scooterState={scooterState} collisions={collisions} surface={surface} />
      <Headlight scooter={scooterState} />
      <PlayerSounds scooter={scooterState} />
      <SkidMarks scooter={scooterState} />
      {started ? (
        <FollowCamera scooter={scooterState} collisions={collisions} />
      ) : (
        <TitleCamera />
      )}
      <MissionTracker scooter={scooterState} />
      <MissionMarker />
      <Handoff scooter={scooterState} store={store} collisions={collisions} />
      <Traffic scooter={scooterState} world={traffic} />
      <TrafficLights world={traffic} />
    </>
  )
}
