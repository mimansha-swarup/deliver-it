import { keyFor } from './keyBindings'
import type { MissionPhase } from './gameTypes'

/*
 * The objective: one short instruction for whatever the rider should do now, shown top-left under
 * the duty badge. Worked out from the game's state alone, so it is never stale and never missing:
 * off duty it says how to start work; on an order it names the next step of that order.
 */

export type ObjectiveInput = {
  duty: 'off' | 'online'
  hasOffer: boolean
  phase: MissionPhase
  /** The order on, if any: where it's collected, who it's for, and what it is. */
  order: { store: string; customer: string; item: string } | null
  /** The result card is up after a delivery. */
  delivered: boolean
  atHome: boolean
  /** A GaadiGo vehicle is on its way (`coming`) or standing at the kerb waiting for the rider (`here`), by name. */
  vehicle: { name: string; here: boolean } | null
  goingOffline: boolean
  /** On-foot steps of the order, when there's one to say (the doorstep and the dark store's counter): it replaces the riding line. */
  step: string | null
}

/** "A silk saree" as "the silk saree", for the middle of a sentence. */
export function theItem(item: string): string {
  return item.replace(/^(A|An) /, 'the ').replace(/^([A-Z])/, (letter) => letter.toLowerCase())
}

export function objectiveFor(input: ObjectiveInput): string {
  const { duty, hasOffer, phase, order, delivered, atHome, vehicle, goingOffline, step } = input
  if (vehicle?.here) return `Pull up beside your ${vehicle.name} and stop for the keys`
  if (delivered) return goingOffline ? 'Delivered. Close the summary to go offline' : 'Delivered. Close the summary for the next order'
  if (order) {
    if (step) return step
    if (phase === 'toPickup') return `Ride to the ${order.store}`
    if (phase === 'collecting') return 'Collecting the order'
    if (phase === 'toCustomer') return `Take ${theItem(order.item)} to ${order.customer}`
    if (phase === 'handingOver') return `Handing over to ${order.customer}`
  }
  if (hasOffer) return `New order: ${keyFor('accept')} to accept, ${keyFor('decline')} to decline`
  if (vehicle) return `Wait where you are: your ${vehicle.name} is on its way`
  if (duty === 'online') return goingOffline ? 'Going offline' : 'Wait for an order: ride anywhere meanwhile'
  if (atHome) return `Go online with ${keyFor('online')}, or sleep with ${keyFor('sleep')}`
  return `Go online to take orders: press ${keyFor('online')}`
}
