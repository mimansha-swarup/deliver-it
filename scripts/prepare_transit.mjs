#!/usr/bin/env node
/**
 * Transit from OpenStreetMap (ODbL), which the map file doesn't carry: metro lines and their
 * stations and entrances, bus stops (with the routes that stop there, from the route relations)
 * and bus stations, in the play area and a little past it.
 *
 *     node scripts/prepare_transit.mjs
 *
 * Writes public/data/hsr-transit.geojson. Asks the public Overpass API once; only the area's box
 * is sent.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public/data/hsr-transit.geojson')
/** The public Overpass servers, tried in turn: the main one is often busy. */
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
/** South, west, north, east: the play area (worldUtils.ts) and about 300 m round it. */
const BOX = '12.894,77.616,12.928,77.657'

const query = `[out:json][timeout:120];
(
  way["railway"~"^(subway|light_rail|rail|construction)$"](${BOX});
  node["railway"~"^(station|halt|subway_entrance)$"](${BOX});
  way["railway"="station"](${BOX});
  node["public_transport"="station"](${BOX});
  node["highway"="bus_stop"](${BOX});
  node["public_transport"="platform"]["bus"="yes"](${BOX});
  node["amenity"="bus_station"](${BOX});
  way["amenity"="bus_station"](${BOX});
)->.things;
.things out body geom;
rel(bn.things)["route"="bus"];
out body;
`

async function ask(endpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'deliver-it-data-prep' },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!response.ok) throw new Error(`${endpoint} answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
  return response.json()
}

let answer = null
for (const endpoint of ENDPOINTS) {
  try {
    answer = await ask(endpoint)
    break
  } catch (error) {
    console.warn(String(error))
  }
}
if (!answer) throw new Error('No Overpass server answered')
const { elements } = answer

// Which bus routes stop at each stop, by its node id.
const routesAt = new Map()
for (const element of elements) {
  if (element.type !== 'relation') continue
  const ref = element.tags?.ref ?? element.tags?.name
  if (!ref) continue
  for (const member of element.members ?? []) {
    if (member.type !== 'node') continue
    const list = routesAt.get(member.ref) ?? new Set()
    list.add(ref)
    routesAt.set(member.ref, list)
  }
}

const features = []
for (const element of elements) {
  if (element.type === 'relation') continue
  const properties = { '@id': `${element.type}/${element.id}`, ...element.tags }
  if (element.type === 'node') {
    const routes = routesAt.get(element.id)
    if (routes) properties.routes = [...routes].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(';')
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [element.lon, element.lat] } })
  } else if (element.geometry) {
    const coordinates = element.geometry.map(({ lon, lat }) => [lon, lat])
    const closed = coordinates.length > 3 && coordinates[0][0] === coordinates.at(-1)[0] && coordinates[0][1] === coordinates.at(-1)[1]
    const area = closed && (element.tags?.railway === 'station' || element.tags?.amenity === 'bus_station')
    features.push({ type: 'Feature', properties, geometry: area ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates } })
  }
}

writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }))
const count = (test) => features.filter((feature) => test(feature.properties)).length
console.log(`${features.length} features:`, {
  lines: count((p) => /subway|light_rail|rail|construction/.test(p.railway ?? '') && !p.highway),
  stations: count((p) => p.railway === 'station' || p.public_transport === 'station'),
  entrances: count((p) => p.railway === 'subway_entrance'),
  busStops: count((p) => p.highway === 'bus_stop' || p.bus === 'yes'),
  busStopsWithRoutes: count((p) => p.routes),
  busStations: count((p) => p.amenity === 'bus_station'),
})
