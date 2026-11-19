import { useEffect } from 'react'
import { formatHour } from '../game/duty'
import { useGameStore } from '../game/gameStore'
import { isKey, keyName, useKeys } from '../game/keyBindings'
import { livePlayer } from '../game/livePlayer'
import { hintLearnt, learnHint, setPrompt, shownPrompts, usePrompts } from '../game/prompts'

/*
 * The prompts of the moment, bottom centre (game/prompts.ts): a key and two or three words, there
 * only while pressing that key does something. Also the two prompts that belong to nothing else:
 * sleeping at home, and "Space · Drift" the first time the rider takes a turn fast.
 */

/** A turn counts as fast above this speed (km/h) with the bars this far over; the hint stays this long (ms). */
const DRIFT_SPEED = 30
const DRIFT_STEER = 0.55
const DRIFT_SHOWN_MS = 4500
/** The hint is shown on this many fast turns, or until the rider drifts once. */
const DRIFT_TIMES = 3

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
}

function PromptDirector() {
  useEffect(() => {
    let driftUntil = 0
    let driftShown = 0
    let wasTurning = false
    let learnt = hintLearnt('drift')
    const timer = window.setInterval(() => {
      const game = useGameStore.getState()
      // Sleeping, at home and off duty (DutyUi.tsx listens for the key).
      setPrompt('sleep', game.atHome && game.duty === 'off' && !livePlayer.onFoot ? { action: 'sleep', text: `Sleep until ${formatHour(7)}` } : null)

      // The drift hint: on a fast turn, until it's been used or shown a few times.
      if (!learnt) {
        const now = performance.now()
        if (game.drifting) {
          learnt = true
          learnHint('drift')
          driftUntil = 0
        } else {
          const turning = game.speedKmh >= DRIFT_SPEED && Math.abs(livePlayer.steer) >= DRIFT_STEER && !livePlayer.onFoot
          if (turning && !wasTurning && now > driftUntil) {
            driftUntil = now + DRIFT_SHOWN_MS
            if (++driftShown >= DRIFT_TIMES) {
              learnt = true
              learnHint('drift')
            }
          }
          wasTurning = turning
        }
        setPrompt('drift', performance.now() < driftUntil ? { action: 'handbrake', text: 'Drift', priority: -1 } : null)
      } else setPrompt('drift', null)
    }, 150)
    return () => window.clearInterval(timer)
  }, [])
  return null
}

export function Prompts() {
  const list = usePrompts((state) => state.list)
  const bindings = useKeys((state) => state.bindings)
  // Hidden behind anything that takes the screen: a result card, the offline question.
  const covered = useGameStore((state) => state.lastReward !== null || state.askingOffline || state.shiftSummary !== null || state.photoMode)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || isTyping(event)) return
      const game = useGameStore.getState()
      if (game.lastReward || game.askingOffline || game.shiftSummary || game.photoMode) return
      const prompt = shownPrompts(usePrompts.getState().list).find(({ action, run }) => run && isKey(action, event.code))
      if (!prompt?.run) return
      event.preventDefault()
      prompt.run()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const shown = covered ? [] : shownPrompts(list)
  return (
    <>
      <PromptDirector />
      {shown.length > 0 && (
        <div className="prompts" role="status">
          {shown.map(({ id, action, text }) => (
            <p className="prompt" key={id}>
              <kbd>{keyName(bindings[action][0] ?? '')}</kbd>
              <span aria-hidden="true">·</span> {text}
            </p>
          ))}
        </div>
      )}
    </>
  )
}
