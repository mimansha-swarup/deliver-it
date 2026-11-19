/*
 * Places to eat and rest: the chai stalls and darshinis among the shop fronts. On foot, the rider
 * walks in (a room, game/rooms.ts), orders at the counter, and comes out fresh: the next few
 * customers tip a little more for a rider who isn't frazzled. Every menu and price is made up.
 */

export type Eatery = { x: number; z: number; outX: number; outZ: number; kind: 'chai' | 'darshini' }

export const eateries: { list: Eatery[] } = { list: [] }

/** What's ordered at each kind of place, what it costs, and how long it takes to have, in game minutes. */
export const MEALS = {
  chai: { order: 'Chai and a bun', price: 25, minutes: 8, said: 'Bisi bisi chai! And one bun maska.', having: 'A hot chai and a bun, standing at the table' },
  darshini: { order: 'Idli vada and a coffee', price: 55, minutes: 14, said: 'One plate idli vada, one by-two coffee. Token number 14!', having: 'Idli, vada and a filter coffee, standing at the table' },
} as const

/** After eating, this many deliveries are tipped this much more. */
export const FRESH = { deliveries: 3, tipShare: 0.15 }

/** The eatery whose door is within reach of a point, if any. The door is a step out from its front. */
export function eateryAt(x: number, z: number, reach: number): Eatery | null {
  for (const eatery of eateries.list) {
    if (Math.hypot(eatery.x + eatery.outX * 1.0 - x, eatery.z + eatery.outZ * 1.0 - z) < reach) return eatery
  }
  return null
}
