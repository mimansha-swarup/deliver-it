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

export type MapData = {
  buildings: PolygonFeature[]
  roads: LineFeature[]
  footways: LineFeature[]
  places: PointFeature[]
}

const MAP_URL = `${import.meta.env.BASE_URL}data/hsr-compact.geojson`

/** OSM `highway` values a scooter should not treat as a road. */
const NOT_DRIVABLE = new Set(['footway', 'path'])

function sortFeatures(features: Feature[]): MapData {
  const data: MapData = { buildings: [], roads: [], footways: [], places: [] }

  for (const feature of features) {
    const { geometry, properties } = feature

    if (geometry.type === 'Polygon' && properties.building) {
      data.buildings.push({ ...feature, geometry })
    } else if (geometry.type === 'LineString' && properties.highway) {
      const layer = NOT_DRIVABLE.has(properties.highway) ? data.footways : data.roads
      layer.push({ ...feature, geometry })
    } else if (geometry.type === 'Point') {
      data.places.push({ ...feature, geometry })
    }
  }

  return data
}

async function fetchMapData(): Promise<MapData> {
  const response = await fetch(MAP_URL)
  if (!response.ok) {
    throw new Error(`Could not load ${MAP_URL}: HTTP ${response.status}`)
  }

  const { features } = (await response.json()) as { features: Feature[] }
  const data = sortFeatures(features)

  console.info('[map] loaded', {
    buildings: data.buildings.length,
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
