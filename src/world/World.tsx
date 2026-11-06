import { use, useMemo } from 'react'
import { Player } from '../vehicle/Player'
import { Boundary } from './Boundary'
import { Buildings } from './Buildings'
import { createCollisionWorld } from './collision'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { loadMapData } from './mapData'
import { generateRoadsideProps } from './props'
import { RoadMarkings } from './RoadMarkings'
import { Roads } from './Roads'
import { RoadsideProps } from './RoadsideProps'

export function World() {
  const data = use(loadMapData())

  // Trees and lamps are solid, so they're added to the collision world as they're placed.
  const { collisions, props } = useMemo(() => {
    const collisions = createCollisionWorld(data.buildings)
    return { collisions, props: generateRoadsideProps(data.roads, collisions) }
  }, [data])

  return (
    <>
      <Lighting />
      <Ground />
      <Roads roads={data.roads} />
      <RoadMarkings roads={data.roads} />
      <Buildings buildings={data.buildings} />
      <RoadsideProps props={props} />
      <Boundary />
      <Player data={data} collisions={collisions} />
    </>
  )
}
