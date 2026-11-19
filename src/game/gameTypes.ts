import type { OrderStory } from '../missions/orderStory'

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

/** What happens at the door: nothing special, a dog barks first, "keep it outside", or they try it on. */
export type DoorScene = 'plain' | 'dog' | 'outside' | 'tryOn'

/**
 * Where an order is handed over. `kerb`: the customer waits by the road, as when no door is near.
 * `house`: at the gate or the front door, after ringing the bell. `flat`: up the stairs or the lift
 * to their floor. `society`: a flat in the gated society, past the guard (the OTP, the register).
 */
export type DoorPlan = {
  kind: 'kerb' | 'house' | 'flat' | 'society'
  /** Where the bell is rung (a house) or the building is entered (flats), and the way the door faces. */
  x: number
  z: number
  outX: number
  outZ: number
  /** Whether the bell is at a compound gate rather than the front door itself. */
  atGate: boolean
  /** A flat's floor and number, and its building's name. */
  floor: number
  flat: string
  building: string
  scene: DoorScene
  /** The four digits the guard asks for. */
  otp: string
  liftWorks: boolean
}

/**
 * A standard order; a rush order, with a tighter timer and a bigger on-time
 * bonus; or a double drop, with two customers on the one trip.
 */
export type OrderKind = 'standard' | 'rush' | 'double'

/** A customer to deliver to, the person waiting there, and what they ordered. */
export type Drop = { customer: MissionStop; waiting: WaitingCustomer; story: OrderStory; door: DoorPlan }

export type Mission = {
  kind: OrderKind
  tier: DeliveryTier
  pickup: MissionStop
  /** The customer being delivered to now. */
  customer: MissionStop
  waiting: WaitingCustomer
  /** The door it's delivered to (game/doorsteps.ts). */
  door: DoorPlan
  /** Who the order is for and what's in it. */
  story: OrderStory
  /** Customers still to come after this one, on a double drop. */
  nextDrops: Drop[]
  /** How many customers the order has in all. Each pays the base reward. */
  dropCount: number
  /** Finish within this time for the bonus. It depends on the route's length. */
  onTimeSeconds: number
  /** The whole trip by road, from the rider to the store and on to the last customer, in metres. */
  routeLength: number
}

export type Reward = {
  kind: OrderKind
  baseCredits: number
  distanceCredits: number
  onTimeCredits: number
  cleanRideCredits: number
  /** Extra for working after dark, once it's unlocked. */
  nightCredits: number
  /** Extra for a busy time of day, such as the lunch rush, and its name. */
  peakCredits: number
  peakLabel: string
  crashes: number
  xp: number
  seconds: number
  onTime: boolean
  /** The last customer's rating, from 1 to 5, and their tip, which is always extra. */
  stars: number
  tipCredits: number
  /** Why stars were lost, and what the customer said. */
  starsLost: string[]
  reaction: string
  customer: string
}
