/** Each stage of a delivery, in order. */
export type MissionPhase =
  | 'toPickup'
  /** The staff member is handing over the parcel. */
  | 'collecting'
  | 'toCustomer'
  /** The customer is taking the parcel. */
  | 'handingOver'
  | 'delivered'

export type MissionStop = {
  x: number
  z: number
  /** The point on the road network this stop sits on. */
  node: number
  name: string
  /** What the player is told to do on the way here. */
  objective: string
  /** Shown once inside the zone. */
  arrivalHint: string
  color: string
}

export type DeliveryTier = {
  label: string
  /** The rider must be at least this level for orders this long. */
  minLevel: number
  minRoute: number
  maxRoute: number
  chance: number
  extraCredits: number
  extraXp: number
}

/** The person waiting for an order. */
export type WaitingCustomer = {
  x: number
  z: number
  /** Which way they face, in radians around Y. */
  rotation: number
  /** Which of the people models they are, from 0 to 1. */
  look: number
  /** A 0 to 1 value used to pick their clothes. */
  tint: number
}

/**
 * A standard order; a rush order, with a tighter timer and a bigger on-time
 * bonus; or a double drop, with two customers on the one trip.
 */
export type OrderKind = 'standard' | 'rush' | 'double'

/** A customer to deliver to, and the person waiting there. */
export type Drop = { customer: MissionStop; waiting: WaitingCustomer }

export type Mission = {
  kind: OrderKind
  tier: DeliveryTier
  pickup: MissionStop
  /** The customer being delivered to now. */
  customer: MissionStop
  waiting: WaitingCustomer
  /** Customers still to come after this one, on a double drop. */
  nextDrops: Drop[]
  /** How many customers the order has in all. Each pays the base reward. */
  dropCount: number
  /** Finish within this time for the bonus. It depends on the route's length. */
  onTimeSeconds: number
}

export type Reward = {
  kind: OrderKind
  baseCredits: number
  distanceCredits: number
  onTimeCredits: number
  cleanRideCredits: number
  /** Extra for working after dark, once it's unlocked. */
  nightCredits: number
  crashes: number
  xp: number
  seconds: number
  onTime: boolean
}
