import { Suspense, use, useEffect, type ReactNode } from 'react'
import { markPartBuilt, useLaunch, type WorldPart } from '../game/launch'
import { Sky } from '../sky/Sky'
import { createCrashPhysics } from '../physics/crashPhysics'
import { loadRapier } from '../physics/rapier'
import { createTrafficWorld } from '../traffic/trafficLogic'
import { createTrafficSignals } from '../traffic/trafficSignals'
import { SCOOTER_SPAWN } from '../vehicle/vehicleConfig'
import { Player } from '../vehicle/Player'
import { Boundary } from './Boundary'
import { Skyline } from './Skyline'
import { Buildings } from './Buildings'
import { Cables } from './Cables'
import { CityKit } from './CityKit'
import { placeCityKit } from './cityKitPlacement'
import { addPost, addWall, createCollisionWorld, isNearBuilding } from './collision'
import { DarkStores } from './DarkStoreBuilding'
import { addDarkStorePosts, findDarkStores } from './darkStore'
import { GrassField } from './GrassField'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { placeRoadFeatures } from './roadFeatures'
import { RoadDetails } from './RoadDetails'
import { createSurface } from './surface'
import { loadMapData, type MapData } from './mapData'
import { plantParks } from './parkPlanting'
import { Parks } from './Parks'
import { generateRoadsideProps, indexRoadPieces, isClearOfRoads, nearestRoadPiece, toRoadPieces } from './props'
import { planJunctionRailings, planMappedBarriers, planParkFences, planTempleWalls } from './fencing'
import { distanceToEdge, innerPoint, planPlacesOfWorship, templeCompounds } from './worship'
// TEMPORARY: J jumps to the Jagannath temples, in the dev server only.
import { teleportSpots } from '../dev/teleportSpots'
import { findSpawn, isDebug, referenceStreetsOnly, requestedSpawn } from '../dev/spawn'
import { Temples } from './Temples'
import { ShopPeople } from './ShopPeople'
import { planShopPeople } from './shopPeoplePlacement'
import { Fences } from './Fences'
import { buildStreetEdges } from './streetEdgeGeometry'
import { StreetEdges } from './StreetEdges'
import { groundLift, settleParkedScooters } from './groundLift'
import { usesNewGround } from './streetEdgeConfig'
import { addGroundFloorShops, assignStreetPresets, listStreets, streetPresetOf } from './streetPresets'
import { generateRoofTanks } from './roofTanks'
import { planHouseKit } from './houseKit'
import { HouseKitMesh } from './HouseKitMesh'
import { Kerbs } from './Kerbs'
import { RestrictedWall } from './RestrictedWall'
import { ConstructionSites } from './ConstructionSites'
import { findConstructionSites } from './sitePlacement'
import { addRestrictedWalls } from './restricted'
import { RoadMarkings } from './RoadMarkings'
import { createRoadGraph } from './roadGraph'
import { Roads } from './Roads'
import { RoadsideProps } from './RoadsideProps'
import { ShopFronts } from './ShopFronts'
import { LandmarkSigns } from './LandmarkSigns'
import { placeLandmarkSigns } from './landmarks'
import { FuelStations } from './FuelStations'
import { FUEL_STATIONS, isOnForecourt, placeFuelStations } from './fuelStationData'
import { fillEmptyPlots } from './infillPlots'
import { Hoardings } from './Hoardings'
import { StiltParking } from './StiltParking'
import { StreetLife } from './StreetLife'
import { placeStreetLife } from './streetPlacement'
import { fillShopUnits, generateShopFronts } from './shopFrontPlacement'
import { typeByChance, typeByChanceOnMainRoad } from './signboards'

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
  // Each road's kind of street, from its OSM class and the shops along it. Everything below dresses roads by it.
  const presetSummary = assignStreetPresets(data.roads, data.buildings, data.places, referenceStreetsOnly())
  if (isDebug()) (window as unknown as { __deliverItStreets?: () => unknown }).__deliverItStreets = () => listStreets(data.roads)
  // Debug: whether a point is inside something solid, for checking walls from the console.
  if (isDebug()) (window as unknown as { __deliverItSolidAt?: (x: number, z: number, radius: number) => boolean }).__deliverItSolidAt = (x, z, radius) => isNearBuilding(collisions, x, z, radius)
  if (import.meta.env.DEV) console.info('[streets]', JSON.stringify(presetSummary, (_key, value) => (typeof value === 'number' ? Math.round(value * 10) / 10 : value)))
  const roadPieces = toRoadPieces(data.roads)
  const roadIndex = indexRoadPieces(roadPieces)
  // Shops on the ground floor of nearly every building along shop streets and main roads, as on 27th Main.
  const groundFloorShops = addGroundFloorShops(data.buildings, data.roads, roadIndex)
  if (import.meta.env.DEV) console.info('[streets] ground-floor shops added:', groundFloorShops)
  const collisions = createCollisionWorld(data.buildings)
  // Military land is walled off first, so nothing is placed through its wall.
  addRestrictedWalls(collisions, data.restricted)
  // Empty plots beside the streets are built on, before anything else looks at the buildings.
  const infill = fillEmptyPlots(data.buildings, data.roads, roadPieces, roadIndex, collisions, {
    parks: data.parks,
    areas: data.areas,
    fuel: FUEL_STATIONS,
    worship: data.worship,
  })
  for (const shrine of infill.shrines) if (!data.worship.includes(shrine)) data.worship.push(shrine)
  if (import.meta.env.DEV) console.info('[streets] infill:', JSON.stringify({ buildings: infill.buildings.length, sites: infill.sites.length, cars: infill.parkedCars.length, hoardings: infill.hoardings.length, pumps: infill.pumps.length, shrines: infill.shrines.length }))
  const mappedShops = generateShopFronts(data.places, collisions)
  const kit = placeCityKit(data.buildings, data.roads, collisions, mappedShops)
  const graph = createRoadGraph(data.roads)
  const signalNodes = createTrafficSignals(graph).junctions.map(({ node }) => node)
  const start: [number, number] = [SCOOTER_SPAWN.x, SCOOTER_SPAWN.z]
  const stores = findDarkStores(data.buildings, graph, collisions, mappedShops, start, signalNodes)
  for (const store of stores) addDarkStorePosts(collisions, store)
  // Before trees, lamps and parked scooters, which must keep clear of the compound walls it adds.
  const houses = planHouseKit(data.buildings, data.roads, collisions, stores)
  // Building sites take open plots before trees and lamps do, and are solid to them.
  const sites = [...findConstructionSites(data, collisions), ...infill.sites]
  // Petrol bunks take their forecourts before trees and lamps do, and their pillars and pumps are solid.
  const fuel = placeFuelStations(data.roads, data.fuelRoofs, collisions, infill.pumps)
  // The riders' bay at each dark store: on its footpath, short of the kerb.
  // Temples, mosques and churches: shrines where the map has only a pin, and striped compound walls.
  const worship = planPlacesOfWorship(data.worship, data.buildings, roadIndex, collisions)
  const templeWalls = planTempleWalls(templeCompounds(data.worship), roadIndex, collisions)
  // TEMPORARY: a spot on the street in front of each Jagannath temple, facing it.
  teleportSpots.length = 0
  for (const site of worship.filter(({ faith }) => faith === 'kalinga')) {
    const inside = innerPoint(site.outline)
    const out = distanceToEdge(site.outline, inside, site.front) + 9
    const [frontX, frontZ] = site.front
    teleportSpots.push({ name: site.name ?? 'Jagannath temple', x: inside[0] + frontX * out, z: inside[1] + frontZ * out, heading: Math.atan2(-frontX, -frontZ) })
  }
  // Walls and fences go up before trees, lamps and benches, which then keep clear of them:
  // those mapped in OSM first, where nothing is built yet, then round the parks.
  const mappedBarriers = planMappedBarriers(data.barriers, roadIndex, collisions)
  const parkFences = planParkFences(data, roadIndex, collisions)
  // Main roads get more showrooms; other streets the everyday mix.
  const shopFronts = fillShopUnits(houses.shopUnits, mappedShops, (roll, x, z) => {
    const near = nearestRoadPiece(roadIndex, x, z, 20)
    return near && streetPresetOf(data.roads[near.piece.road])?.name === 'main' ? typeByChanceOnMainRoad(roll) : typeByChance(roll)
  })
  // Menu boards on the pavement are solid too.
  for (const { menuBoard } of shopFronts) if (menuBoard) addPost(collisions, menuBoard[0], menuBoard[1], MENU_BOARD_RADIUS)
  const props = generateRoadsideProps(data.roads, collisions, shopFronts, (x, z) => isOnForecourt(fuel, x, z))
  const benches = plantParks(data, collisions, props)
  // Carts and name boards take what room the trees, lamps and parked scooters have left.
  const life = placeStreetLife(data.roads, collisions, props)
  // The new ground, where a road has it: kerbs, corners, raised footpaths. It sets those streets' heights.
  const edges = buildStreetEdges({
    roads: data.roads,
    pieces: roadPieces,
    index: roadIndex,
    gates: houses.gates,
    trees: props.trees,
    keepLow: (x, z) => isOnForecourt(fuel, x, z),
    fronts: shopFronts,
  })
  groundLift.at = edges.liftAt
  // Before traffic takes them over: no parked scooter with one wheel on the footpath and one off it.
  props.parkedScooters = settleParkedScooters(
    props.parkedScooters,
    edges.liftAt,
    (x, z) => !isNearBuilding(collisions, x, z, 0.45) && isClearOfRoads(roadIndex, x, z, 0.35),
  )
  const physics = createCrashPhysics(rapier, collisions)
  const features = placeRoadFeatures(graph)
  // Main roads are busier and have buses; quiet streets have less (streetPresets.ts).
  const streetAt = (x: number, z: number) => {
    const near = nearestRoadPiece(roadIndex, x, z, 4)
    return near ? streetPresetOf(data.roads[near.piece.road]) : null
  }
  const traffic = createTrafficWorld(graph, collisions, props.parkedScooters, physics, features.breakersOnLink, Math.random, streetAt)
  // After the lanes, as a pole by the kerb would otherwise close the pavement path beside it.
  for (const { x, z } of traffic.signals.posts) addPost(collisions, x, z, SIGNAL_POLE_RADIUS)
  // Medians too: a lane runs close beside each, and would otherwise count as blocked.
  for (const { start, end, width } of edges.medians) addWall(collisions, start, end, width)
  // Railings on the way into the junctions, after the lanes for the same reason.
  const railings = planJunctionRailings(traffic.signals.posts, roadIndex, houses.gates, collisions, (x, z) => isOnForecourt(fuel, x, z))
  const fences = [...templeWalls, ...mappedBarriers, ...parkFences, ...railings]
  const tanks = [...generateRoofTanks(data.buildings), ...houses.tanks]
  const surface = createSurface(data.roads, features, edges.heightAt)
  const newSoilArea = findNewGroundArea(roadPieces.filter((piece) => usesNewGround(data.roads[piece.road])))
  // Shopkeepers, customers and walkers at the shops, as many as each street's preset says.
  const shopPeople = planShopPeople(shopFronts, data.roads, roadIndex)
  // Debug: ?spawn=<street> starts the rider on that street (dev server, or with ?debug).
  const spawnSlug = requestedSpawn()
  const spawn = spawnSlug ? findSpawn(data.roads, spawnSlug) : null
  // Signs go on walls only, so they can be placed at any point once the buildings are in.
  const landmarks = placeLandmarkSigns(data.roads, collisions)

  return { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, stores, houses, life, sites, surface, features, landmarks, fuel, edges, newSoilArea, fences, worship, spawn, shopPeople, infill }
}

/** Tells the loading screen a part is on screen. It sits beside the part, so it only mounts once the part has. */
function Built({ name }: { name: WorldPart }) {
  useEffect(() => markPartBuilt(name), [name])
  return null
}

/** One part of the world, with its own Suspense boundary. */
function Part({ name, children }: { name: WorldPart; children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      {children}
      <Built name={name} />
    </Suspense>
  )
}

export function World() {
  const data = use(loadMapData())
  const rapier = use(loadRapier())

  const { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, stores, houses, life, sites, surface, features, landmarks, fuel, edges, newSoilArea, fences, worship, spawn, shopPeople, infill } =
    getWorld(data, rapier)
  useEffect(() => useLaunch.setState({ planned: true }), [])

  // Each part has its own Suspense boundary, the player and traffic included.
  // While a part's textures or models load, it "suspends". Without a boundary of
  // its own, React would throw away every part not yet on screen and redo it,
  // rebuilding their shapes each time. With one, the parts that are ready go on
  // screen, and only the part still loading waits.
  return (
    <>
      <Part name="sky"><Sky /></Part>
      <Part name="lighting"><Lighting /></Part>
      <Part name="ground"><Ground newSoilArea={newSoilArea} /></Part>
      <Part name="parks"><Parks data={data} /></Part>
      <Part name="grass"><GrassField data={data} paved={edges.paved} /></Part>
      <Part name="roads"><Roads roads={data.roads} /></Part>
      <Part name="kerbs"><Kerbs roads={data.roads} collisions={collisions} isInCorner={edges.isInCorner} /></Part>
      <Part name="streetEdges"><StreetEdges edges={edges} /></Part>
      <Part name="restrictedWall"><RestrictedWall zones={data.restricted} /></Part>
      <Part name="sites"><ConstructionSites sites={sites} /></Part>
      <Part name="markings"><RoadMarkings roads={data.roads} /></Part>
      <Part name="roadFeatures"><RoadDetails features={features} /></Part>
      <Part name="buildings"><Buildings buildings={data.buildings} /></Part>
      <Part name="houses"><HouseKitMesh kit={houses} /></Part>
      <Part name="stilts"><StiltParking vehicles={[...houses.stiltParking, ...infill.parkedCars]} /></Part>
      <Part name="hoardings"><Hoardings hoardings={infill.hoardings} /></Part>
      <Part name="cityKit"><CityKit placements={kit} /></Part>
      <Part name="darkStore"><DarkStores stores={stores} /></Part>
      <Part name="props"><RoadsideProps props={props} tanks={tanks} benches={benches} creepers={houses.creepers} /></Part>
      <Part name="streetLife"><StreetLife life={life} kolams={houses.kolams} /></Part>
      <Part name="cables"><Cables props={props} collisions={collisions} /></Part>
      <Part name="shops"><ShopFronts shopFronts={shopFronts} /></Part>
      <Part name="shopPeople"><ShopPeople people={shopPeople} /></Part>
      <Part name="landmarks"><LandmarkSigns signs={landmarks} /></Part>
      <Part name="fuel"><FuelStations stations={fuel} /></Part>
      <Part name="temples"><Temples sites={worship} /></Part>
      <Part name="fences"><Fences runs={fences} /></Part>
      <Part name="boundary"><Boundary /><Skyline /></Part>
      <Part name="player"><Player stores={stores} collisions={collisions} graph={graph} traffic={traffic} surface={surface} bunks={fuel} spawn={spawn} /></Part>
    </>
  )
}

/** The box round every road with the new ground, as min x, min z, max x, max z, where the new soil is tried. */
function findNewGroundArea(pieces: { start: [number, number]; end: [number, number] }[]): [number, number, number, number] {
  if (pieces.length === 0) return [0, 0, 0, 0]
  const xs = pieces.flatMap((piece) => [piece.start[0], piece.end[0]])
  const zs = pieces.flatMap((piece) => [piece.start[1], piece.end[1]])
  const margin = 40
  return [Math.min(...xs) - margin, Math.min(...zs) - margin, Math.max(...xs) + margin, Math.max(...zs) + margin]
}
