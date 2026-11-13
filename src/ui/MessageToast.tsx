import { useEffect, useState } from 'react'
import { DISPATCHER } from '../game/career'
import { useGameStore } from '../game/gameStore'

/** How long a new message stays on screen, in milliseconds. */
const SHOW_FOR = 7000

/**
 * The newest message when the page loaded. The saved game is read in as the
 * store is created, so this is known before anything is drawn. Anything newer
 * than this is news, even if it arrived before the pop-up first appeared,
 * like Ravi's welcome as you press Start.
 */
const newestAtLoad = useGameStore.getState().messages[0]?.id

/**
 * A new message from Ravi pops up for a few seconds. Messages already there
 * when the game loads don't, so nothing old pops up on a fresh visit.
 */
export function MessageToast() {
  const latest = useGameStore((state) => state.messages[0])
  const [hiddenId, setHiddenId] = useState(newestAtLoad)

  useEffect(() => {
    if (!latest || latest.id === hiddenId) return
    const timer = window.setTimeout(() => setHiddenId(latest.id), SHOW_FOR)
    return () => window.clearTimeout(timer)
  }, [latest, hiddenId])

  if (!latest || latest.id === hiddenId) return null

  return (
    <aside className="message-toast" role="status" aria-live="polite">
      <p className="message-from">{DISPATCHER}</p>
      <p>{latest.text}</p>
    </aside>
  )
}
