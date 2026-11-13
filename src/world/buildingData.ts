import type { BuildingKind } from './buildingKinds'
import type { BuildingFeature, PolygonFeature } from './mapData'
import { lonLatToLocal } from './worldUtils'

/** Height of one storey, in metres. */
export const FLOOR_HEIGHT = 3.2

/**
 * House paint, as HSR's independent houses mostly are: off-white, cream and
 * beige, with now and then a pale pastel or a bolder colour. Repeats make the
 * common ones more likely. Shared by the walls and the house kit's details, so a
 * house's balconies and compound wall match its walls.
 */
export const HOUSE_COLORS = [
  '#f1ead8', // off-white
  '#f1ead8',
  '#efe3bf', // cream
  '#efe3bf',
  '#e9dcc3', // beige
  '#e9dcc3',
  '#f3e6c4', // pale yellow
  '#e6c9a8', // sand
  '#dfe3dc', // pale grey-green
  '#d9c2b8', // dusty pink
  '#cfd9e2', // pale blue
  '#ecd27e', // turmeric
]

/** Blocks of flats: whites, greys and the odd pale blue or sand, a little cooler than houses. */
export const APARTMENT_COLORS = ['#ece6da', '#e8e0d0', '#d8d4cc', '#c9c5bb', '#b9c7cc', '#e0d3c0', '#f0ece4']

/** The paint colour of a house, the same every time for the same house. */
export function getHouseColor(building: { id: string }): string {
  return HOUSE_COLORS[hashString(building.id) % HOUSE_COLORS.length]
}

/** The paint of any building the house kit dresses, matching its walls. */
export function getKitColor(building: { id: string; kind: string }): string {
  if (building.kind === 'apartment') return APARTMENT_COLORS[hashString(building.id) % APARTMENT_COLORS.length]
  return getHouseColor(building)
}

/**
 * Whether a building stands on stilts: an open ground floor of pillars with
 * parking underneath, as nearly every HSR block of flats does.
 */
export function hasStilts(building: BuildingFeature): boolean {
  return building.kind === 'apartment' && getFloors(building) >= 3
}

/**
 * Turns text into a stable number (FNV-1a hash). A building's "random" height
 * and colour come from its id, so it looks the same on every page load.
 */
export function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  }
  return hash >>> 0
}

/** The area of a building's outline in square metres, by the shoelace formula. */
export function getFootprintArea(building: PolygonFeature): number {
  const points = building.geometry.coordinates[0].slice(0, -1).map(lonLatToLocal)

  let doubled = 0
  points.forEach(([x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]
    doubled += x * nextY - nextX * y
  })
  return Math.abs(doubled) / 2
}

/** The shortest a building of each kind gets, and how many floors it can add to that. */
const FLOOR_RANGES: Record<BuildingKind, { lowest: number; extra: number }> = {
  house: { lowest: 2, extra: 2 },
  apartment: { lowest: 4, extra: 3 },
  shop: { lowest: 2, extra: 3 },
  office: { lowest: 4, extra: 4 },
  civic: { lowest: 2, extra: 2 },
}
/** A house smaller than this is a little single-storey or two-storey place, in square metres. */
const TINY_HOUSE = 60

/** Uses the mapped floor count if there is one, otherwise estimates from its kind. */
export function getFloors(building: BuildingFeature): number {
  const mapped = Number(building.properties['building:levels'])
  if (mapped > 0) return mapped

  const hash = hashString(building.id)
  if (building.kind === 'house' && getFootprintArea(building) < TINY_HOUSE) return 1 + (hash % 2)

  const { lowest, extra } = FLOOR_RANGES[building.kind]
  return lowest + (hash % extra)
}
