import type { LineFeature } from './mapData'
import { createRandom, nearestRoadPiece, type RoadIndex } from './props'
import type { ShopFront } from './shopFrontPlacement'
import { usesNewGround } from './streetEdgeConfig'

/*
 * Where people stand about at shops (drawn by ShopPeople.tsx): a shopkeeper in
 * the doorway of some shops, and customers at the counter of darshinis, chaat
 * and tea stalls, now and then at a kirana. Only on the streets with the new
 * ground for now (27th Main), so there are a few dozen, not thousands.
 */

/** Which body: the man, the teen or the woman, as in traffic. */
export type Body = 0 | 1 | 2
export type ShopPerson = { x: number; z: number; heading: number; body: Body; tint: number; skin: number }

const KEEPER_SHARE = 0.45
const COUNTER_SHOPS = new Set(['darshini', 'chats', 'chai', 'coffee'])
const KIRANA_CUSTOMER_SHARE = 0.4

/** Plans who stands where: in the shop's own frame, then turned out into the world. */
export function planShopPeople(shopFronts: ShopFront[], roads: LineFeature[], index: RoadIndex): ShopPerson[] {
  const people: ShopPerson[] = []
  const random = createRandom(27027)
  for (const shop of shopFronts) {
    const near = nearestRoadPiece(index, shop.x, shop.z, 14)
    if (!near || !usesNewGround(roads[near.piece.road])) continue
    const outX = Math.sin(shop.rotation)
    const outZ = Math.cos(shop.rotation)
    const rightX = Math.cos(shop.rotation)
    const rightZ = -Math.sin(shop.rotation)
    // The counter's side, as shopFrontKit.ts puts it.
    const side = shop.variation < 0.5 ? 1 : -1
    const at = (across: number, out: number, heading: number, body: Body) =>
      people.push({
        x: shop.x + rightX * across + outX * out,
        z: shop.z + rightZ * across + outZ * out,
        heading,
        body,
        tint: random(),
        skin: 0.72 + random() * 0.33,
      })
    const facingOut = shop.rotation
    const facingIn = shop.rotation + Math.PI

    if (random() < KEEPER_SHARE) at(-side * shop.width * 0.12, 0.42, facingOut + (random() - 0.5) * 0.5, random() < 0.75 ? 0 : 2)
    if (COUNTER_SHOPS.has(shop.type)) {
      const count = 2 + Math.floor(random() * 2)
      for (let i = 0; i < count; i++) {
        at(side * shop.width * 0.22 + (i - (count - 1) / 2) * 0.62, 1.05 + random() * 0.4, facingIn + (random() - 0.5) * 0.7, Math.floor(random() * 3) as Body)
      }
    } else if (shop.type === 'kirana' && random() < KIRANA_CUSTOMER_SHARE) {
      at(side * shop.width * 0.25, 1.0, facingIn + (random() - 0.5) * 0.5, random() < 0.5 ? 2 : 0)
    }
  }
  return people
}

