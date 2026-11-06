/** The rules every delivery follows. Locations are chosen by the mission planner. */
export const MISSION_RULES = {
  /** Radius of the ring around each stop, in metres. */
  zoneRadius: 7,
  /** The scooter must be below this speed inside the ring, in metres per second. */
  maxArrivalSpeed: 3,

  /** Always paid for a completed delivery, whatever else happens. */
  baseCredits: 50,
  baseXp: 25,

  /** Extra credits for finishing on time. Missing it costs nothing. */
  onTimeCredits: 25,
  /** The route speed the on-time limit is based on, in metres per second. */
  onTimeRouteSpeed: 6.7,
  minOnTimeSeconds: 30,

  /** A customer's road distance from the pickup, in metres. */
  minRouteLength: 180,
  maxRouteLength: 450,
  /** A new customer is at least this far from the last one, in metres. */
  minCustomerSpacing: 60,

  /** How far from a mapped clothing shop a pickup may be, in metres. */
  maxShopDistance: 30,
  /** Stops need this much clear space around them, in metres. */
  stopClearance: 2.2,
  /** Stops stay this far inside the edge of the play area, in metres. */
  edgeMargin: 18,

  pickupColor: '#ffb02e',
  customerColor: '#3ddc97',
}

/** Fictional placeholders. No real shop or brand appears in the game. */
export const PICKUP_NAMES = [
  'The Fashion Hub',
  'Style Corner',
  'The Wardrobe Room',
  'Thread & Needle',
  'The Outfit Depot',
]
