import type { LineFeature } from './mapData'
import { nearestRoadPiece, type RoadIndex } from './props'
import type { ShopFront } from './shopFrontPlacement'
import { streetPresetOf, streetRandom, type StreetPreset } from './streetPresets'
import type { GroundPoint } from './worldUtils'
import { IDLE_POSE } from '../traffic/gait'

/*
 * Where people stand about at shops, and walk past them (drawn by
 * ShopPeople.tsx), on every street with a preset (streetPresets.ts), which
 * says how many: busy on a shop street, a few on a residential one. Each
 * street's people are seeded from the street, so they're the same every visit.
 *
 * - A shopkeeper at some shops, in the doorway beside the counter.
 * - Customers at the counter of darshinis, chaat and tea stalls, and now and
 *   then at a kirana: one to three, not in a neat row.
 * - Now and then two people talking on the footpath outside a shop.
 * - A few walkers, pacing a clear stretch of footpath along the shop fronts and
 *   stopping at the ends, as people do when they're looking for a shop.
 *
 * Standing people each get something to do (IDLE_POSE): shift their weight,
 * look at a phone, or talk.
 */

/** Which body: the man or the teen, the models used in traffic. */
export type Body = 0 | 1
export type ShopPerson = {
  x: number
  z: number
  heading: number
  body: Body
  tint: number
  skin: number
  /** What they're doing (IDLE_POSE). */
  idle: number
  /** Where they are in their own idle movements, so no two move in step. */
  phase: number
  /** Waiting at a bus stop: where the stop is and which way its shelter runs. They get on when a bus pulls up (ShopPeople.tsx). */
  stop?: { x: number; z: number; alongX: number; alongZ: number }
}

/** Someone walking to and fro between two points on the footpath. */
export type ShopWalker = {
  from: [number, number]
  to: [number, number]
  body: Body
  tint: number
  skin: number
  /** Metres per second. */
  speed: number
  /** Where along the way they start, from 0 to 1. */
  start: number
  /** How long they stand at each end, in seconds. */
  pause: number
}

export type ShopLife = { standing: ShopPerson[]; walkers: ShopWalker[] }

const COUNTER_SHOPS = new Set(['darshini', 'chats', 'chai', 'coffee'])
/** A kirana has a customer this much less often than a counter shop has them. */
const KIRANA_CUSTOMER_SHARE = 0.45

/**
 * Walkers keep to a lane this far out from the shop walls: clear of counters
 * and fridges (about 0.6 out), and of the scooters parked across the footpath
 * (from about 1.15 out; see PARKING_DISTANCE in props.ts).
 */
const WALK_LANE = 0.85
/** How near to a standing person or a menu board the lane may pass, in metres. Shopkeepers stand inside `KEEPER_OUT`, just clear of it. */
const WALK_CLEARANCE = 0.42
const KEEPER_OUT: [number, number] = [0.22, 0.4]
/** No two walkers' stretches start nearer than this, in metres. How many shops have one is the street preset's. */
const WALKER_SPACING = 6
/** A walker's stretch is at least this long, and reaches at most this far each way from its shop, in metres. */
const MIN_WALK = 4
const MAX_REACH = 9
const WALK_STEP = 0.5

type Placed = { shop: ShopFront; outX: number; outZ: number; rightX: number; rightZ: number; preset: StreetPreset; random: () => number }

/** Things sorted into squares, for finding those near a point without looking at every one on the map. */
class Grid<T> {
  private readonly cells = new Map<string, T[]>()
  private readonly size: number
  constructor(size: number) {
    this.size = size
  }
  add(x: number, z: number, item: T) {
    const key = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`
    const list = this.cells.get(key)
    if (list) list.push(item)
    else this.cells.set(key, [item])
  }
  /** Whether any item in the squares round (x, z) passes `test`. Items further than one square away aren't looked at. */
  some(x: number, z: number, test: (item: T) => boolean): boolean {
    const cx = Math.floor(x / this.size)
    const cz = Math.floor(z / this.size)
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        if ((this.cells.get(`${i},${j}`) ?? []).some(test)) return true
      }
    }
    return false
  }
}

/** What a standing person does, picked by the shares given (`[still, weight, phone]`). */
function pickPose(random: () => number, [still, weight]: [number, number, number]): number {
  const roll = random()
  if (roll < still) return IDLE_POSE.still
  if (roll < still + weight) return IDLE_POSE.weight
  return IDLE_POSE.phone
}

/** Plans who stands where, and who walks where, in each shop's own frame turned out into the world. */
export function planShopPeople(shopFronts: ShopFront[], roads: LineFeature[], index: RoadIndex): ShopLife {
  const standing: ShopPerson[] = []
  const placed: Placed[] = []

  for (const shop of shopFronts) {
    const near = nearestRoadPiece(index, shop.x, shop.z, 14)
    const road = near ? roads[near.piece.road] : null
    const preset = road ? streetPresetOf(road) : null
    if (!road || !preset) continue
    // Seeded by the street and the shop's place on it, so the same people are at the same shops on every visit.
    const random = streetRandom(road, Math.abs(Math.round(shop.x * 13 + shop.z * 7)))
    const { people } = preset
    const outX = Math.sin(shop.rotation)
    const outZ = Math.cos(shop.rotation)
    const rightX = Math.cos(shop.rotation)
    const rightZ = -Math.sin(shop.rotation)
    placed.push({ shop, outX, outZ, rightX, rightZ, preset, random })
    // The counter's side, as shopFrontKit.ts puts it.
    const side = shop.variation < 0.5 ? 1 : -1
    const at = (across: number, out: number, heading: number, body: Body, idle: number, phase = random() * 50) =>
      standing.push({
        x: shop.x + rightX * across + outX * out,
        z: shop.z + rightZ * across + outZ * out,
        heading,
        body,
        tint: random(),
        skin: 0.72 + random() * 0.33,
        idle,
        phase,
      })
    const facingOut = shop.rotation
    const facingIn = shop.rotation + Math.PI
    const someone = (): Body => (random() < 0.7 ? 0 : 1)

    if (random() < people.keeper) {
      // On the side the counter leaves free, as shopFrontKit.ts lays it out, though not always in the same spot.
      at(-side * shop.width * (0.06 + random() * 0.12), KEEPER_OUT[0] + random() * (KEEPER_OUT[1] - KEEPER_OUT[0]), facingOut + (random() - 0.5) * 1.1, someone(), pickPose(random, [0.3, 0.4, 0.3]))
    }
    if (COUNTER_SHOPS.has(shop.type) && random() < people.customers) {
      const count = 1 + Math.floor(random() * 3)
      let across = side * shop.width * 0.22 - (count - 1) * 0.35
      for (let i = 0; i < count; i++) {
        at(across + (random() - 0.5) * 0.2, 0.95 + random() * 0.6, facingIn + (random() - 0.5) * 1.2, someone(), pickPose(random, [0.4, 0.4, 0.2]))
        across += 0.55 + random() * 0.35
      }
    } else if (shop.type === 'kirana' && random() < people.customers * KIRANA_CUSTOMER_SHARE) {
      at(side * shop.width * (0.15 + random() * 0.2), 0.95 + random() * 0.4, facingIn + (random() - 0.5) * 0.8, someone(), pickPose(random, [0.4, 0.45, 0.15]))
    } else if (random() < people.pair) {
      // Two people talking: facing each other across a little under a metre, at an angle to the wall.
      const across = (random() - 0.5) * shop.width * 0.5
      const out = 1.25 + random() * 0.35
      const turn = (random() - 0.5) * 1.2
      const dx = Math.cos(turn) * 0.42
      const dz = Math.sin(turn) * 0.42
      const toward = Math.atan2(rightX * dx + outX * dz, rightZ * dx + outZ * dz)
      const phase = random() * 50
      at(across - dx, out - dz, toward + (random() - 0.5) * 0.3, someone(), IDLE_POSE.chat, phase)
      // Half a turn of the talking rhythm apart, so they take turns.
      at(across + dx, out + dz, toward + Math.PI + (random() - 0.5) * 0.3, someone(), IDLE_POSE.chat, phase + Math.PI / 3.7)
    }
  }

  return { standing, walkers: planWalkers(placed, standing) }
}

/**
 * Walkers pace a stretch of footpath along the shop fronts. A stretch carries
 * on from a shop for as long as the lane is in front of a shop facing the same
 * way, and clear of anyone standing and of menu boards.
 */
function planWalkers(placed: Placed[], standing: ShopPerson[]): ShopWalker[] {
  const walkers: ShopWalker[] = []
  const walkerGrid = new Grid<ShopWalker>(WALKER_SPACING)
  // Shops by where their lane is, and people and menu boards by where they stand.
  const shopGrid = new Grid<Placed>(12)
  for (const item of placed) shopGrid.add(item.shop.x, item.shop.z, item)
  const blockers = new Grid<GroundPoint>(2)
  for (const person of standing) blockers.add(person.x, person.z, [person.x, person.z])
  for (const { shop } of placed) if (shop.menuBoard) blockers.add(shop.menuBoard[0], shop.menuBoard[1], shop.menuBoard)

  const isClear = (x: number, z: number, rotation: number) => {
    const inFront = shopGrid.some(x, z, ({ shop, rightX, rightZ, outX, outZ }) => {
      if (Math.abs(Math.atan2(Math.sin(shop.rotation - rotation), Math.cos(shop.rotation - rotation))) > 0.25) return false
      const dx = x - shop.x
      const dz = z - shop.z
      const out = dx * outX + dz * outZ
      const along = dx * rightX + dz * rightZ
      return Math.abs(out - WALK_LANE) < 0.35 && Math.abs(along) < shop.width / 2 + 1.2
    })
    if (!inFront) return false
    return !blockers.some(x, z, ([bx, bz]) => Math.hypot(bx - x, bz - z) < WALK_CLEARANCE)
  }

  for (const { shop, outX, outZ, rightX, rightZ, preset, random } of placed) {
    if (random() > preset.people.walker) continue
    if (walkerGrid.some(shop.x, shop.z, ({ from, to }) => Math.hypot((from[0] + to[0]) / 2 - shop.x, (from[1] + to[1]) / 2 - shop.z) < WALKER_SPACING)) continue
    // From the shop's middle, or a little to one side if someone's standing there.
    const start = [0, -1.5, 1.5].find((along) => isClear(shop.x + outX * WALK_LANE + rightX * along, shop.z + outZ * WALK_LANE + rightZ * along, shop.rotation))
    if (start === undefined) continue
    const laneX = shop.x + outX * WALK_LANE + rightX * start
    const laneZ = shop.z + outZ * WALK_LANE + rightZ * start
    const reach = (direction: number) => {
      let distance = 0
      while (distance + WALK_STEP <= MAX_REACH && isClear(laneX + rightX * direction * (distance + WALK_STEP), laneZ + rightZ * direction * (distance + WALK_STEP), shop.rotation)) {
        distance += WALK_STEP
      }
      return distance
    }
    const left = reach(-1)
    const right = reach(1)
    if (left + right < MIN_WALK) continue
    const walker: ShopWalker = {
      from: [laneX - rightX * (left - 0.3), laneZ - rightZ * (left - 0.3)],
      to: [laneX + rightX * (right - 0.3), laneZ + rightZ * (right - 0.3)],
      body: random() < 0.6 ? 0 : 1,
      tint: random(),
      skin: 0.72 + random() * 0.33,
      speed: 1.05 + random() * 0.35,
      start: random(),
      pause: 1 + random() * 3,
    }
    walkers.push(walker)
    walkerGrid.add((walker.from[0] + walker.to[0]) / 2, (walker.from[1] + walker.to[1]) / 2, walker)
  }
  return walkers
}
