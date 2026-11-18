import { useEffect, useState } from 'react'
import { DISPATCHER } from '../game/career'
import { useGameStore, type ChatLine } from '../game/gameStore'
import { CHAT_TIMES, customerLine, FRUSTRATION, moodOf, type ChatStage } from '../missions/customerChat'

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

      // A customer who cancelled says so (the rider cancelling is Ravi's to tell).
      if (!state.mission && previous.mission && previous.frustration >= FRUSTRATION.warn && state.duty === 'online') {
        state.postChat('customer', previous.mission.story.customer, customerLine('cancelled', previous.mission.story, state.missionNumber))
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

      // Rough riding with their order on board, and a last warning before they cancel.
      if (state.crashes > previous.crashes && phase === 'toCustomer') say('crash')
      if (state.knocks > previous.knocks && mission.story.care === 'fragile') say('bump')
      if (state.frustration >= FRUSTRATION.warn) say('fuming')

      const used = state.seconds / mission.onTimeSeconds
      if (used >= CHAT_TIMES.veryLate) say('veryLate')
      else if (used >= CHAT_TIMES.late) say('late')
      else if (used >= CHAT_TIMES.quarter) say('quarter')
      else if (used >= CHAT_TIMES.half) say('half')
    })
  }, [])
  return null
}

function Bubble({ line }: { line: ChatLine }) {
  return (
    <li className="chat-bubble" data-from={line.from}>
      <span className="chat-name">{line.from === 'dispatch' ? DISPATCHER : line.name}</span>
      {line.text}
    </li>
  )
}

/** The customer's mood: a word and a bar, green to red, while their order is on its way. */
export function MoodMeter({ className = 'mood' }: { className?: string }) {
  const frustration = useGameStore((state) => state.frustration)
  const customer = useGameStore((state) => state.mission?.story.customer)
  const riding = useGameStore((state) => state.phase === 'toPickup' || state.phase === 'toCustomer')
  if (!customer || !riding) return null
  const mood = moodOf(frustration)
  return (
    <div className={className} data-mood={mood.toLowerCase()} title={`${customer} is ${mood.toLowerCase()}`}>
      <span className="mood-label">
        {customer} · <strong>{mood}</strong>
      </span>
      <span className="mood-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(frustration * 100)}%` }} />
      </span>
    </div>
  )
}

export function ChatBubbles() {
  const online = useGameStore((state) => state.duty === 'online')
  const chat = useGameStore((state) => state.chat)
  // Lines fade by age, so one pushed out by newer lines can't come back once they've gone.
  // A new line is newer than `now` until the next tick, which still counts as showing.
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!online) return
    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [online])

  const shown = online ? chat.filter((line) => now - line.at < SHOW_FOR).slice(-SHOWN) : []
  return (
    <>
      <CustomerChatDirector />
      {online && <MoodMeter />}
      {shown.length > 0 && (
        <ol className="chat" aria-live="polite" aria-label="Messages">
          {shown.map((line) => (
            <Bubble key={line.id} line={line} />
          ))}
        </ol>
      )}
    </>
  )
}
