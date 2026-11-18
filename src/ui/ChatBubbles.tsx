import { useEffect, useState } from 'react'
import { DISPATCHER } from '../game/career'
import { useGameStore, type ChatLine } from '../game/gameStore'
import { CHAT_TIMES, customerLine, type ChatStage } from '../missions/customerChat'

/*
 * Chat on the right of the HUD while online: the customer of the order on, and Ravi at dispatch.
 * Compact bubbles, the last few, each fading after a while, so the full phone isn't needed to
 * keep up. Off duty there's no chat (Ravi's messages show as the usual toast then).
 */

/** How many bubbles show at once, and how long each stays, in milliseconds. */
const SHOWN = 4
const SHOW_FOR = 9000

const RAVI = 'Ravi'

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
      const newest = state.messages[0]
      if (newest && newest.id !== seenMessage) {
        const seenAt = state.messages.findIndex((message) => message.id === seenMessage)
        const fresh = state.messages.slice(0, seenAt === -1 ? 3 : Math.min(seenAt, 3))
        seenMessage = newest.id
        if (state.duty === 'online') for (const message of [...fresh].reverse()) state.postChat('dispatch', RAVI, message.text)
      }

      const { mission, phase } = state
      if (!mission || state.duty !== 'online') return
      const say = (stage: ChatStage) => {
        if (said.has(stage)) return
        said.add(stage)
        state.postChat('customer', mission.story.customer, customerLine(stage, mission.story, state.missionNumber + said.size))
      }

      if (state.missionNumber !== order) {
        order = state.missionNumber
        said.clear()
        state.postChat('dispatch', RAVI, `Order assigned: ${mission.story.item.toLowerCase()} for ${mission.story.customer}. Pick up at ${mission.pickup.name}.`)
        say('accepted')
      }
      if (phase === 'toCustomer' && previous.phase === 'collecting') say('collected')
      if (phase !== 'toPickup' && phase !== 'toCustomer') return

      const used = state.seconds / mission.onTimeSeconds
      if (used >= CHAT_TIMES.veryLate) say('veryLate')
      else if (used >= CHAT_TIMES.late) say('late')
      else if (used >= CHAT_TIMES.quarter) say('quarter')
      else if (used >= CHAT_TIMES.half) say('half')
    })
  }, [])
  return null
}

function Bubble({ line, onGone }: { line: ChatLine; onGone: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onGone(line.id), SHOW_FOR)
    return () => window.clearTimeout(timer)
  }, [line.id, onGone])
  return (
    <li className="chat-bubble" data-from={line.from}>
      <span className="chat-name">{line.from === 'dispatch' ? DISPATCHER : line.name}</span>
      {line.text}
    </li>
  )
}

export function ChatBubbles() {
  const online = useGameStore((state) => state.duty === 'online')
  const chat = useGameStore((state) => state.chat)
  const [gone, setGone] = useState<Set<number>>(() => new Set())
  const [hide] = useState(() => (id: number) => setGone((before) => new Set(before).add(id)))

  const shown = online ? chat.filter((line) => !gone.has(line.id)).slice(-SHOWN) : []
  return (
    <>
      <CustomerChatDirector />
      {shown.length > 0 && (
        <ol className="chat" aria-live="polite" aria-label="Messages">
          {shown.map((line) => (
            <Bubble key={line.id} line={line} onGone={hide} />
          ))}
        </ol>
      )}
    </>
  )
}
