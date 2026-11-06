import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { useGameStore } from '../game/gameStore'
import { MissionMarker } from '../missions/MissionMarker'
import { createMissionPlanner } from '../missions/missionPlanner'
import { MissionTracker } from '../missions/MissionTracker'
import { createCollisionWorld } from '../world/collision'
import type { MapData } from '../world/mapData'
import { Scooter } from './Scooter'
import { SkidMarks } from './SkidMarks'
import { createScooterState } from './ScooterController'

export function Player({ data }: { data: MapData }) {
  const scooter = useRef<Group>(null)
  const scooterState = useRef(createScooterState())
  const collisions = useMemo(() => createCollisionWorld(data.buildings), [data])

  useEffect(() => {
    const { x, z } = scooterState.current
    useGameStore.getState().startMissions(createMissionPlanner(data, collisions), x, z)
  }, [data, collisions])

  return (
    <>
      <Scooter ref={scooter} scooterState={scooterState} collisions={collisions} />
      <SkidMarks scooter={scooterState} />
      <FollowCamera scooter={scooterState} collisions={collisions} />
      <MissionTracker scooter={scooterState} />
      <MissionMarker />
    </>
  )
}
