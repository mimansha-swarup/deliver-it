import type { Mission, MissionPhase, MissionStop, Reward } from '../game/gameTypes'
import { MISSION_RULES } from '../game/missionConfig'
import { rateDelivery } from './orderStory'
import type { DayPeriod } from '../game/duty'
import { CARGO } from './cargo'

/** The stop the player is heading for, or null when there isn't one. */
export function getCurrentStop(mission: Mission | null, phase: MissionPhase): MissionStop | null {
  if (!mission) return null
  if (phase === 'toPickup') return mission.pickup
  if (phase === 'toCustomer') return mission.customer
  return null
}

export function hasArrived(distance: number, speed: number): boolean {
  return distance <= MISSION_RULES.zoneRadius && Math.abs(speed) <= MISSION_RULES.maxArrivalSpeed
}

/** How the ride went, besides the time. */
export type RideRecord = {
  crashes?: number
  /** Hard landings while the last customer's order was on board. */
  knocks?: number
  /** 5-star deliveries in a row before this one. */
  streak?: number
  nightPay?: boolean
  /** The time of day, whose rush hours pay more. */
  period?: DayPeriod
  /** How frustrated the customer got, 0 to 1: it sets the stars and the tip. */
  frustration?: number
  /** How roughly the order was carried, judged at the door. */
  roughness?: number
  /** The rush-hour surge, as a share of base and distance pay (game/rush.ts). */
  surge?: number
  /** The state the order arrives in, 1 to 0 (cargo.ts). */
  condition?: number
}

/**
 * The base reward is paid in full on every delivery, once per customer, however
 * many crashes there were. Distance, time, a clean ride, working after dark and
 * the customer's tip only add to it. A rush order's bonus is bigger, and
 * missing it costs nothing.
 */
export function calculateReward(
  seconds: number,
  mission: Pick<Mission, 'kind' | 'tier' | 'dropCount' | 'onTimeSeconds' | 'story'>,
  { crashes = 0, knocks = 0, streak = 0, nightPay = false, period, frustration, roughness, surge = 0, condition = 1 }: RideRecord = {},
): Reward {
  const rules = MISSION_RULES
  const { kind, tier, dropCount, onTimeSeconds, story } = mission
  const onTime = seconds <= onTimeSeconds
  const rush = kind === 'rush'
  // Medicine pays double; an order that arrives spoiled to nothing is refused, and pays half.
  const cargo = CARGO[story.cargo]
  const refused = cargo.meter !== null && condition <= 0
  const baseCredits = Math.round(rules.baseCredits * dropCount * cargo.payShare * (refused ? 0.5 : 1))
  const rating = rateDelivery({ story, seconds, onTimeSeconds, crashes, knocks, streak, frustration, roughness, condition })

  return {
    kind,
    baseCredits,
    distanceCredits: tier.extraCredits,
    onTimeCredits: onTime ? rules.onTimeCredits + (rush ? rules.rushExtraCredits : 0) : 0,
    cleanRideCredits: crashes === 0 ? rules.cleanRideCredits : 0,
    nightCredits: nightPay ? Math.round((baseCredits + tier.extraCredits) * rules.nightPayShare) : 0,
    // The period's share, and the rush-hour surge on top of it (the jam on Outer Ring Road).
    peakCredits: Math.round((baseCredits + tier.extraCredits) * ((period?.payShare ?? 0) + surge)),
    peakLabel: surge > 0 ? 'Rush-hour surge' : (period?.label ?? ''),
    crashes,
    xp: rules.baseXp * dropCount + tier.extraXp + (rush && onTime ? rules.rushExtraXp : 0),
    seconds,
    onTime,
    stars: rating.stars,
    tipCredits: rating.tip,
    starsLost: rating.lost,
    reaction: rating.reaction,
    customer: story.customer,
  }
}
