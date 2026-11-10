import type { DeliveryTier, Mission, MissionStop, WaitingCustomer } from '../game/gameTypes'
import { DARK_STORE_NAME, DELIVERY_TIERS, MISSION_RULES } from '../game/missionConfig'
import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { DarkStore } from '../world/darkStore'
import {
  createRouteField,
  findNearestNode,
  type RoadGraph,
  type RouteField,
} from '../world/roadGraph'
import { isInsideBounds } from '../world/worldUtils'

export type MissionPlanner = {
  collisions: CollisionWorld
  graph: RoadGraph
  store: DarkStore
  /** Finds the route to a road point, remembering each one so it's only worked out once. */
  getRouteField: (node: number) => RouteField
  planMission: (fromX: number, fromZ: number) => Mission
}

/** How far back from the road's edge a customer stands, in metres, best first. */
const KERB_GAPS = [1.2, 0.6, 0, -1, -2]
const WAITING_CLEARANCE = 0.5

function pickRandom<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

function rollTier(random: () => number): DeliveryTier {
  let roll = random()
  for (const tier of DELIVERY_TIERS) {
    roll -= tier.chance
    if (roll < 0) return tier
  }
  return DELIVERY_TIERS[0]
}

/**
 * Every order starts at the dark store. This finds each road point a customer
 * could use, then builds random missions from them. `random` can be swapped
 * out, so tests can repeat the same sequence.
 */
export function createMissionPlanner(
  store: DarkStore,
  collisions: CollisionWorld,
  graph: RoadGraph,
  random: () => number = Math.random,
): MissionPlanner {
  const routeFields = new Map<number, RouteField>()
  const getRouteField = (node: number): RouteField => {
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

  const fromStore = getRouteField(store.node)
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

  const planMission = (fromX: number, fromZ: number): Mission => {
    const start = findNearestNode(graph, fromX, fromZ)

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
    const wanted = rollTier(random)
    const tier = [wanted, ...DELIVERY_TIERS].find((option) => customersFor(option).length > 0) ?? wanted
    const customer = pickRandom(customersFor(tier), random)
    lastCustomer = customer

    const routeLength = fromStore.distance[start] + fromStore.distance[customer]
    const road = graph.roadNames[customer]

    return {
      tier,
      pickup: createStop(
        store.node,
        DARK_STORE_NAME,
        'Collect the order',
        'Slow down to collect',
        MISSION_RULES.pickupColor,
      ),
      customer: createStop(
        customer,
        road ? `Customer on ${road}` : 'The customer',
        'Deliver the order',
        'Slow down to deliver',
        MISSION_RULES.customerColor,
      ),
      waiting: findWaitingSpot(customer),
      onTimeSeconds: Math.max(
        MISSION_RULES.minOnTimeSeconds,
        Math.ceil(routeLength / MISSION_RULES.onTimeRouteSpeed),
      ),
    }
  }

  return { collisions, graph, store, getRouteField, planMission }
}
