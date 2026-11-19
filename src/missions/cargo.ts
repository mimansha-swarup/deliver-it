/*
 * Kinds of order, each with its own rule while it's on board. The order's `condition` runs from 1
 * (as it left the counter) down to 0 (spoiled), and the customer judges what arrives:
 *
 *   fragile   a cake, glass, flowers: every hard bump and every crash damages it
 *   hot       hot food: it cools from the moment it's picked up; a crash spills some
 *   frozen    ice cream: it melts with time, three times as fast in direct sun as at night; slower in rain
 *   medicine  urgent: a tighter clock and double the base pay; nothing spoils
 *   bulk      heavy loads: needs the three-wheeler or the van (GaadiGo rents one from the offer)
 *
 * Plain parcels (clothes, shoes) have no rule: they arrive as they left.
 */

export type CargoType = 'parcel' | 'fragile' | 'hot' | 'frozen' | 'medicine' | 'bulk'

type CargoRule = {
  /** The chip on the offer and the order sheet, or '' for a plain parcel. */
  label: string
  /** What the meter is called while riding ("Cake", "Hot", "Frozen"), or null with nothing to watch. */
  meter: string | null
  /** The rule in a line, for the order sheet. */
  hint: string
  /** Condition lost at a hard bump, and at a crash. */
  bump: number
  crash: number
  /**
   * How long it lasts, at the ordinary rate, from fresh to spoiled, as a multiple of the order's own
   * time limit (so a long haul isn't doomed before it starts); 0 if time doesn't spoil it. Hot food
   * is lukewarm right at the limit; ice cream in full sun is half melted at about three quarters of it.
   */
  lasts: number
  /** The order's time limit, and its base pay, against a plain parcel's. */
  timeShare: number
  payShare: number
  /** What the customer says it arrived as, when it's poor and when it's ruined. */
  poor: string
  ruined: string
}

export const CARGO: Record<CargoType, CargoRule> = {
  parcel: { label: '', meter: null, hint: '', bump: 0, crash: 0, lasts: 0, timeShare: 1, payShare: 1, poor: '', ruined: '' },
  fragile: { label: 'Fragile', meter: 'Intact', hint: 'Fragile: bumps and crashes damage it. Breakers and potholes below half speed.', bump: 0.14, crash: 0.4, lasts: 0, timeShare: 1, payShare: 1, poor: 'Damaged', ruined: 'Smashed' },
  hot: { label: 'Hot food', meter: 'Hot', hint: 'Hot food: it cools from the counter on. Go straight there.', bump: 0.02, crash: 0.2, lasts: 2.5, timeShare: 1, payShare: 1, poor: 'Lukewarm', ruined: 'Stone cold' },
  frozen: { label: 'Ice cream', meter: 'Frozen', hint: 'Ice cream: it melts, much faster in the midday sun. Beat the clock by a good margin.', bump: 0.02, crash: 0.15, lasts: 3.25, timeShare: 1, payShare: 1, poor: 'Half melted', ruined: 'Melted' },
  medicine: { label: 'Medicine · 2× pay', meter: null, hint: 'Medicine: urgent. A tighter clock, and double the base pay.', bump: 0, crash: 0, lasts: 0, timeShare: 0.8, payShare: 2, poor: '', ruined: '' },
  bulk: { label: 'Bulk', meter: null, hint: 'Bulk: needs a three-wheeler or a van.', bump: 0, crash: 0, lasts: 0, timeShare: 1, payShare: 1, poor: '', ruined: '' },
}

/** Below these, an order arrives poor (a star and some tip lost) or ruined (two stars; at nothing, the customer refuses it). */
export const CONDITION = { poor: 0.6, ruined: 0.25 }

/**
 * How fast time spoils an order now, against the ordinary rate: hot food cools the same day or
 * night; ice cream melts three times as fast in direct sun as after dark (`sun`, 0 to 1: clear daylight),
 * and slowly after dark or in the rain.
 */
export function spoilRate(type: CargoType, sun: number, rain: number): number {
  if (type === 'frozen') return (0.6 + 1.2 * sun) * (1 - 0.35 * rain)
  if (type === 'hot') return 1 + 0.25 * rain
  return 0
}

/** The condition after `seconds` more on board, on an order with this time limit. */
export function spoil(condition: number, type: CargoType, seconds: number, sun: number, rain: number, onTimeSeconds: number): number {
  const { lasts } = CARGO[type]
  if (lasts <= 0) return condition
  return Math.max(0, condition - (seconds * spoilRate(type, sun, rain)) / (lasts * Math.max(30, onTimeSeconds)))
}

/** Stars the customer takes off for the state it's in, and why, in a word or two. */
export function conditionStars(type: CargoType, condition: number): { stars: number; reason: string } {
  const rule = CARGO[type]
  if (!rule.meter || condition >= CONDITION.poor) return { stars: 0, reason: '' }
  if (condition <= 0) return { stars: 4, reason: rule.ruined }
  if (condition < CONDITION.ruined) return { stars: 2, reason: rule.ruined }
  return { stars: 1, reason: rule.poor }
}
