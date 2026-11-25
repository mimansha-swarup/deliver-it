import type { DeliveryTier } from './gameTypes'

/** The rules every delivery follows. Locations are chosen by the mission planner. */
export const MISSION_RULES = {
  /** Radius of the ring around each stop, in metres. */
  zoneRadius: 7,
  /** The scooter must be below this speed inside the ring, in metres per second. */
  maxArrivalSpeed: 3,

  /** After accepting, the order's clock waits this long before it starts, in seconds. */
  graceSeconds: 10,

  /** Always paid for a completed delivery, whatever else happens. */
  baseCredits: 50,
  baseXp: 25,

  /** Extra rupees for finishing on time. Missing it costs nothing. */
  onTimeCredits: 25,
  /** A rush order's timer is this share of a normal one, and on time it pays this much more. */
  rushTimeShare: 0.7,
  rushExtraCredits: 40,
  rushExtraXp: 10,
  /** After dark, once unlocked, base and distance pay go up by this share. */
  nightPayShare: 0.25,
  /** How often an order is a rush or a double drop, once unlocked. */
  rushChance: 0.25,
  doubleChance: 0.2,
  /** How often an order is for the gated society (past its guard), when it's in reach. */
  societyChance: 0.12,
  /** A double drop's second customer is this far from the first by road, in metres. */
  secondDropMin: 120,
  secondDropMax: 500,
  /**
   * A batch run: in a vehicle that carries `batchCarries` parcels or more (the cargo three-wheeler,
   * the car, the van), this often the order is four or five customers on the one trip, each a
   * short ride on from the last as a double drop's second is.
   */
  batchCarries: 4,
  batchChance: 0.45,
  batchDrops: [4, 5],
  /** Extra rupees for a delivery with no crashes. Crashing never costs anything else. */
  cleanRideCredits: 10,
  /**
   * The route speed the on-time limit is based on, in metres per second. It was
   * 6.7 until the scooter's pick-up was made gentler and speed breakers arrived,
   * which both make each stretch between turns a little slower.
   */
  onTimeRouteSpeed: 6.3,
  minOnTimeSeconds: 30,
  /** Added to every order's time limit for parking at the dark store, walking in, collecting and walking out, in seconds. */
  pickupWalkSeconds: 30,

  /** A new customer is at least this far from the last one, in metres. */
  minCustomerSpacing: 60,

  /** Stops need this much clear space around them, in metres. */
  stopClearance: 2.2,
  /** Stops stay this far inside the edge of the play area, in metres. */
  edgeMargin: 18,

  pickupColor: '#ffb02e',
  customerColor: '#3ddc97',
}

/**
 * Lengths of delivery, by road distance from pickup to customer. `chance` values
 * add up to 1. The extras are paid on top of the base reward, never instead of it.
 */
export const DELIVERY_TIERS: DeliveryTier[] = [
  { label: 'Local', minLevel: 1, minRoute: 180, maxRoute: 450, chance: 0.5, extraCredits: 0, extraXp: 0 },
  { label: 'Across town', minLevel: 1, minRoute: 450, maxRoute: 900, chance: 0.35, extraCredits: 35, extraXp: 15 },
  { label: 'Long haul', minLevel: 2, minRoute: 900, maxRoute: 1500, chance: 0.15, extraCredits: 80, extraXp: 35 },
]

/** A fictional name. No real shop or brand appears in the game. */
export const DARK_STORE_NAME = 'Deliver It dark store'
