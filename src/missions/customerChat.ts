import type { OrderStory } from './orderStory'

/*
 * What customers write while their order is on its way, as compact chat on the HUD. They start
 * friendly and get shorter and sharper as the clock runs down. Every customer is made up; they
 * talk the way a lot of Bengaluru does, English with some Kannada and Hindi.
 */

/** A moment in an order that a customer writes about. Each is said at most once per order. */
export type ChatStage =
  | 'accepted'
  | 'collected'
  | 'half'
  | 'quarter'
  | 'late'
  | 'veryLate'
  | 'crash'
  | 'bump'
  | 'fuming'
  | 'cancelled'

/** Shares of the on-time limit used, at which the customer writes. */
export const CHAT_TIMES = { half: 0.5, quarter: 0.75, late: 1, veryLate: 1.5 }

const pick = (lines: string[], seed: number) => lines[seed % lines.length]

/** The customer's line for a stage. `seed` picks among the options, so two orders differ. */
export function customerLine(stage: ChatStage, story: OrderStory, seed: number): string {
  const event = story.care === 'event'
  const fragile = story.care === 'fragile'
  switch (stage) {
    case 'accepted':
      return story.note
    case 'collected':
      return pick(['Saw it\'s picked up. Super, waiting!', 'Picked up? Great, see you soon!', 'Okay, it\'s on the way. Thanks!'], seed)
    case 'half':
      return event
        ? pick(['How far are you? I have to leave soon.', 'Please come fast, the function is starting!'], seed)
        : pick(['Where have you reached?', 'Any idea how long? Just asking.', 'Close by?'], seed)
    case 'quarter':
      return event
        ? pick(['Bhaiya I\'m getting late, please hurry!!', 'Only a few minutes left, where are you?'], seed)
        : pick(['Swalpa fast please, I\'m waiting at the gate.', 'Is it coming? It\'s taking a while.', 'Bega banni, please!'], seed)
    case 'late':
      return event
        ? pick(['I\'m already late because of this. Seriously?', 'The event has started. Where ARE you?'], seed)
        : pick(['It\'s late now. Please hurry.', 'The app said it would be here by now.', 'Still waiting...'], seed)
    case 'veryLate':
      return pick(['This is very late. I\'ll be rating this.', 'Thinking of cancelling, honestly.', 'Ayyo, so long! Not happy.'], seed)
    case 'crash':
      return fragile
        ? pick(['Did you just fall?? Is my order okay?', 'Please tell me nothing broke!'], seed)
        : pick(['Saw you stopped. All okay?', 'Careful on the road, no rush to fall!'], seed)
    case 'bump':
      return pick(['It\'s glass, please go slow on the humps!', 'Gently please, it\'s fragile!'], seed)
    case 'fuming':
      return pick(['Last chance. If it\'s not here soon I\'m cancelling.', 'I\'m about to cancel this order.'], seed)
    case 'cancelled':
      return pick(['Cancelled. I\'ll get it myself.', 'Forget it, I cancelled.'], seed)
  }
}

/*
 * How frustrated the customer is, from 0 (happy) to 1 (they cancel). Time does most of it: nothing
 * until half the on-time limit is used, then it climbs, faster once late. Riding roughly with
 * their order on board adds to it: a crash a lot, a hard landing on a pothole or breaker a little,
 * more for something fragile.
 */
export const FRUSTRATION = {
  /** Per share of the on-time limit, from half of it to all of it, and past it. */
  beforeLate: 0.6,
  afterLate: 1.2,
  /** Event orders (a wedding, an interview) mind the time this much more. */
  eventTime: 1.3,
  crash: 0.15,
  knock: 0.04,
  fragileKnock: 0.08,
  /** The customer warns they'll cancel at this, and cancels at 1. */
  warn: 0.85,
}

/** The part of frustration that comes from time, given the share of the on-time limit used. */
export function timeFrustration(used: number, care: OrderStory['care']): number {
  const { beforeLate, afterLate, eventTime } = FRUSTRATION
  const part = beforeLate * Math.max(0, Math.min(used, 1) - 0.5) + afterLate * Math.max(0, used - 1)
  return part * (care === 'event' ? eventTime : 1)
}

/** Stars from frustration: a happy customer gives 5, a fuming one 1. */
export function starsFromFrustration(frustration: number): number {
  return Math.max(1, Math.min(5, 5 - Math.floor(frustration * 4.5)))
}

/** A word for the customer's mood, for the meter. */
export function moodOf(frustration: number): string {
  if (frustration < 0.15) return 'Happy'
  if (frustration < 0.4) return 'Waiting'
  if (frustration < 0.7) return 'Annoyed'
  return 'Fuming'
}
