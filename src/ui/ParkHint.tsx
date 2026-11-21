import { useEffect, useState } from 'react'
import { useGameStore } from '../game/gameStore'
import { livePlayer } from '../game/livePlayer'
import { getCurrentStop } from '../missions/missionLogic'

/*
 * "Slow down · park here", under the arrow at the top, on the way in to a stop: within 20 m of it
 * and still moving at more than a crawl. Riders shot past the dark store and the customer's gate
 * because nothing said the stop was this one, now.
 */
const PARK_HINT = { within: 20, fasterThan: 8, everyMs: 150 }

export function ParkHint() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const game = useGameStore.getState()
      const stop = getCurrentStop(game.mission, game.phase)
      setShown(stop !== null && game.started && !livePlayer.onFoot && game.speedKmh > PARK_HINT.fasterThan && Math.hypot(stop.x - livePlayer.x, stop.z - livePlayer.z) < PARK_HINT.within)
    }, PARK_HINT.everyMs)
    return () => window.clearInterval(timer)
  }, [])
  if (!shown) return null
  return (
    <p className="park-hint" role="status">
      Slow down · park here
    </p>
  )
}
