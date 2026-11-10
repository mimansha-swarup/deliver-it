import { use, useMemo } from 'react'
import { Sky } from '../sky/Sky'
import { createCrashPhysics } from '../physics/crashPhysics'
import { loadRapier } from '../physics/rapier'
import { createTrafficWorld } from '../traffic/trafficLogic'
import { createTrafficSignals } from '../traffic/trafficSignals'
import { SCOOTER_SPAWN } from '../vehicle/vehicleConfig'
import { Player } from '../vehicle/Player'
import { Boundary } from './Boundary'
import { Buildings } from './Buildings'
import { Cables } from './Cables'
import { CityKit } from './CityKit'
import { placeCityKit } from './cityKitPlacement'
import { addPost, createCollisionWorld } from './collision'
import { DarkStoreBuilding } from './DarkStoreBuilding'
import { addDarkStorePosts, findDarkStore } from './darkStore'
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

const SIGNAL_POLE_RADIUS = 0.1

export function World() {
  const data = use(loadMapData())
  const rapier = use(loadRapier())

  // Trees and lamps are solid, so they're added to the collision world as they're placed.
  // Awnings and kit pieces go first, while the collision world holds nothing but buildings.
  const { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, store } = useMemo(() => {
    const collisions = createCollisionWorld(data.buildings)
    const shopFronts = generateShopFronts(data.places, collisions)
    const kit = placeCityKit(data.buildings, data.roads, collisions, shopFronts)
    const graph = createRoadGraph(data.roads)
    const signalNodes = createTrafficSignals(graph).junctions.map(({ node }) => node)
    const start: [number, number] = [SCOOTER_SPAWN.x, SCOOTER_SPAWN.z]
    const store = findDarkStore(data.buildings, graph, collisions, shopFronts, start, signalNodes)
    addDarkStorePosts(collisions, store)
    const props = generateRoadsideProps(data.roads, collisions, shopFronts)
    const benches = plantParks(data, collisions, props)
    const physics = createCrashPhysics(rapier, collisions)
    const traffic = createTrafficWorld(graph, collisions, props.parkedScooters, physics)
    // After the lanes, as a pole by the kerb would otherwise close the pavement path beside it.
    for (const { x, z } of traffic.signals.posts) addPost(collisions, x, z, SIGNAL_POLE_RADIUS)
    const tanks = generateRoofTanks(data.buildings)
    return { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, store }
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
      <CityKit placements={kit} />
      <DarkStoreBuilding store={store} />
      <RoadsideProps props={props} tanks={tanks} benches={benches} />
      <Cables props={props} collisions={collisions} />
      <ShopFronts shopFronts={shopFronts} />
      <Boundary />
      <Player store={store} collisions={collisions} graph={graph} traffic={traffic} />
    </>
  )
}
