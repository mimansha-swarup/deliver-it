/*
 * Things that happen on the roads now and then (world/CityEvents.tsx stages them): a bus broken
 * down in a lane, a road dug up for pipe work, a wedding procession, a cow sitting in the road.
 * This is what's on now, for whoever wants to know: the radio's traffic update, the map, the GPS.
 */

export type CityEventKind = 'bus' | 'dig' | 'wedding' | 'cow'

export type CityEvent = {
  kind: CityEventKind
  x: number
  z: number
  /** Along the road, as a unit direction, and the road's name if it has one. */
  dirX: number
  dirZ: number
  road: string
  /** The road is shut here, and the GPS goes round (roadGraph.ts' closures). */
  closes: boolean
  /** Game hours (totalHours) when it began and when it clears. */
  from: number
  until: number
}

export const cityEvents: { active: CityEvent[] } = { active: [] }

