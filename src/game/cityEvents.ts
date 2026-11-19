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

/** A line for the radio about each thing on the roads now, in the RJ's Kanglish. */
export function eventNews(): string[] {
  return cityEvents.active.map(({ kind, road }) => {
    const where = road || 'one of the cross roads'
    if (kind === 'bus') return `A city bus has broken down on ${where}. One lane is blocked, swalpa adjust maadi.`
    if (kind === 'dig') return `${where} is dug up for pipe work, as usual. Road closed, bere route thogoli.`
    if (kind === 'wedding') return `A wedding procession is on ${where}, band and all. Slow hogi, and wish the couple.`
    return `One cow is sitting in the middle of ${where}, full relaxed. Horn maadbedi, just go around.`
  })
}
