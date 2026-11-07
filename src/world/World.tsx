import { use, useMemo } from 'react'
import { Sky } from '../sky/Sky'
import { createCrashPhysics } from '../physics/crashPhysics'
import { loadRapier } from '../physics/rapier'
import { createTrafficWorld } from '../traffic/trafficLogic'
import { Player } from '../vehicle/Player'
import { Boundary } from './Boundary'
import { Buildings } from './Buildings'
import { Cables } from './Cables'
import { createCollisionWorld } from './collision'
import { GrassField } from './GrassField'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { loadMapData } from './mapData'
import { plantParks } from './parkPlanting'
import { Parks } from './Parks'
import { generateRoadsideProps } from './props'
import { generateRoofTanks } from './roofTanks'
import { RoadMarkings } from './RoadMarkings'
import { createRoadGraph } from './roadGraph'
import { Roads } from './Roads'
import { RoadsideProps } from './RoadsideProps'
import { ShopFronts } from './ShopFronts'
import { generateShopFronts } from './shopFrontPlacement'

export function World() {
  const data = use(loadMapData())
  const rapier = use(loadRapier())

  // Trees and lamps are solid, so they're added to the collision world as they're placed.
  // Awnings go first, while the collision world holds nothing but buildings.
  const { collisions, props, shopFronts, graph, traffic, tanks, benches } = useMemo(() => {
    const collisions = createCollisionWorld(data.buildings)
    const shopFronts = generateShopFronts(data.places, collisions)
    const props = generateRoadsideProps(data.roads, collisions, shopFronts)
    const benches = plantParks(data, collisions, props)
    const graph = createRoadGraph(data.roads)
    const physics = createCrashPhysics(rapier, collisions)
    const traffic = createTrafficWorld(graph, collisions, props.parkedScooters, physics)
    const tanks = generateRoofTanks(data.buildings)
    return { collisions, props, shopFronts, graph, traffic, tanks, benches }
  }, [data, rapier])

  return (
    <>
      <Sky />
      <Lighting />
      <Ground />
      <Parks data={data} />
      <GrassField data={data} />
      <Roads roads={data.roads} />
      <RoadMarkings roads={data.roads} />
      <Buildings buildings={data.buildings} />
      <RoadsideProps props={props} tanks={tanks} benches={benches} />
      <Cables props={props} collisions={collisions} />
      <ShopFronts shopFronts={shopFronts} />
      <Boundary />
      <Player data={data} collisions={collisions} graph={graph} traffic={traffic} />
    </>
  )
}
