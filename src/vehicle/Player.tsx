import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { createCollisionWorld } from '../world/collision'
import type { PolygonFeature } from '../world/mapData'
import { Scooter } from './Scooter'

export function Player({ buildings }: { buildings: PolygonFeature[] }) {
  const scooter = useRef<Group>(null)
  const collisions = useMemo(() => createCollisionWorld(buildings), [buildings])

  return (
    <>
      <Scooter ref={scooter} collisions={collisions} />
      <FollowCamera target={scooter} collisions={collisions} />
    </>
  )
}
