import { Suspense, use, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { markPartBuilt, useLaunch, type WorldPart } from '../game/launch'
import { Sky } from '../sky/Sky'
import { createCrashPhysics } from '../physics/crashPhysics'
import { loadRapier } from '../physics/rapier'
import { createTrafficWorld } from '../traffic/trafficLogic'
import { createTrafficSignals } from '../traffic/trafficSignals'
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
import { forEachRoadNear, generateRoadsideProps, indexRoadPieces, isClearOfRoads, nearestRoadPiece, toRoadPieces } from './props'
import { planBoundaries, planJunctionRailings } from './fencing'
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
import { createSurfaceMap, worldSurface } from './surfaceMap'
import { setBuildingsBack } from './buildingSetback'
import { SurfaceDebug } from '../dev/SurfaceDebug'
import { HOME_FACING, HOME_NEAR, MAIN_STORE_NEAR, MAIN_STORE_SEARCH, nearestHouseGate, petrolPumpSpawn, startAtGate } from './homeStart'
import { forcedTutorial } from '../game/tutorial'
import { plantContextTrees } from './treeSpecies'
import { HouseKitMesh } from './HouseKitMesh'
import { Kerbs } from './Kerbs'
import { RestrictedWall } from './RestrictedWall'
import { ConstructionSites } from './ConstructionSites'
import { findConstructionSites, siteOutline } from './sitePlacement'
import { addRestrictedWalls } from './restricted'
import { RoadMarkings } from './RoadMarkings'
import { createRoadGraph } from './roadGraph'
import { Roads } from './Roads'
import { RoadsideProps } from './RoadsideProps'
import { ShopFronts } from './ShopFronts'
import { LandmarkSigns } from './LandmarkSigns'
import { placeLandmarkSigns } from './landmarks'
import { FuelStations } from './FuelStations'
import { forecourtOutline, FUEL_STATIONS, isOnForecourt, placeFuelStations } from './fuelStationData'
import { fillEmptyPlots } from './infillPlots'
import { WarmAssets } from './WarmAssets'
import { markLoad, startLaps } from '../dev/loadTimeline'
import { Hoardings } from './Hoardings'
import { StiltParking } from './StiltParking'
import { StreetLife } from './StreetLife'
import { placeStreetLife } from './streetPlacement'
import { fillShopUnits, generateShopFronts } from './shopFrontPlacement'
import { typeByChance, typeByChanceOnMainRoad } from './signboards'
import { addParkedCarWalls, markParkedOnLanes, parkedFootprints, planStreetParking, STREET_CAR_MODELS } from './streetParking'

/** Cars parked along the kerb are drawn this far, in metres: further than those under buildings, as they're in the open. */
const STREET_PARKING_DRAW = 150
/** No parking this close to where the ride starts, in metres. */
const SPAWN_CLEAR = 12

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
  const lap = startLaps('plan')
  // Each road's kind of street, from its OSM class and the shops along it. Everything below dresses roads by it.
  const presetSummary = assignStreetPresets(data.roads, data.buildings, data.places, referenceStreetsOnly())
  if (isDebug()) (window as unknown as { __deliverItStreets?: () => unknown }).__deliverItStreets = () => listStreets(data.roads)
  // Debug: whether a point is inside something solid, for checking walls from the console.
  if (isDebug()) (window as unknown as { __deliverItSolidAt?: (x: number, z: number, radius: number) => boolean }).__deliverItSolidAt = (x, z, radius) => isNearBuilding(collisions, x, z, radius)
  if (import.meta.env.DEV) console.info('[streets]', JSON.stringify(presetSummary, (_key, value) => (typeof value === 'number' ? Math.round(value * 10) / 10 : value)))
  const roadPieces = toRoadPieces(data.roads)
  const roadIndex = indexRoadPieces(roadPieces)
  lap('presets and road index')
  // No building stands on a road or its footpath: trimmed back, made smaller, or replaced by a walled plot.
  const setback = setBuildingsBack(data, roadIndex)
  worldSurface.report['buildings set back'] = setback.report
  lap(`building setback: ${JSON.stringify(setback.report)}`)
  // Shops on the ground floor of nearly every building along shop streets and main roads, as on 27th Main.
  const groundFloorShops = addGroundFloorShops(data.buildings, data.roads, roadIndex)
  if (import.meta.env.DEV) console.info('[streets] ground-floor shops added:', groundFloorShops)
  const collisions = createCollisionWorld(data.buildings)
  lap('ground-floor shops and collisions')
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
  lap('infill')
  if (import.meta.env.DEV) console.info('[streets] infill:', JSON.stringify({ buildings: infill.buildings.length, sites: infill.sites.length, cars: infill.parkedCars.length, hoardings: infill.hoardings.length, pumps: infill.pumps.length, shrines: infill.shrines.length }))
  const mappedShops = generateShopFronts(data.places, collisions)
  const kit = placeCityKit(data.buildings, data.roads, collisions, mappedShops)
  lap('shop fronts and city kit')
  const graph = createRoadGraph(data.roads)
  const signalNodes = createTrafficSignals(graph).junctions.map(({ node }) => node)
  // The main dark store: the shop front nearest a spot on 27th Main in Sector 2, central to the streets round it.
  const stores = findDarkStores(data.buildings, graph, collisions, mappedShops, MAIN_STORE_NEAR, signalNodes, { min: 0, max: MAIN_STORE_SEARCH })
  for (const store of stores) addDarkStorePosts(collisions, store)
  lap('road graph and dark stores')
  // Before trees, lamps and parked scooters, which must keep clear of the compound walls it adds.
  const houses = planHouseKit(data.buildings, data.roads, collisions, stores)
  lap('house kit')
  // Building sites take open plots before trees and lamps do, and are solid to them.
  const sites = [...findConstructionSites(data, collisions), ...infill.sites]
  // Petrol bunks take their forecourts before trees and lamps do, and their pillars and pumps are solid.
  const fuel = placeFuelStations(data.roads, data.fuelRoofs, collisions, infill.pumps)
  // The riders' bay at each dark store: on its footpath, short of the kerb.
  // Temples, mosques and churches: shrines where the map has only a pin, and striped compound walls.
  const worship = planPlacesOfWorship(data.worship, data.buildings, roadIndex, collisions)
  // The ground map: what every spot is (road, footpath, paved, building, park, plot...), which
  // everything placed from here on asks first (surfaceMap.ts).
  const surfaceMap = createSurfaceMap(data, { paved: fuel.map(forecourtOutline), plots: sites.map(siteOutline) })
  worldSurface.map = surfaceMap
  lap('sites, fuel and worship')
  // TEMPORARY: a spot on the street in front of each Jagannath temple, facing it.
  teleportSpots.length = 0
  for (const site of worship.filter(({ faith }) => faith === 'kalinga')) {
    const inside = innerPoint(site.outline)
    const out = distanceToEdge(site.outline, inside, site.front) + 9
    const [frontX, frontZ] = site.front
    teleportSpots.push({ name: site.name ?? 'Jagannath temple', x: inside[0] + frontX * out, z: inside[1] + frontZ * out, heading: Math.atan2(-frontX, -frontZ) })
  }
  // Walls and fences go up before trees, lamps and benches, which then keep clear of them:
  // closed loops round compounds, school grounds, parks and bunks, then OSM's mapped lines.
  const boundaries = planBoundaries(data, roadIndex, collisions, { temples: templeCompounds(data.worship), plots: setback.plots, bunks: fuel.map(forecourtOutline) })
  worldSurface.report.boundaries = boundaries.report
  lap(`boundaries: ${JSON.stringify(boundaries.report)}`)
  // Main roads get more showrooms; other streets the everyday mix.
  const shopFronts = fillShopUnits(houses.shopUnits, mappedShops, (roll, x, z) => {
    const near = nearestRoadPiece(roadIndex, x, z, 20)
    return near && streetPresetOf(data.roads[near.piece.road])?.name === 'main' ? typeByChanceOnMainRoad(roll) : typeByChance(roll)
  })
  // Menu boards on the pavement are solid too.
  for (const { menuBoard } of shopFronts) if (menuBoard) addPost(collisions, menuBoard[0], menuBoard[1], MENU_BOARD_RADIUS)
  const props = generateRoadsideProps(data.roads, collisions, shopFronts, (x, z) => isOnForecourt(fuel, x, z))
  lap('shop units and roadside props')
  const benches = plantParks(data, collisions, props)
  // Trees placed by where they grow: palms and ashokas behind compound gates, a peepal or banyan
  // by each temple, a big tree on some junction corners (treeSpecies.ts).
  const junctions = graph.links.flatMap((links, node) => {
    if (links.length < 3) return []
    let reach = 0
    forEachRoadNear(roadIndex, graph.xs[node], graph.zs[node], 2, (piece) => (reach = Math.max(reach, piece.width / 2)))
    return [{ x: graph.xs[node], z: graph.zs[node], reach }]
  })
  props.trees.push(...plantContextTrees({ gates: houses.gates, temples: worship, junctions, roads: roadIndex, collisions }))
  // Carts and name boards take what room the trees, lamps and parked scooters have left.
  const life = placeStreetLife(data.roads, collisions, props)
  lap('parks and street life')
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
  lap('street edges')
  // Before traffic takes them over: no parked scooter with one wheel on the footpath and one off it.
  props.parkedScooters = settleParkedScooters(
    props.parkedScooters,
    edges.liftAt,
    (x, z) => !isNearBuilding(collisions, x, z, 0.45) && isClearOfRoads(roadIndex, x, z, 0.35),
  )
  // Kerbside parking: cars and bikes parallel to the road edge (streetParking.ts), made solid once
  // the traffic lanes exist, below.
  // Home: the family house nearest the spot on 16th Cross Road, and the start in front of its gate.
  const homeGate = nearestHouseGate(houses.gates, HOME_NEAR)
  const homeStart = homeGate ? startAtGate(homeGate, roadIndex, HOME_FACING) : null
  // Where this ride starts: a debug street, the place the rider was last, or home.
  const spawnSlug = requestedSpawn()
  const saved = forcedTutorial() ? null : useGameStore.getState().lastPosition
  const spawn =
    (spawnSlug === 'petrol-pump' ? petrolPumpSpawn(fuel) : spawnSlug ? findSpawn(data.roads, spawnSlug) : null) ??
    (saved ? { name: 'Where you left off', ...saved } : null) ??
    homeStart
  // Not where the ride starts, so the scooter never starts inside a parked car.
  const starts = [homeStart, spawn].filter((point) => point !== null).map(({ x, z }): [number, number] => [x, z])
  const parking = planStreetParking({
    roads: data.roads,
    pieces: roadPieces,
    graph,
    gates: houses.gates,
    collisions,
    keepClear: (x, z) => isOnForecourt(fuel, x, z) || starts.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < SPAWN_CLEAR),
    roadIndex,
  })
  lap(`street parking: ${parking.cars.length} cars, ${parking.bikes.length} bikes; refused ${JSON.stringify(parking.rejected)}`)
  worldSurface.report['parked vehicles'] = { cars: parking.cars.length, bikes: parking.bikes.length, ...Object.fromEntries(Object.entries(parking.rejected).map(([why, count]) => [`refused, ${why}`, count])) }
  const physics = createCrashPhysics(rapier, collisions)
  lap('parked scooters and physics')
  const features = placeRoadFeatures(graph)
  // Main roads are busier and have buses; quiet streets have less (streetPresets.ts).
  const streetAt = (x: number, z: number) => {
    const near = nearestRoadPiece(roadIndex, x, z, 4)
    return near ? streetPresetOf(data.roads[near.piece.road]) : null
  }
  const traffic = createTrafficWorld(graph, collisions, props.parkedScooters, physics, features.breakersOnLink, Math.random, streetAt)
  lap('road features and traffic')
  // After the lanes, so parked cars don't count as blocking them: traffic eases out around them instead.
  markParkedOnLanes(traffic.roadLanes, parkedFootprints(parking))
  addParkedCarWalls(collisions, parking)
  // After the lanes, as a pole by the kerb would otherwise close the pavement path beside it.
  for (const { x, z } of traffic.signals.posts) addPost(collisions, x, z, SIGNAL_POLE_RADIUS)
  // Medians too: a lane runs close beside each, and would otherwise count as blocked.
  for (const { start, end, width } of edges.medians) addWall(collisions, start, end, width)
  // Railings on the way into the junctions, after the lanes for the same reason.
  const railings = planJunctionRailings(traffic.signals.posts, roadIndex, houses.gates, collisions, (x, z) => isOnForecourt(fuel, x, z))
  const fences = [...boundaries.runs, ...railings]
  const tanks = [...generateRoofTanks(data.buildings), ...houses.tanks]
  lap('railings and tanks')
  const surface = createSurface(data.roads, features, edges.heightAt)
  const newSoilArea = findNewGroundArea(roadPieces.filter((piece) => usesNewGround(data.roads[piece.road])))
  // Shopkeepers, customers and walkers at the shops, as many as each street's preset says.
  const shopPeople = planShopPeople(shopFronts, data.roads, roadIndex)
  lap('surface, soil and shop people')
  // Signs go on walls only, so they can be placed at any point once the buildings are in.
  const landmarks = placeLandmarkSigns(data.roads, collisions)
  const home = homeGate ? { x: homeGate.x, z: homeGate.z } : null
  // Chai stalls, by their street, for the phone's Maps app to offer as places to go.
  const chaiStalls = shopFronts
    .filter(({ type }) => type === 'chai')
    .map(({ x, z }) => {
      const near = nearestRoadPiece(roadIndex, x, z, 25)
      const street = near ? data.roads[near.piece.road].properties.name : undefined
      return { x, z, name: street ? `Chai stall · ${street}` : 'Chai stall' }
    })
  lap('spawn and landmarks')

  return { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, stores, houses, life, sites, surface, features, landmarks, fuel, edges, newSoilArea, fences, worship, spawn, shopPeople, infill, home, streetParked: [...parking.cars, ...parking.bikes], chaiStalls, surfaceMap }
}

/** Tells the loading screen a part is on screen. It sits beside the part, so it only mounts once the part has. */
function Built({ name }: { name: WorldPart }) {
  useEffect(() => {
    markLoad(`part: ${name}`)
    markPartBuilt(name)
  }, [name])
  return null
}

/**
 * Marks when a part starts rendering. Parts render one after another, so the time to the next
 * part's mark is how long this one took to build its shapes (see dev/loadTimeline.ts).
 */
function RenderMark({ name }: { name: WorldPart }) {
  markLoad(`render: ${name}`)
  return null
}

/**
 * Parts whose objects never move once placed. three.js works out every object's place in the
 * world again every frame (`updateMatrixWorld`), about a tenth of the game's JavaScript; for these
 * it's worked out once, and the whole branch is skipped after that. Their streamed squares are
 * added at the origin, where nothing needs working out. Anything that moves an object (the sky,
 * the sun, grass, street life, the player and traffic) is left out.
 */
const STILL_PARTS = new Set<WorldPart>([
  'ground', 'parks', 'roads', 'kerbs', 'streetEdges', 'restrictedWall', 'sites', 'markings', 'roadFeatures', 'buildings',
  'houses', 'stilts', 'hoardings', 'cityKit', 'cables', 'shops', 'landmarks', 'fuel', 'temples', 'fences', 'boundary',
])

/** One part of the world, with its own Suspense boundary. */
function Part({ name, children }: { name: WorldPart; children: ReactNode }) {
  const group = useRef<THREE.Group>(null)
  return (
    <Suspense fallback={null}>
      <RenderMark name={name} />
      {/* Named, so a profile can tell which part each draw call belongs to. A group draws nothing. */}
      <group ref={group} name={`part:${name}`}>{children}</group>
      {STILL_PARTS.has(name) && <HoldStill group={group} />}
      <Built name={name} />
    </Suspense>
  )
}

/**
 * Works out a still part's place in the world once, then has three.js skip it. It sits inside the
 * part's Suspense boundary, after it, so it runs when the part's contents are actually on screen,
 * and again when a change of quality has remounted any of them.
 */
function HoldStill({ group }: { group: RefObject<THREE.Group | null> }) {
  const quality = useGameStore((state) => state.quality)
  useLayoutEffect(() => placeOnce(group.current), [group, quality])
  return null
}

function placeOnce(still: THREE.Group | null) {
  if (!still) return
  still.matrixWorldAutoUpdate = true
  still.updateMatrixWorld(true)
  still.matrixWorldAutoUpdate = false
}

export function World() {
  const data = use(loadMapData())
  const rapier = use(loadRapier())

  const { collisions, props, shopFronts, kit, graph, traffic, tanks, benches, stores, houses, life, sites, surface, features, landmarks, fuel, edges, newSoilArea, fences, worship, spawn, shopPeople, infill, home, streetParked, chaiStalls, surfaceMap } =
    getWorld(data, rapier)
  useEffect(() => useLaunch.setState({ planned: true }), [])
  useEffect(() => useGameStore.getState().setPlaces({ chai: chaiStalls }), [chaiStalls])

  // Each part has its own Suspense boundary, the player and traffic included.
  // While a part's textures or models load, it "suspends". Without a boundary of
  // its own, React would throw away every part not yet on screen and redo it,
  // rebuilding their shapes each time. With one, the parts that are ready go on
  // screen, and only the part still loading waits.
  return (
    <Suspense fallback={null}>
      <WarmAssets>
        <Part name="sky"><Sky /></Part>
        <Part name="lighting"><Lighting /></Part>
        <Part name="ground"><Ground newSoilArea={newSoilArea} /></Part>
        <Part name="parks"><Parks data={data} /></Part>
        <Part name="grass"><GrassField surface={surfaceMap} /></Part>
        <Part name="roads"><Roads roads={data.roads} /></Part>
        <Part name="kerbs"><Kerbs roads={data.roads} collisions={collisions} isInCorner={edges.isInCorner} /></Part>
        <Part name="streetEdges"><StreetEdges edges={edges} /></Part>
        <Part name="restrictedWall"><RestrictedWall zones={data.restricted} /></Part>
        <Part name="sites"><ConstructionSites sites={sites} /></Part>
        <Part name="markings"><RoadMarkings roads={data.roads} /></Part>
        <Part name="roadFeatures"><RoadDetails features={features} /></Part>
        <Part name="buildings"><Buildings buildings={data.buildings} /></Part>
        <Part name="houses"><HouseKitMesh kit={houses} /></Part>
        <Part name="stilts">
          <StiltParking vehicles={[...houses.stiltParking, ...infill.parkedCars]} />
          <StiltParking vehicles={streetParked} drawDistance={STREET_PARKING_DRAW} carModels={STREET_CAR_MODELS} />
        </Part>
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
        {isDebug() && <SurfaceDebug surface={surfaceMap} />}
        <Part name="player"><Player stores={stores} collisions={collisions} graph={graph} traffic={traffic} surface={surface} bunks={fuel} spawn={spawn} home={home} /></Part>
      </WarmAssets>
    </Suspense>
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
