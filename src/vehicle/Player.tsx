import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { TitleCamera } from '../camera/TitleCamera'
import { useGameStore } from '../game/gameStore'
import { MissionMarker } from '../missions/MissionMarker'
import { createMissionPlanner } from '../missions/missionPlanner'
import { MissionTracker } from '../missions/MissionTracker'
import type { CollisionWorld } from '../world/collision'
import type { MapData } from '../world/mapData'
import { Scooter } from './Scooter'
import { SkidMarks } from './SkidMarks'
import { createScooterState } from './ScooterController'

export function Player({ data, collisions }: { data: MapData; collisions: CollisionWorld }) {
  const started = useGameStore((state) => state.started)
  const scooter = useRef<Group>(null)
  const scooterState = useRef(createScooterState())
  useEffect(() => {
    const { x, z } = scooterState.current
    useGameStore.getState().startMissions(createMissionPlanner(data, collisions), x, z)
  }, [data, collisions])

  return (
    <>
      <Scooter ref={scooter} scooterState={scooterState} collisions={collisions} />
      <SkidMarks scooter={scooterState} />
      {started ? (
        <FollowCamera scooter={scooterState} collisions={collisions} />
      ) : (
        <TitleCamera />
      )}
      <MissionTracker scooter={scooterState} />
      <MissionMarker />
    </>
  )
}
