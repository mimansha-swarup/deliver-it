/** Each stage of a delivery, in order. */
export type MissionPhase = 'toPickup' | 'toCustomer' | 'delivered'

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

export type Mission = {
  pickup: MissionStop
  customer: MissionStop
  /** Finish within this time for the bonus. It depends on the route's length. */
  onTimeSeconds: number
}

export type Reward = {
  baseCredits: number
  onTimeCredits: number
  xp: number
  seconds: number
  onTime: boolean
}
