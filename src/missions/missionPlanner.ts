import type { Mission, MissionStop } from '../game/gameTypes'
import { MISSION_RULES, PICKUP_NAMES } from '../game/missionConfig'
import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { MapData } from '../world/mapData'
import {
  createRoadGraph,
  createRouteField,
  findNearestNode,
  type RoadGraph,
  type RouteField,
} from '../world/roadGraph'
import { lonLatToWorld, PLAY_AREA_SIZE } from '../world/worldUtils'

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

/**
 * Finds every road point a stop could use, then builds random missions from
 * them. `random` can be swapped out, so tests can repeat the same sequence.
 */
export function createMissionPlanner(
  data: MapData,
  collisions: CollisionWorld,
  random: () => number = Math.random,
): MissionPlanner {
  const graph = createRoadGraph(data.roads)

  const routeFields = new Map<number, RouteField>()
  const getRouteField = (node: number): RouteField => {
    let field = routeFields.get(node)
    if (!field) {
      field = createRouteField(graph, node)
      routeFields.set(node, field)
    }
    return field
  }

  const limit = PLAY_AREA_SIZE / 2 - MISSION_RULES.edgeMargin
  const usableNodes = graph.xs
    .map((_, node) => node)
    .filter(
      (node) =>
        Math.abs(graph.xs[node]) <= limit &&
        Math.abs(graph.zs[node]) <= limit &&
        !isNearBuilding(collisions, graph.xs[node], graph.zs[node], MISSION_RULES.stopClearance),
    )

  // Keep only points joined to the main network, using the middle of the map as a guide.
  const centre = findNearestNode(graph, 0, 0)
  const connectedNodes = usableNodes.filter((node) => getRouteField(centre).distance[node] < Infinity)

  // A pickup is the nearest usable road point to each mapped clothing shop.
  const pickups: PickupSpot[] = []
  for (const place of data.places) {
    if (place.properties.shop !== 'clothes') continue

    const [shopX, , shopZ] = lonLatToWorld(place.geometry.coordinates)
    let nearest = -1
    let nearestDistance: number = MISSION_RULES.maxShopDistance
    for (const node of connectedNodes) {
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

    // A different pickup from last time, and not right on top of the rider.
    const pickupChoices = pickups.filter(({ node }) => {
      const distance = getRouteField(node).distance[start]
      return node !== lastPickup && distance > 60 && distance < Infinity
    })
    const pickup = pickRandom(pickupChoices.length > 0 ? pickupChoices : pickups, random)
    lastPickup = pickup.node
    const fromPickup = getRouteField(pickup.node)

    const isFarFromLast = (node: number) =>
      lastCustomer === -1 ||
      Math.hypot(graph.xs[node] - graph.xs[lastCustomer], graph.zs[node] - graph.zs[lastCustomer]) >=
        MISSION_RULES.minCustomerSpacing

    const customerChoices = connectedNodes.filter(
      (node) =>
        fromPickup.distance[node] >= MISSION_RULES.minRouteLength &&
        fromPickup.distance[node] <= MISSION_RULES.maxRouteLength &&
        isFarFromLast(node),
    )
    const customer = pickRandom(customerChoices, random)
    lastCustomer = customer

    const routeLength = fromPickup.distance[start] + fromPickup.distance[customer]
    const road = graph.roadNames[customer]

    return {
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
