import { useGameStore } from './gameStore'
import { useTutorial } from './tutorial'

/*
 * The first order is the player's alone: only Ravi and the customer speak during it. Everything
 * else the game has to say (home's first message, the daily challenge, the apps' own news) waits
 * until the tutorial is over and its result card has been closed.
 */

/** Whether the first order is still going on, its result card included. */
export function inFirstOrder(): boolean {
  const game = useGameStore.getState()
  return useTutorial.getState().step !== null || (game.history.length <= 1 && game.lastReward !== null)
}

/** Does it now, or as soon as the first order is over. */
export function afterFirstOrder(run: () => void) {
  if (!inFirstOrder()) return run()
  const timer = window.setInterval(() => {
    if (inFirstOrder()) return
    window.clearInterval(timer)
    run()
  }, 1000)
}
