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

export type Mission = {
  tier: DeliveryTier
  pickup: MissionStop
  customer: MissionStop
  waiting: WaitingCustomer
  /** Finish within this time for the bonus. It depends on the route's length. */
  onTimeSeconds: number
}

export type Reward = {
  baseCredits: number
  distanceCredits: number
  onTimeCredits: number
  cleanRideCredits: number
  crashes: number
  xp: number
  seconds: number
  onTime: boolean
}
