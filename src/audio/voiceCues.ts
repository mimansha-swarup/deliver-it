import { DISPATCHER } from '../game/career'
import { useGameStore } from '../game/gameStore'
import { useUpkeep } from '../game/upkeep'
import { isWoman } from '../missions/orderStory'
import { pickLine, speak, type Treatment } from './voice'

/*
 * Who says what, when (the lines are in voiceScript.json; audio/voice.ts plays their recordings).
 *
 * Customers, the guard and the dark store's counter speak where the errand has them speak
 * (missions/Errand.tsx): `sayLine` picks one of a line's variants, puts its words in the chat, and
 * plays its recording if there is one, through a phone. Ravi's are cues on what happens in a shift,
 * watched from here: his words for those moments are in his messages already, so his cue is only
 * heard, and only once it's recorded.
 */

/** Which of a line's two recorded voices a customer has: a woman's ("a") or a man's ("b"), by their name, as their body at the door is. */
const voiceOf = (name: string): 'a' | 'b' => (isWoman(name) ? 'a' : 'b')

/**
 * Someone at the door or the gate says a line: in the chat under their name (`before` and `after`
 * are words only on the screen, like the flat's number), and aloud if it's been recorded.
 */
export function sayLine(prefix: string, name: string, { before = '', after = '', urgent = false, treatment = 'phone' as Treatment } = {}) {
  const line = pickLine(prefix)
  useGameStore.getState().postChat('customer', name, `${before}${line.line}${after}`, urgent)
  void speak(line.id, treatment, voiceOf(name))
}

/** Ravi doesn't talk over himself: at least this long between his cues, in milliseconds. */
const RAVI_GAP = 6000
let raviLast = -Infinity
/**
 * Nor does he say the same kind of thing every time it happens. Each of these moments has its own
 * rest, in seconds: he speaks the first time, then not again for that moment until the rest is up.
 * (He used to speak at every offer, every pickup and every crash; with the counter's own voice at
 * the pickup that was two voices each time, and a crash-heavy ride was mostly Ravi.) Going online
 * and offline, a breakdown, and a delivery that went very well or badly are always said.
 */
const RAVI_REST: Record<string, number> = { offer: 240, picked: 300, crash: 180, ok: 600, good: 150 }
const raviSaid = new Map<string, number>()
/**
 * Ravi's moments that already come with a message of his own, in other words (going online and
 * offline: gameStore.ts; a breakdown: upkeep.ts). At the rest (an order, a pickup, a crash, how a
 * delivery went) nothing was shown, and his voice came out of nowhere.
 */
const HAS_ITS_OWN_MESSAGE = new Set(['online', 'offline', 'breakdown'])

function ravi(prefix: string) {
  const now = performance.now()
  if (now - raviLast < RAVI_GAP) return
  const rest = RAVI_REST[prefix]
  if (rest !== undefined && now - (raviSaid.get(prefix) ?? -Infinity) < rest * 1000) return
  raviSaid.set(prefix, now)
  raviLast = now
  const line = pickLine(`ravi.${prefix}`)
  // Never a voice with nothing on the phone: what he says is also a message from him, word for word,
  // so it's clear who is speaking and why (and it's there to read with the sound off).
  if (!HAS_ITS_OWN_MESSAGE.has(prefix) && line.line) useGameStore.getState().postChat('dispatch', DISPATCHER, line.line, prefix === 'crash')
  void speak(line.id, 'phone')
}

/** Starts listening for Ravi's moments and the customer's thanks. Call once. */
export function watchVoiceCues(): () => void {
  const offGame = useGameStore.subscribe((state, previous) => {
    if (state.duty !== previous.duty) ravi(state.duty === 'online' ? 'online' : 'offline')
    else if (state.offer && !previous.offer) ravi('offer')
    // A moment after the counter has spoken, not over it.
    else if (state.phase === 'toCustomer' && previous.phase === 'toPickup' && state.mission) window.setTimeout(() => ravi('picked'), 2600)
    else if (state.crashes > previous.crashes && state.phase === 'toCustomer') ravi('crash')
    if (state.lastReward && state.lastReward !== previous.lastReward) {
      const { stars } = state.lastReward
      // The customer first, at the door; Ravi a moment after, on the phone.
      const customer = previous.mission?.story.customer
      // What the customer says agrees with the stars they give: thanks for a good one, and for a
      // poor one what they said about it, in the chat only (there is no recording of an unhappy customer).
      if (customer && stars < 4) {
        // Their own words from the rating (orderStory.ts), or a flat one if it has none.
        state.postChat('customer', customer, state.lastReward.reaction || (stars <= 2 ? 'This is not what I ordered it to look like. Not happy.' : 'Hmm. Okay.'))
      // On time, a plain thank-you; "Aah, finally" (the third recording) is for an order that was late.
      } else if (customer && previous.mission?.door.scene !== 'outside') sayLine(state.lastReward.onTime ? (Math.random() < 0.5 ? 'cust.thanks.1' : 'cust.thanks.2') : 'cust.thanks.3', customer)
      window.setTimeout(() => {
        raviLast = -Infinity
        ravi(stars >= 5 ? 'good' : stars <= 3 ? 'rough' : 'ok')
      }, 2200)
    }
  })
  const offUpkeep = useUpkeep.subscribe((state, previous) => {
    if (state.broken && !previous.broken) ravi('breakdown')
  })
  return () => {
    offGame()
    offUpkeep()
  }
}
