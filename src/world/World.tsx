import { use, useMemo } from 'react'
import { createTrafficWorld } from '../traffic/trafficLogic'
import { Player } from '../vehicle/Player'
import { Boundary } from './Boundary'
import { Buildings } from './Buildings'
import { createCollisionWorld } from './collision'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { loadMapData } from './mapData'
import { generateRoadsideProps } from './props'
import { RoadMarkings } from './RoadMarkings'
import { createRoadGraph } from './roadGraph'
import { Roads } from './Roads'
import { RoadsideProps } from './RoadsideProps'
import { ShopFronts } from './ShopFronts'
import { generateShopFronts } from './shopFrontPlacement'

export function World() {
  const data = use(loadMapData())

  // Trees and lamps are solid, so they're added to the collision world as they're placed.
  // Awnings go first, while the collision world holds nothing but buildings.
  const { collisions, props, shopFronts, graph, traffic } = useMemo(() => {
    const collisions = createCollisionWorld(data.buildings)
    const shopFronts = generateShopFronts(data.places, collisions)
    const props = generateRoadsideProps(data.roads, collisions)
    const graph = createRoadGraph(data.roads)
    return { collisions, props, shopFronts, graph, traffic: createTrafficWorld(graph, collisions) }
  }, [data])

  return (
    <>
      <Lighting />
      <Ground />
      <Roads roads={data.roads} />
      <RoadMarkings roads={data.roads} />
      <Buildings buildings={data.buildings} />
      <RoadsideProps props={props} />
      <ShopFronts shopFronts={shopFronts} />
      <Boundary />
      <Player data={data} collisions={collisions} graph={graph} traffic={traffic} />
    </>
  )
}
