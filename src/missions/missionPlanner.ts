import type { DeliveryTier, Drop, Mission, MissionStop, OrderKind, WaitingCustomer } from '../game/gameTypes'
import { UNLOCK_LEVELS } from '../game/progression'
import type { DayPeriod } from '../game/duty'
import { DARK_STORE_NAME, DELIVERY_TIERS, MISSION_RULES } from '../game/missionConfig'
import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { DarkStore } from '../world/darkStore'
import {
  createRouteField,
  findNearestNode,
  type RoadGraph,
  type RouteField,
  roadClosures,
} from '../world/roadGraph'
import { isInsideBounds } from '../world/worldUtils'
import { createOrderStory, type OrderStory, customerLook } from './orderStory'
import { doorsteps, findDoorstep } from '../game/doorsteps'
import { CARGO } from './cargo'
import type { DoorPlan, DoorScene } from '../game/gameTypes'

export type MissionPlanner = {
  collisions: CollisionWorld
  graph: RoadGraph
  /** The home store first, then the rest across the map. */
  stores: DarkStore[]
  /** Finds the route to a road point, remembering each one so it's only worked out once. */
  getRouteField: (node: number) => RouteField
  /** Plans an order from wherever the rider is. Their `level` decides what kinds of order can come up. */
  /** `period` is the time of day: it sets how often orders are rushes or double drops, and what's ordered. */
  planMission: (fromX: number, fromZ: number, level: number, period?: DayPeriod) => Mission
}

/** How far back from the road's edge a customer stands, in metres, best first. */
const KERB_GAPS = [1.2, 0.6, 0, -1, -2]
const WAITING_CLEARANCE = 0.5

function pickRandom<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

/** Picks a length of trip by chance, from those the rider's level allows. */
function rollTier(level: number, random: () => number): DeliveryTier {
  const allowed = DELIVERY_TIERS.filter(({ minLevel }) => minLevel <= level)
  const total = allowed.reduce((sum, { chance }) => sum + chance, 0)
  let roll = random() * total
  for (const tier of allowed) {
    roll -= tier.chance
    if (roll < 0) return tier
  }
  return allowed[0]
}

/** Rush orders and double drops come up now and then, once the rider's level allows them. */
function rollKind(level: number, random: () => number, period?: DayPeriod): OrderKind {
  const roll = random()
  const doubleChance = period?.doubleChance ?? MISSION_RULES.doubleChance
  const rushChance = period?.rushChance ?? MISSION_RULES.rushChance
  if (level >= UNLOCK_LEVELS.doubleDrop && roll < doubleChance) return 'double'
  if (level >= UNLOCK_LEVELS.rush && roll > 1 - rushChance) return 'rush'
  return 'standard'
}

/**
 * Every order starts at the dark store nearest the rider. This finds each road point a customer
 * could use, then builds random missions from them. `random` can be swapped
 * out, so tests can repeat the same sequence.
 */
export function createMissionPlanner(
  stores: DarkStore[],
  collisions: CollisionWorld,
  graph: RoadGraph,
  random: () => number = Math.random,
): MissionPlanner {
  const routeFields = new Map<number, RouteField>()
  let closuresSeen = roadClosures.version
  const getRouteField = (node: number): RouteField => {
    // A road closed or reopened since (roadGraph.ts): every kept route is stale.
    if (closuresSeen !== roadClosures.version) {
      routeFields.clear()
      closuresSeen = roadClosures.version
    }
    let field = routeFields.get(node)
    if (!field) {
      field = createRouteField(graph, node)
      routeFields.set(node, field)
    }
    return field
  }

  const stopNodes = graph.xs
    .map((_, node) => node)
    .filter(
      (node) =>
        isInsideBounds(graph.xs[node], graph.zs[node], MISSION_RULES.edgeMargin) &&
        !isNearBuilding(collisions, graph.xs[node], graph.zs[node], MISSION_RULES.stopClearance),
    )

  let lastCustomer = -1

  const createStop = (
    node: number,
    name: string,
    objective: string,
    arrivalHint: string,
    color: string,
  ): MissionStop => ({ x: graph.xs[node], z: graph.zs[node], node, name, objective, arrivalHint, color })

  /** A spot on the pavement beside a road point, facing the road. */
  const findWaitingSpot = (node: number): WaitingCustomer => {
    const [link] = graph.links[node]
    const alongX = (graph.xs[link.to] - graph.xs[node]) / link.length
    const alongZ = (graph.zs[link.to] - graph.zs[node]) / link.length
    const sides = random() < 0.5 ? [1, -1] : [-1, 1]

    // On a tight street, the pavement may be too narrow, so they stand nearer the road.
    for (const gap of KERB_GAPS) {
      const out = link.roadWidth / 2 + gap
      for (const side of sides) {
        const x = graph.xs[node] + alongZ * side * out
        const z = graph.zs[node] - alongX * side * out
        if (isNearBuilding(collisions, x, z, WAITING_CLEARANCE)) continue

        return { x, z, rotation: Math.atan2(-alongZ * side, alongX * side), look: random(), tint: random() }
      }
    }

    // Stop points are always clear of walls, so the road itself is the last resort.
    return { x: graph.xs[node], z: graph.zs[node], rotation: 0, look: random(), tint: random() }
  }

  /** The road point outside the gated society's gate, where its orders stop; -1 with no society. Found once. */
  let societyAt: number | null = null
  const societyNode = (): number => {
    if (societyAt === null) {
      const society = doorsteps.society
      societyAt = society ? findNearestNode(graph, society.gate.x + society.door.outX * 5, society.gate.z + society.door.outZ * 5) : -1
    }
    return societyAt
  }

  /** Made-up names for blocks of flats, by where they are, so one building keeps its name. */
  const BUILDINGS = ['Malligai Nilaya', 'Akshaya Residency', 'Kaveri Enclave', 'Tunga Heights', 'Nandi Apartments', 'Gulmohar Court', 'Honge Homes', 'Parijata Towers']
  const buildingName = (x: number, z: number) => BUILDINGS[Math.abs(Math.round(x * 7 + z * 13)) % BUILDINGS.length]
  const SCENES: DoorScene[] = ['plain', 'plain', 'plain', 'dog', 'outside', 'tryOn']
  const WEARABLE = /saree|blazer|dress|sherwani|sneakers|tee|kurta|jeans|hoodie|shoes|shorts|shirt|kurti|pyjamas/i

  /**
   * Where the order is handed over: the front door nearest the stop on the road (a house's gate or
   * door, a flat upstairs, or a flat in the gated society), and where the customer comes out to. With
   * no door near, they wait at the kerb as before.
   */
  const findDoor = (node: number, story: OrderStory): { waiting: WaitingCustomer; door: DoorPlan; extraSeconds: number } => {
    // Who comes to the door goes by the name on the order: Priya is a woman every time (orderStory.ts).
    const kerb = { ...findWaitingSpot(node), look: customerLook(story.customer) }
    const otp = String(1000 + Math.floor(random() * 9000))
    const found = node === societyNode() ? (doorsteps.society?.door ?? null) : findDoorstep(graph.xs[node], graph.zs[node])
    const base = { floor: 0, flat: '', building: '', otp, liftWorks: true, atGate: false }
    if (!found) return { waiting: kerb, door: { kind: 'kerb', x: kerb.x, z: kerb.z, outX: 0, outZ: 1, scene: 'plain', ...base }, extraSeconds: 12 }
    const { outX, outZ } = found
    let scene = pickRandom(SCENES, random)
    // Only clothes and shoes are tried on; Bruno's owner has a dog whatever the dice say.
    if (scene === 'tryOn' && !WEARABLE.test(story.item)) scene = 'plain'
    if (/Bruno/.test(story.note)) scene = 'dog'
    if (found.apartment) {
      const society = doorsteps.society?.door === found
      const floor = 1 + Math.floor(random() * Math.max(1, Math.min(found.floors, 6) - 0.001))
      const flat = `${floor}0${1 + Math.floor(random() * 3)}`
      const building = society ? (doorsteps.society?.name ?? '') : buildingName(found.x, found.z)
      return {
        // Their place upstairs is set when the rider gets to the floor (Errand.tsx): until then, nobody is out.
        waiting: { ...kerb, x: found.x - outX * 0.2, z: found.z - outZ * 0.2, rotation: Math.atan2(outX, outZ) },
        door: { kind: society ? 'society' : 'flat', x: found.x, z: found.z, outX, outZ, scene: scene === 'dog' ? 'plain' : scene, ...base, floor, flat, building, liftWorks: random() > 0.25 },
        extraSeconds: (society ? 75 : 50) + floor * 4,
      }
    }
    // A house: the bell is at its compound gate if it has one, else at the front door. The customer comes to it from inside.
    const at = found.gate ?? found
    const inside = found.gate ? 0.9 : -0.25
    return {
      waiting: { ...kerb, x: at.x - outX * inside, z: at.z - outZ * inside, rotation: Math.atan2(outX, outZ) },
      door: { kind: 'house', x: at.x + outX * (found.gate ? 0.7 : 0.9), z: at.z + outZ * (found.gate ? 0.7 : 0.9), outX, outZ, scene, ...base, atGate: found.gate !== null },
      extraSeconds: 25,
    }
  }

  const customerStop = (node: number, story: OrderStory) => {
    const road = graph.roadNames[node]
    return createStop(
      node,
      road ? `${story.customer} on ${road}` : story.customer,
      'Deliver the order',
      'Slow down to deliver',
      MISSION_RULES.customerColor,
    )
  }

  /** A second customer for a double drop: a short ride on from the first, and not on top of them. */
  const findSecondDrop = (first: number): number | null => {
    const fromFirst = getRouteField(first)
    const options = stopNodes.filter(
      (node) =>
        node !== first &&
        fromFirst.distance[node] >= MISSION_RULES.secondDropMin &&
        fromFirst.distance[node] <= MISSION_RULES.secondDropMax,
    )
    return options.length > 0 ? pickRandom(options, random) : null
  }

  const planMission = (fromX: number, fromZ: number, level: number, period?: DayPeriod): Mission => {
    const start = findNearestNode(graph, fromX, fromZ)
    const store = nearestStore(stores, fromX, fromZ)
    const fromStore = getRouteField(store.node)

    const isFarFromLast = (node: number) =>
      lastCustomer === -1 ||
      Math.hypot(graph.xs[node] - graph.xs[lastCustomer], graph.zs[node] - graph.zs[lastCustomer]) >=
        MISSION_RULES.minCustomerSpacing

    const customersFor = ({ minRoute, maxRoute }: DeliveryTier) =>
      stopNodes.filter(
        (node) =>
          fromStore.distance[node] >= minRoute &&
          fromStore.distance[node] <= maxRoute &&
          isFarFromLast(node),
      )

    // Not every length of trip is always available, so try the others too.
    const wanted = rollTier(level, random)
    const allowed = DELIVERY_TIERS.filter(({ minLevel }) => minLevel <= level)
    const rolled = [wanted, ...allowed].find((option) => customersFor(option).length > 0) ?? wanted
    // Now and then the order is for the gated society, if it's within any trip length the rider may take.
    const gated = societyNode()
    const tierFirst = rolled
    const gatedTier = gated >= 0 && random() < MISSION_RULES.societyChance && isFarFromLast(gated) ? allowed.find(({ minRoute, maxRoute }) => fromStore.distance[gated] >= minRoute && fromStore.distance[gated] <= maxRoute) : undefined
    const customer = gatedTier ? gated : pickRandom(customersFor(tierFirst), random)

    const tier = gatedTier ?? rolled
    let kind = rollKind(level, random, period)
    const second = kind === 'double' ? findSecondDrop(customer) : null
    if (kind === 'double' && second === null) kind = 'standard'
    const story = createOrderStory(random, period?.id)
    let secondStory = createOrderStory(random, period?.id)
    if (secondStory.customer === story.customer) secondStory = createOrderStory(random, period?.id)
    const firstDoor = findDoor(customer, story)
    const secondDoor = second === null ? null : findDoor(second, secondStory)
    const nextDrops: Drop[] =
      second === null || !secondDoor
        ? []
        : [{ customer: customerStop(second, secondStory), waiting: secondDoor.waiting, door: secondDoor.door, story: secondStory }]
    lastCustomer = second ?? customer

    let routeLength = fromStore.distance[start] + fromStore.distance[customer]
    if (second !== null) routeLength += getRouteField(customer).distance[second]
    // The ride, plus the walking at each end: into the dark store and out, and to each door.
    const walking = MISSION_RULES.pickupWalkSeconds + firstDoor.extraSeconds + (secondDoor?.extraSeconds ?? 0)
    const normalTime = Math.max(
      MISSION_RULES.minOnTimeSeconds,
      Math.ceil(routeLength / MISSION_RULES.onTimeRouteSpeed),
    ) + walking

    return {
      kind,
      nextDrops,
      dropCount: 1 + nextDrops.length,
      tier,
      pickup: createStop(
        store.node,
        storeName(store, stores),
        'Collect the order',
        'Slow down to collect',
        MISSION_RULES.pickupColor,
      ),
      customer: customerStop(customer, story),
      waiting: firstDoor.waiting,
      door: firstDoor.door,
      story,
      // A rush order's clock is tighter; so is medicine's (cargo.ts).
      onTimeSeconds: Math.ceil((kind === 'rush' ? normalTime * MISSION_RULES.rushTimeShare : normalTime) * CARGO[story.cargo].timeShare),
      routeLength: Math.round(routeLength),
    }
  }

  return { collisions, graph, stores, getRouteField, planMission }
}

/** The store nearest a spot, as the crow flies. */
export function nearestStore(stores: DarkStore[], x: number, z: number): DarkStore {
  let nearest = stores[0]
  let nearestDistance = Infinity
  for (const store of stores) {
    const distance = Math.hypot(store.x - x, store.z - z)
    if (distance < nearestDistance) {
      nearest = store
      nearestDistance = distance
    }
  }
  return nearest
}

/** The home store goes by its plain name. The others add their road, so the phone can tell them apart. */
function storeName(store: DarkStore, stores: DarkStore[]): string {
  if (store === stores[0] || !store.road) return DARK_STORE_NAME
  return `${DARK_STORE_NAME}, ${store.road}`
}
