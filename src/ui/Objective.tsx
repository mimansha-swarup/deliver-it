import { useFleet } from '../game/fleet'
import { useGameStore } from '../game/gameStore'
import { useKeys } from '../game/keyBindings'
import { objectiveFor } from '../game/objective'
import { useTutorial } from '../game/tutorial'
import { VEHICLES } from '../vehicle/vehicleCatalog'
import { useSteps } from './uiState'

/**
 * The objective line, top-left under the duty badge: always one short instruction for the current
 * step (game/objective.ts). While the tutorial runs, its card says what to do instead.
 */
export function Objective() {
  const duty = useGameStore((state) => state.duty)
  const hasOffer = useGameStore((state) => state.offer !== null)
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  const delivered = useGameStore((state) => state.lastReward !== null)
  const atHome = useGameStore((state) => state.atHome)
  const goingOffline = useGameStore((state) => state.offlineAfterOrder)
  const delivery = useFleet((state) => state.delivery)
  const step = useSteps((state) => state.step)
  const tutorial = useTutorial((state) => state.step !== null)
  // The keys named in the line follow the bindings.
  useKeys((state) => state.bindings)
  if (tutorial) return null
  const text = objectiveFor({
    duty,
    hasOffer,
    phase,
    order: mission ? { store: mission.pickup.name, customer: mission.story.customer, item: mission.story.item } : null,
    delivered,
    atHome,
    vehicle: delivery ? { name: VEHICLES[delivery.id].name, here: delivery.here } : null,
    goingOffline,
    step,
  })
  return (
    <p className="objective" role="status" aria-live="polite" key={text}>
      <span className="objective-mark" aria-hidden="true">▸</span> {text}
    </p>
  )
}
