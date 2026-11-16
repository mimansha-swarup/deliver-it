import { waitForPreloadedMap } from '../game/preload'
import { classifyBuildings, type BuildingKind } from './buildingKinds'
import { FUEL_STATIONS } from './fuelStationData'
import { cutOutRestricted, isRestricted } from './restricted'
import type { LonLat } from './worldUtils'

type Properties = Record<string, string | undefined>

type Geometry =
  | { type: 'Point'; coordinates: LonLat }
  | { type: 'LineString'; coordinates: LonLat[] }
  | { type: 'Polygon'; coordinates: LonLat[][] }

type Feature<G extends Geometry = Geometry> = {
  id: string
  properties: Properties
  geometry: G
}

export type PointFeature = Feature<Extract<Geometry, { type: 'Point' }>>
export type LineFeature = Feature<Extract<Geometry, { type: 'LineString' }>>
export type PolygonFeature = Feature<Extract<Geometry, { type: 'Polygon' }>>

/** A building, with what it's used for worked out from the map. */
export type BuildingFeature = PolygonFeature & { kind: BuildingKind }

export type MapData = {
  buildings: BuildingFeature[]
  roads: LineFeature[]
  footways: LineFeature[]
  /** Parks, playgrounds and sports pitches. */
  parks: PolygonFeature[]
  places: PointFeature[]
  /** Other outlines: housing colonies, campuses, land use. The phone map labels the named ones. */
  areas: PolygonFeature[]
  /** Military land: walled off, with no roads or paths inside. */
  restricted: PolygonFeature[]
  /**
   * Petrol bunk canopies. The map has them as buildings tagged `roof`, which
   * would be drawn as solid blocks, so they're taken out of `buildings` and
   * `FuelStations` puts an open canopy on pillars in their place.
   */
  fuelRoofs: PolygonFeature[]
}

/** A roof this close to a petrol bunk's mapped spot is its canopy, in metres. */
const FUEL_ROOF_REACH = 35

/** True for a `roof` building near one of the petrol bunks. */
function isFuelRoof({ properties, geometry }: PolygonFeature): boolean {
  if (properties.building !== 'roof') return false
  const ring = geometry.coordinates[0]
  const lon = ring.reduce((sum, [x]) => sum + x, 0) / ring.length
  const lat = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length
  const metresPerDegree = 111_320
  return FUEL_STATIONS.some(
    (station) =>
      Math.hypot((station.lng - lon) * metresPerDegree * Math.cos((lat * Math.PI) / 180), (station.lat - lat) * metresPerDegree) <
      FUEL_ROOF_REACH,
  )
}

const MAP_URL = `${import.meta.env.BASE_URL}data/hsr-compact.geojson`

/** OSM `highway` values a scooter should not treat as a road. */
const GREEN_SPACES = new Set(['park', 'garden', 'playground', 'pitch'])
const NOT_DRIVABLE = new Set(['footway', 'path'])

function sortFeatures(features: Feature[]): MapData {
  const data: MapData = { buildings: [], roads: [], footways: [], parks: [], places: [], areas: [], restricted: [], fuelRoofs: [] }
  const buildings: PolygonFeature[] = []
  const areas = data.areas

  for (const feature of features) {
    const { geometry, properties } = feature

    if (geometry.type === 'Polygon' && properties.building) {
      const building = { ...feature, geometry }
      if (isFuelRoof(building)) data.fuelRoofs.push(building)
      else buildings.push(building)
    } else if (geometry.type === 'Polygon' && GREEN_SPACES.has(properties.leisure ?? '')) {
      data.parks.push({ ...feature, geometry })
    } else if (geometry.type === 'LineString' && properties.highway) {
      const layer = NOT_DRIVABLE.has(properties.highway) ? data.footways : data.roads
      layer.push({ ...feature, geometry })
    } else if (geometry.type === 'Point') {
      data.places.push({ ...feature, geometry })
    } else if (geometry.type === 'Polygon') {
      areas.push({ ...feature, geometry })
    }
  }

  data.buildings = classifyBuildings(buildings, data.places, areas)
  data.restricted = areas.filter(isRestricted)
  data.roads = cutOutRestricted(data.roads, data.restricted)
  data.footways = cutOutRestricted(data.footways, data.restricted)
  return data
}

async function fetchMapData(): Promise<MapData> {
  // The page's loader is usually downloading it already. Otherwise, download it here.
  const preloaded = await waitForPreloadedMap()
  let text: string
  if (preloaded) {
    text = new TextDecoder().decode(preloaded)
  } else {
    const response = await fetch(MAP_URL)
    if (!response.ok) {
      throw new Error(`Could not load ${MAP_URL}: HTTP ${response.status}`)
    }
    text = await response.text()
  }

  const { features } = JSON.parse(text) as { features: Feature[] }
  const data = sortFeatures(features)

  const buildingKinds: Partial<Record<BuildingKind, number>> = {}
  for (const { kind } of data.buildings) buildingKinds[kind] = (buildingKinds[kind] ?? 0) + 1

  console.info('[map] loaded', {
    buildings: data.buildings.length,
    buildingKinds,
    roads: data.roads.length,
    footways: data.footways.length,
    places: data.places.length,
  })
  return data
}

let mapData: Promise<MapData> | undefined

/** Returns the same promise every time, so the file is only fetched once. */
export function loadMapData(): Promise<MapData> {
  mapData ??= fetchMapData()
  return mapData
}
