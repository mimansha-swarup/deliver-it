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
