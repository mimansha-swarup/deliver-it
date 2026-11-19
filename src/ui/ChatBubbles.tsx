import { useEffect } from 'react'
import { useGameStore } from '../game/gameStore'
import { CHAT_TIMES, customerLine, FRUSTRATION, type ChatStage } from '../missions/customerChat'

/*
 * Chat on the right of the HUD while online: the customer of the order on, and Ravi at dispatch.
 * Compact bubbles, the last few, each fading after a while, so the full phone isn't needed to
 * keep up. Off duty there's no chat (Ravi's messages show as the usual toast then).
 */


const RAVI = 'Ravi'
/** Lines that peek the phone longer, with a red edge and a sharper sound: late, about to cancel, cancelled. */
const URGENT = new Set<ChatStage>(['late', 'veryLate', 'fuming', 'cancelled'])

/**
 * Posts the customer's lines as their order goes on: their note when it's accepted, a word on
 * pickup, then more pointed ones as the on-time limit runs down and past. Each stage once per order.
 */
function CustomerChatDirector() {
  useEffect(() => {
    let order = -1
    const said = new Set<ChatStage>()
    let seenMessage = useGameStore.getState().messages[0]?.id

    return useGameStore.subscribe((state, previous) => {
      // Ravi's messages appear as chat while online.
      // Ids only grow, so anything above the last one seen is new, even if older ones were replaced.
      const newest = state.messages[0]
      if (newest && newest.id !== seenMessage) {
        const fresh = state.messages.filter((message) => message.id > (seenMessage ?? -Infinity))
        seenMessage = Math.max(newest.id, seenMessage ?? -Infinity)
        if (state.duty === 'online') for (const message of [...fresh].reverse()) state.postChat('dispatch', RAVI, message.text)
      }

      // A customer who cancelled says so (the rider cancelling is Ravi's to tell).
      if (!state.mission && previous.mission && previous.frustration >= FRUSTRATION.fumingAt && state.duty === 'online') {
        state.postChat('customer', previous.mission.story.customer, customerLine('cancelled', previous.mission.story, state.missionNumber), true)
      }

      const { mission, phase } = state
      if (!mission || state.duty !== 'online') return
      const say = (stage: ChatStage) => {
        if (said.has(stage)) return
        said.add(stage)
        state.postChat('customer', mission.story.customer, customerLine(stage, mission.story, state.missionNumber + said.size), URGENT.has(stage))
      }

      if (state.missionNumber !== order) {
        order = state.missionNumber
        said.clear()
        state.postChat('dispatch', RAVI, `Order assigned: ${mission.story.item.toLowerCase()} for ${mission.story.customer}. Pick up at ${mission.pickup.name}.`)
        say('accepted')
      }
      // Collected at the counter (Errand.tsx): straight from riding to the store to riding to the customer.
      if (phase === 'toCustomer' && (previous.phase === 'collecting' || previous.phase === 'toPickup') && previous.mission === mission) say('collected')
      if (phase !== 'toPickup' && phase !== 'toCustomer') return

      // Nothing about crashes or bumps: the customer can't see the ride, only the parcel at the door.

      const used = state.seconds / mission.onTimeSeconds
      if (state.frustration >= FRUSTRATION.fumingAt) say('fuming')
      if (used >= CHAT_TIMES.veryLate) say('veryLate')
      else if (used >= CHAT_TIMES.late) say('late')
      else if (used >= CHAT_TIMES.quarter) say('quarter')
      else if (used >= CHAT_TIMES.half) say('half')
    })
  }, [])
  return null
}

/**
 * Posts the conversation as the order goes on (above). The lines are read on the phone, and peek it
 * up when it's away (Phone.tsx); nothing is drawn here.
 */
export function ChatBubbles() {
  return <CustomerChatDirector />
}
