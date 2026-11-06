import type { Mission, MissionPhase, MissionStop, Reward } from '../game/gameTypes'
import { MISSION_RULES } from '../game/missionConfig'

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

/** The base reward is paid in full on every delivery. Time can only add to it. */
export function calculateReward(seconds: number, onTimeSeconds: number): Reward {
  const onTime = seconds <= onTimeSeconds

  return {
    baseCredits: MISSION_RULES.baseCredits,
    onTimeCredits: onTime ? MISSION_RULES.onTimeCredits : 0,
    xp: MISSION_RULES.baseXp,
    seconds,
    onTime,
  }
}
