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
function ravi(prefix: string) {
  const now = performance.now()
  if (now - raviLast < RAVI_GAP) return
  raviLast = now
  void speak(pickLine(`ravi.${prefix}`).id, 'phone')
}

/** Starts listening for Ravi's moments and the customer's thanks. Call once. */
export function watchVoiceCues(): () => void {
  const offGame = useGameStore.subscribe((state, previous) => {
    if (state.duty !== previous.duty) ravi(state.duty === 'online' ? 'online' : 'offline')
    else if (state.offer && !previous.offer) ravi('offer')
    else if (state.phase === 'toCustomer' && previous.phase === 'toPickup' && state.mission) ravi('picked')
    else if (state.crashes > previous.crashes && state.phase === 'toCustomer') ravi('crash')
    if (state.lastReward && state.lastReward !== previous.lastReward) {
      const { stars } = state.lastReward
      // The customer first, at the door; Ravi a moment after, on the phone.
      const customer = previous.mission?.story.customer
      if (customer && previous.mission?.door.scene !== 'outside') sayLine('cust.thanks', customer)
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
