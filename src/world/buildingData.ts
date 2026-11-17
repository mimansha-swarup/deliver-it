import type { BuildingKind } from './buildingKinds'
import type { BuildingFeature, PolygonFeature } from './mapData'
import { lonLatToLocal } from './worldUtils'

/** Height of one storey, in metres. */
export const FLOOR_HEIGHT = 3.2

/**
 * House paint, as HSR's independent houses are (ART_DIRECTION.md): colourful
 * plaster, not only beige. Pinks, mints, yellows and terracotta, with off-white
 * and cream still common. Repeats make a colour more likely. Shared by the walls
 * and the house kit's details, so a house's balconies and compound wall match its
 * walls. The weathering (weathering.ts) fades and grimes them, so they can be
 * a little brighter here than they look in the game.
 */
export const HOUSE_COLORS = [
  '#efe7d6', // off-white
  '#efe7d6',
  '#ecdcb6', // cream
  '#e3d3b8', // beige
  '#eab8b0', // pink
  '#dc9e94', // dusty rose
  '#bfe0c9', // mint
  '#9fcfc6', // sea green
  '#cfe0b4', // pistachio
  '#f2d27c', // yellow
  '#e8b950', // turmeric
  '#c97b55', // terracotta
  '#d98f68', // brick orange
  '#f1c6a0', // peach
  '#b9d3e4', // sky blue
  '#cdbfe0', // lilac
]

/** Blocks of flats: whites, greys and sand, with some pale pink, mint, blue and yellow. A little cooler than houses. */
export const APARTMENT_COLORS = ['#ece6da', '#e8e0d0', '#d8d4cc', '#f0d9b8', '#c9dfd0', '#e9c6c0', '#bcd0dc', '#efd7a0']

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
  temple: { lowest: 1, extra: 1 },
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
