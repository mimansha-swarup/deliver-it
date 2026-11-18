import type { Reward } from './gameTypes'

/*
 * Being on duty. The game is free-roam: after loading the rider is off duty and can ride anywhere
 * with no orders and no clock. Going online (the phone, or O) brings order offers, which can be
 * accepted or declined. Time of day changes the pay, the traffic and the kind of orders. A shift
 * can have one optional goal with a bonus, and going offline shows what the shift came to.
 *
 * Plain data and small pure functions; the store calls them and keeps the results.
 */

export type DutyState = 'off' | 'online'

export type PeriodId = 'morning' | 'lunch' | 'evening' | 'night'

export type DayPeriod = {
  id: PeriodId
  label: string
  /** When it starts, in hours. Each runs until the next one starts. */
  from: number
  /** Extra pay on base and distance, as a share: the lunch rush pays more. */
  payShare: number
  /** How much of the quality preset's traffic is out, 0 to 1. Never more than the preset. */
  traffic: number
  /** Seconds between one order offer and the next: [shortest, longest]. */
  offerGap: [number, number]
  /** How often an offer is a rush order or a double drop, once the rider's level allows them. */
  rushChance: number
  doubleChance: number
}

/** In the order they come round. Night runs past midnight to the morning. */
export const DAY_PERIODS: DayPeriod[] = [
  { id: 'morning', label: 'Morning', from: 6, payShare: 0, traffic: 0.75, offerGap: [9, 18], rushChance: 0.15, doubleChance: 0.15 },
  { id: 'lunch', label: 'Lunch rush', from: 11.5, payShare: 0.2, traffic: 0.85, offerGap: [5, 10], rushChance: 0.4, doubleChance: 0.2 },
  { id: 'evening', label: 'Evening rush', from: 16.5, payShare: 0.15, traffic: 1, offerGap: [6, 12], rushChance: 0.25, doubleChance: 0.3 },
  { id: 'night', label: 'Night', from: 21, payShare: 0, traffic: 0.45, offerGap: [14, 26], rushChance: 0.1, doubleChance: 0.1 },
]

/** The part of the day it is at `hours` (0 to 24). */
export function dayPeriod(hours: number): DayPeriod {
  let current = DAY_PERIODS[DAY_PERIODS.length - 1]
  for (const period of DAY_PERIODS) if (hours >= period.from) current = period
  return current
}

/** Where the rider wakes after sleeping, in hours. */
export const WAKE_HOUR = 7

/** How long an order offer waits for an answer, in seconds. One left to run out counts as declined. */
export const OFFER_SECONDS = 15
/** How many answers the acceptance rate looks back over. */
export const ANSWERS_KEPT = 20
/** Below this acceptance rate, offers come a little less often and Ravi says something. */
export const LOW_ACCEPTANCE = 0.6
export const LOW_ACCEPTANCE_SLOWDOWN = 1.35

/** Share of offers accepted, from the last ANSWERS_KEPT. Null before any. */
export function acceptanceRate(answers: boolean[]): number | null {
  if (answers.length === 0) return null
  return answers.filter(Boolean).length / answers.length
}

/** Cancelling an accepted order: credits taken, and the star rating it counts as. */
export const CANCEL_PENALTY = { credits: 40, stars: 1 }

export type ShiftGoalKind = 'earn' | 'orders' | 'fiveStars' | 'clean'

export type ShiftGoal = {
  kind: ShiftGoalKind
  text: string
  target: number
  progress: number
  /** For a goal against the clock: the game hour (0 to 24, after the start) it must be met by. */
  deadline?: number
  bonus: number
  state: 'open' | 'met' | 'missed'
}

/** Formats an hour of the day as the phone shows it: 2 pm, 10:30 am. */
export function formatHour(hours: number): string {
  const whole = Math.floor(hours) % 24
  const minutes = Math.round((hours - Math.floor(hours)) * 60)
  const twelve = whole % 12 === 0 ? 12 : whole % 12
  return `${twelve}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${whole < 12 ? 'am' : 'pm'}`
}

/**
 * One optional goal for a shift, chosen for the time of day and the rider's level. Targets fit a
 * shift of a few game hours: a delivery takes about an hour on the game clock.
 */
export function createShiftGoal(hours: number, level: number, random: () => number): ShiftGoal {
  const roll = random()
  if (roll < 0.3) {
    const target = Math.round((350 + level * 50) / 50) * 50
    return { kind: 'earn', text: `Earn ${target} credits this shift`, target, progress: 0, bonus: 120, state: 'open' }
  }
  if (roll < 0.6) {
    const deadline = Math.ceil(hours) + 5
    const target = 3 + (level >= 3 ? 1 : 0)
    return { kind: 'orders', text: `${target} orders before ${formatHour(deadline)}`, target, progress: 0, deadline, bonus: 150, state: 'open' }
  }
  if (roll < 0.8) return { kind: 'fiveStars', text: '3 five-star deliveries', target: 3, progress: 0, bonus: 100, state: 'open' }
  return { kind: 'clean', text: '4 deliveries with no crashes', target: 4, progress: 0, bonus: 100, state: 'open' }
}

/** What a finished delivery adds to a goal. */
export function goalStep(goal: ShiftGoal, reward: Reward, paid: number): number {
  if (goal.kind === 'earn') return paid
  if (goal.kind === 'orders') return 1
  if (goal.kind === 'fiveStars') return reward.stars === 5 ? 1 : 0
  return reward.crashes === 0 ? 1 : 0
}

/** Everything a shift adds up to, kept while online and shown when going offline. */
export type ShiftStats = {
  deliveries: number
  cancelled: number
  /** Credits from deliveries, tips included, and the goal's bonus. */
  earnings: number
  tips: number
  ratings: number[]
  /** Metres ridden while online. */
  distance: number
  /** Game hours online, counted on the game clock, and real seconds. */
  gameHours: number
  realSeconds: number
  goal: ShiftGoal | null
  /** The best thing that happened, with a score so a better one can replace it. */
  best: { score: number; text: string } | null
  /** The game clock when the shift started (0 to 24), its running total then (liveSky.totalHours), and the real time. */
  startedAt: number
  startedTotal: number
  startedReal: number
}

export function newShift(goal: ShiftGoal | null, startedAt: number, startedTotal: number, startedReal: number): ShiftStats {
  return { deliveries: 0, cancelled: 0, earnings: 0, tips: 0, ratings: [], distance: 0, gameHours: 0, realSeconds: 0, goal, best: null, startedAt, startedTotal, startedReal }
}

/** Whether a goal against the clock has run out of time, given the game clock's running total now. */
export function isPastDeadline(shift: ShiftStats, totalHours: number): boolean {
  const { goal } = shift
  if (!goal || goal.deadline === undefined) return false
  return totalHours - shift.startedTotal > goal.deadline - shift.startedAt
}

/** A candidate for the shift's best moment, from one delivery. The biggest score wins. */
export function bestMomentOf(reward: Reward, onTimeSeconds: number): { score: number; text: string } {
  const early = Math.round(onTimeSeconds - reward.seconds)
  const options = [
    { score: reward.tipCredits * 2, text: `A ${reward.tipCredits}-credit tip from ${reward.customer}` },
    { score: reward.onTime ? early * 1.5 : 0, text: `${reward.customer}'s order, ${early} s early` },
    { score: reward.stars === 5 && reward.crashes === 0 ? 40 : 0, text: `A spotless 5★ ride to ${reward.customer}` },
  ]
  return options.reduce((best, option) => (option.score > best.score ? option : best))
}

export type ShiftSummary = ShiftStats & { averageRating: number | null }

export function summarize(shift: ShiftStats): ShiftSummary {
  const averageRating = shift.ratings.length ? shift.ratings.reduce((sum, stars) => sum + stars, 0) / shift.ratings.length : null
  return { ...shift, averageRating }
}
