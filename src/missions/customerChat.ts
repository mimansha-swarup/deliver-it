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
  | 'fuming'
  | 'cancelled'

/** Shares of the on-time limit used, at which the customer writes. */
export const CHAT_TIMES = { half: 0.5, quarter: 0.75, late: 1, veryLate: 1.5 }

const pick = (lines: string[], seed: number) => lines[seed % lines.length]

/** The customer's line for a stage. `seed` picks among the options, so two orders differ. */
export function customerLine(stage: ChatStage, story: OrderStory, seed: number): string {
  const event = story.care === 'event'
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
    case 'fuming':
      return pick(['Last chance. If it\'s not here soon I\'m cancelling.', 'I\'m about to cancel this order.'], seed)
    case 'cancelled':
      return pick(['Cancelled. I\'ll get it myself.', 'Forget it, I cancelled.'], seed)
  }
}

/*
 * How frustrated the customer is, from 0 (happy) to 1: time alone, as that's all they can see (the
 * app's map and its estimate). Nothing until half the timer shown to the rider is used, `atLimit`
 * when it runs out, then on to 1 at three times the timer, when they cancel.
 *
 * Rough riding with their order on board doesn't touch their mood, as they can't see it. It shows
 * in the parcel when it arrives: `roughness` adds up (a crash a lot, a hard landing a little, more
 * for something fragile), and at the door it costs stars and tip (`roughStars`).
 */
export const FRUSTRATION = {
  /** Frustration when the timer runs out: event orders (a wedding, an interview) mind more. */
  atLimit: 0.3,
  eventAtLimit: 0.45,
  /** Shares of the timer: the customer warns at the first and cancels at the second. */
  warnAt: 2.5,
  cancelAt: 3,
  /** Roughness added by a crash and by a hard landing (more if fragile) with the order on board. */
  crash: 0.15,
  knock: 0.04,
  fragileKnock: 0.08,
  /** Each this much roughness costs a star at the door, up to `roughMostStars`. */
  roughPerStar: 0.15,
  roughMostStars: 3,
}

/** Stars the parcel's condition costs at the door, from the roughness of the ride. */
export function roughStars(roughness: number): number {
  return Math.min(FRUSTRATION.roughMostStars, Math.floor(roughness / FRUSTRATION.roughPerStar + 1e-6))
}

/** The part of frustration that comes from time, given the share of the timer used: 1 at `cancelAt`. */
export function timeFrustration(used: number, care: OrderStory['care']): number {
  const { cancelAt } = FRUSTRATION
  const atLimit = care === 'event' ? FRUSTRATION.eventAtLimit : FRUSTRATION.atLimit
  if (used <= 0.5) return 0
  if (used <= 1) return atLimit * ((used - 0.5) / 0.5)
  return Math.min(1, atLimit + (1 - atLimit) * ((used - 1) / (cancelAt - 1)))
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
