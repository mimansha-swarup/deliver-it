import type { Mission, MissionPhase, MissionStop, Reward } from '../game/gameTypes'
import { MISSION_RULES } from '../game/missionConfig'
import { rateDelivery } from './orderStory'

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
  { crashes = 0, knocks = 0, streak = 0, nightPay = false }: RideRecord = {},
): Reward {
  const rules = MISSION_RULES
  const { kind, tier, dropCount, onTimeSeconds, story } = mission
  const onTime = seconds <= onTimeSeconds
  const rush = kind === 'rush'
  const baseCredits = rules.baseCredits * dropCount
  const rating = rateDelivery({ story, seconds, onTimeSeconds, crashes, knocks, streak })

  return {
    kind,
    baseCredits,
    distanceCredits: tier.extraCredits,
    onTimeCredits: onTime ? rules.onTimeCredits + (rush ? rules.rushExtraCredits : 0) : 0,
    cleanRideCredits: crashes === 0 ? rules.cleanRideCredits : 0,
    nightCredits: nightPay ? Math.round((baseCredits + tier.extraCredits) * rules.nightPayShare) : 0,
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
