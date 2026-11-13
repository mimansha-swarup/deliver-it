import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { LineFeature } from './mapData'
import { createRandom, indexRoadPieces, isClearOfRoads, PointGrid, scramble, toRoadPieces, type Prop, type RoadsideProps } from './props'
import { isInsideBounds, type GroundPoint } from './worldUtils'

/** A street name board on a pole. `alongX`, `alongZ` is the way its road runs, which the board faces. */
export type StreetSign = { x: number; z: number; alongX: number; alongZ: number; name: string }

export type StreetLife = {
  /** Pushcarts on the pavement. `variation` picks what one sells. */
  carts: Prop[]
  signs: StreetSign[]
}

/** How many kinds of cart there are: tender coconuts, vegetables, flowers. */
export const CART_KINDS = 3
export function cartKind({ variation }: Prop): number {
  return Math.floor(variation * CART_KINDS * 0.999)
}

/**
 * Carts stand at the back of the pavement, this far from the kerb, in metres.
 * People walk 0.7 m from the kerb and need 0.4 m clear, so the cart leaves them room.
 */
const CART = { fromKerb: 2, radius: 0.75, wallGap: 0.95, minRoad: 5, minPiece: 12, spacing: 55, chance: 0.5, propGap: 2.2 }
/** Name boards stand in line with the lamp posts. */
const SIGN = { fromKerb: 1.35, radius: 0.08, wallGap: 0.95, intoRoad: 7, minPiece: 8, sameName: 140, anyName: 14, propGap: 1.5 }
const EDGE_MARGIN = 5

/**
 * Puts vendors' carts and street name boards along the roads. Both are solid.
 * It runs after the trees, lamps and parked scooters, and keeps clear of them.
 */
export function placeStreetLife(roads: LineFeature[], collisions: CollisionWorld, props: RoadsideProps): StreetLife {
  const random = createRandom(20261113)
  const pieces = toRoadPieces(roads)
  const roadIndex = indexRoadPieces(pieces)
  const taken = new PointGrid(4)
  for (const { x, z } of [...props.trees, ...props.lamps, ...props.parkedScooters]) taken.add(x, z)
  const life: StreetLife = { carts: [], signs: [] }

  const isFree = (x: number, z: number, wallGap: number, roadGap: number, propGap: number) =>
    isInsideBounds(x, z, EDGE_MARGIN) &&
    !isNearBuilding(collisions, x, z, wallGap) &&
    isClearOfRoads(roadIndex, x, z, roadGap) &&
    !taken.hasWithin(x, z, propGap)

  for (const piece of pieces) {
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length === 0) continue
    const alongX = (piece.end[0] - piece.start[0]) / length
    const alongZ = (piece.end[1] - piece.start[1]) / length
    const spot = (along: number, offset: number): GroundPoint => [
      piece.start[0] + alongX * along + alongZ * offset,
      piece.start[1] + alongZ * along - alongX * offset,
    ]

    // ---- A name board near the start of a named road ----
    const name = roads[piece.road].properties.name
    if (name && length >= SIGN.minPiece) {
      const side = scramble(piece.road) % 2 ? 1 : -1
      const [x, z] = spot(Math.min(SIGN.intoRoad, length / 2), (piece.width / 2 + SIGN.fromKerb) * side)
      const crowded = life.signs.some((sign) => {
        const distance = Math.hypot(sign.x - x, sign.z - z)
        return distance < SIGN.anyName || (sign.name === name && distance < SIGN.sameName)
      })
      if (!crowded && isFree(x, z, SIGN.wallGap, SIGN.fromKerb - 0.3, SIGN.propGap)) {
        life.signs.push({ x, z, alongX, alongZ, name })
        taken.add(x, z)
        addPost(collisions, x, z, SIGN.radius)
      }
    }

    // ---- A vendor's cart half way along ----
    if (piece.width < CART.minRoad || length < CART.minPiece || random() > CART.chance) continue
    const side = random() < 0.5 ? 1 : -1
    const variation = random()
    const [x, z] = spot(length / 2, (piece.width / 2 + CART.fromKerb) * side)
    if (life.carts.some((cart) => Math.hypot(cart.x - x, cart.z - z) < CART.spacing)) continue
    if (!isFree(x, z, CART.wallGap, CART.fromKerb - CART.radius, CART.propGap)) continue

    // Its long side runs along the road.
    life.carts.push({ x, z, rotation: Math.atan2(-alongZ, alongX), variation })
    taken.add(x, z)
    addPost(collisions, x, z, CART.radius)
  }

  return life
}

const KANNADA_LETTERS: Record<string, string> = { A: 'ಎ', B: 'ಬಿ', C: 'ಸಿ', D: 'ಡಿ', E: 'ಇ' }

/**
 * The Kannada for a numbered road, as "17ನೇ ಅಡ್ಡ ರಸ್ತೆ" for "17th Cross Road". Roads
 * named after people and places return null, as transliterating them is guesswork.
 */
export function toKannadaRoadName(name: string): string | null {
  if (name === 'Main Road') return 'ಮುಖ್ಯ ರಸ್ತೆ'
  const match = /^(\d+)(?:st|nd|rd|th)?\s*([A-E])?\s+(Main|Cross)\b/.exec(name)
  if (!match) return null
  const letter = match[2] ? ` ${KANNADA_LETTERS[match[2]]}` : ''
  return `${match[1]}ನೇ${letter} ${match[3] === 'Main' ? 'ಮುಖ್ಯ ರಸ್ತೆ' : 'ಅಡ್ಡ ರಸ್ತೆ'}`
}
