import { use } from 'react'
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
import { loadMapData, type MapData } from './mapData'
import { plantParks } from './parkPlanting'
import { Parks } from './Parks'
import { generateRoadsideProps } from './props'
import { generateRoofTanks } from './roofTanks'
import { planHouseKit } from './houseKit'
import { HouseKitMesh } from './HouseKitMesh'
import { RoadMarkings } from './RoadMarkings'
import { createRoadGraph } from './roadGraph'
import { Roads } from './Roads'
import { RoadsideProps } from './RoadsideProps'
import { ShopFronts } from './ShopFronts'
import { StiltParking } from './StiltParking'
import { StreetLife } from './StreetLife'
import { placeStreetLife } from './streetPlacement'
import { fillShopUnits, generateShopFronts } from './shopFrontPlacement'

const SIGNAL_POLE_RADIUS = 0.1
const MENU_BOARD_RADIUS = 0.35

type RapierModule = Awaited<ReturnType<typeof loadRapier>>

/** The last world built, kept outside React. See `getWorld`. */
let built: { data: MapData; rapier: RapierModule; world: ReturnType<typeof buildWorld> } | null = null

/**
 * The world is built once and kept here, not in `useMemo`. While textures and
 * models are still loading, a part of the world "suspends", and React throws
 * away everything it had rendered so far and starts again, memos included. For
 * the whole of HSR, that rebuilt the world about fifteen times before it showed.
 */
function getWorld(data: MapData, rapier: RapierModule) {
  if (built?.data !== data || built.rapier !== rapier) built = { data, rapier, world: buildWorld(data, rapier) }
  return built.world
}

/**
 * Everything placed in the world, in order. Trees and lamps are solid, so they're
 * added to the collision world as they're placed. Awnings and kit pieces go first,
 * while the collision world holds nothing but buildings.
 */
function buildWorld(data: MapData, rapier: RapierModule) {
  const collisions = createCollisionWorld(data.buildings)
  const mappedShops = generateShopFronts(data.places, collisions)
  const kit = placeCityKit(data.buildings, data.roads, collisions, mappedShops)
  const graph = createRoadGraph(data.roads)
  const signalNodes = createTrafficSignals(graph).junctions.map(({ node }) => node)
  const start: [number, number] = [SCOOTER_SPAWN.x, SCOOTER_SPAWN.z]
  const store = findDarkStore(data.buildings, graph, collisions, mappedShops, start, signalNodes)
  addDarkStorePosts(collisions, store)
  // Before trees, lamps and parked scooters, which must keep clear of the compound walls it adds.
  const houses = planHouseKit(data.buildings, data.roads, collisions, store)
  const shopFronts = fillShopUnits(houses.shopUnits, mappedShops)
  // Menu boards on the pavement are solid too.
  for (const { menuBoard } of shopFronts) if (menuBoard) addPost(collisions, menuBoard[0], menuBoard[1], MENU_BOARD_RADIUS)
  const props = generateRoadsideProps(data.roads, collisions, shopFronts)
  const benches = plantParks(data, collisions, props)
  // Carts and name boards take what room the trees, lamps and parked scooters have left.
  const life = placeStreetLife(data.roads, collisions, props)
  const physics = createCrashPhysics(rapier, collisions)
  const traffic = createTrafficWorld(graph, collisions, props.parkedScooters, physics)
  // After the lanes, as a pole by the kerb would otherwise close the pavement path beside it.
  for (const { x, z } of traffic.signals.posts) addPost(collisions, x, z, SIGNAL_POLE_RADIUS)
  const tanks = [...generateRoofTanks(data.buildings), ...houses.tanks]
  return { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, store, houses, life }
}

export function World() {
  const data = use(loadMapData())
  const rapier = use(loadRapier())

  const { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, store, houses, life } = getWorld(data, rapier)

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
      <HouseKitMesh kit={houses} />
      <StiltParking vehicles={houses.stiltParking} />
      <CityKit placements={kit} />
      <DarkStoreBuilding store={store} />
      <RoadsideProps props={props} tanks={tanks} benches={benches} creepers={houses.creepers} />
      <StreetLife life={life} kolams={houses.kolams} />
      <Cables props={props} collisions={collisions} />
      <ShopFronts shopFronts={shopFronts} />
      <Boundary />
      <Player store={store} collisions={collisions} graph={graph} traffic={traffic} />
    </>
  )
}
