import type { DeliveryTier, Mission, MissionStop } from '../game/gameTypes'
import { DELIVERY_TIERS, MISSION_RULES, PICKUP_NAMES } from '../game/missionConfig'
import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { MapData } from '../world/mapData'
import {
  createRouteField,
  findNearestNode,
  type RoadGraph,
  type RouteField,
} from '../world/roadGraph'
import { isInsideBounds, lonLatToWorld } from '../world/worldUtils'

type PickupSpot = { node: number; name: string }

export type MissionPlanner = {
  collisions: CollisionWorld
  graph: RoadGraph
  /** Finds the route to a road point, remembering each one so it's only worked out once. */
  getRouteField: (node: number) => RouteField
  planMission: (fromX: number, fromZ: number) => Mission
}

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
 * Finds every road point a stop could use, then builds random missions from
 * them. `random` can be swapped out, so tests can repeat the same sequence.
 */
export function createMissionPlanner(
  data: MapData,
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

  // A pickup is the nearest usable road point to each mapped clothing shop.
  const pickups: PickupSpot[] = []
  for (const place of data.places) {
    if (place.properties.shop !== 'clothes') continue

    const [shopX, , shopZ] = lonLatToWorld(place.geometry.coordinates)
    let nearest = -1
    let nearestDistance: number = MISSION_RULES.maxShopDistance
    for (const node of stopNodes) {
      const distance = Math.hypot(graph.xs[node] - shopX, graph.zs[node] - shopZ)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = node
      }
    }

    const alreadyUsed = pickups.some(
      ({ node }) =>
        Math.hypot(graph.xs[node] - graph.xs[nearest], graph.zs[node] - graph.zs[nearest]) < 40,
    )
    if (nearest !== -1 && !alreadyUsed) {
      pickups.push({ node: nearest, name: PICKUP_NAMES[pickups.length % PICKUP_NAMES.length] })
    }
  }

  let lastCustomer = -1
  let lastPickup = -1

  const createStop = (
    node: number,
    name: string,
    objective: string,
    arrivalHint: string,
    color: string,
  ): MissionStop => ({ x: graph.xs[node], z: graph.zs[node], node, name, objective, arrivalHint, color })

  const planMission = (fromX: number, fromZ: number): Mission => {
    const start = findNearestNode(graph, fromX, fromZ)

    // A different pickup from last time, not right on top of the rider, and
    // not a long trek away. With nothing nearby, the closest one will do.
    const distanceTo = ({ node }: PickupSpot) => getRouteField(node).distance[start]
    const pickupChoices = pickups
      .filter((spot) => spot.node !== lastPickup && distanceTo(spot) > 60 && distanceTo(spot) < Infinity)
      .sort((a, b) => distanceTo(a) - distanceTo(b))
    const nearbyPickups = pickupChoices.filter(
      (spot) => distanceTo(spot) <= MISSION_RULES.maxPickupDistance,
    )
    const pickup =
      nearbyPickups.length > 0
        ? pickRandom(nearbyPickups, random)
        : (pickupChoices[0] ?? pickRandom(pickups, random))
    lastPickup = pickup.node
    const fromPickup = getRouteField(pickup.node)

    const isFarFromLast = (node: number) =>
      lastCustomer === -1 ||
      Math.hypot(graph.xs[node] - graph.xs[lastCustomer], graph.zs[node] - graph.zs[lastCustomer]) >=
        MISSION_RULES.minCustomerSpacing

    const customersFor = ({ minRoute, maxRoute }: DeliveryTier) =>
      stopNodes.filter(
        (node) =>
          fromPickup.distance[node] >= minRoute &&
          fromPickup.distance[node] <= maxRoute &&
          isFarFromLast(node),
      )

    // A pickup near the end of the map may have no long routes, so try the others too.
    const wanted = rollTier(random)
    const tier = [wanted, ...DELIVERY_TIERS].find((option) => customersFor(option).length > 0) ?? wanted
    const customer = pickRandom(customersFor(tier), random)
    lastCustomer = customer

    const routeLength = fromPickup.distance[start] + fromPickup.distance[customer]
    const road = graph.roadNames[customer]

    return {
      tier,
      pickup: createStop(
        pickup.node,
        pickup.name,
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
      onTimeSeconds: Math.max(
        MISSION_RULES.minOnTimeSeconds,
        Math.ceil(routeLength / MISSION_RULES.onTimeRouteSpeed),
      ),
    }
  }

  return { collisions, graph, getRouteField, planMission }
}
