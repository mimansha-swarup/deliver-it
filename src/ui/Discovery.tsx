import { useEffect } from 'react'
import { agaraPlaces } from '../game/agaraPlaces'
import { NAMMA_SPOTS, useDiscovery, type SpotId } from '../game/discovery'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'

/*
 * Arriving and finding (game/discovery.ts): the "Agara" card as the rider comes into the area, a
 * card for each Namma spot the first time it's found, and, the first time the statue is seen from
 * up on the flyover, a nudge to take a photo.
 */

/** Agara is within this far of its junction, statue or lake shore, in metres; the card shows again only after leaving this far. */
const AREA_IN = 420
const AREA_OUT = 750
/** How long a card stays, in milliseconds. */
const CARD_TIME = 4500
/** The statue counts as seen from the flyover from this high and this near, in metres. */
const DECK_HEIGHT = 4.5
const STATUE_VIEW = 190
const TEMPLE_NEAR = 75

const near = (spot: { x: number; z: number } | null, reach: number) => spot !== null && Math.hypot(spot.x - livePlayer.x, spot.z - livePlayer.z) < reach

export function Discovery() {
  const card = useDiscovery((state) => state.card)

  useEffect(() => {
    let inArea = false
    const timer = setInterval(() => {
      if (useGameStore.getState().photoMode) return
      const { showCard, find } = useDiscovery.getState()
      const { statue, junction, lake, temple, jagannath } = agaraPlaces
      const atLake = lake !== null && Math.hypot(lake.x - livePlayer.x, lake.z - livePlayer.z) < lake.reach + 45
      const here = near(statue, AREA_IN) || near(junction, AREA_IN) || atLake
      const gone = !near(statue, AREA_OUT) && !near(junction, AREA_OUT) && !(lake !== null && Math.hypot(lake.x - livePlayer.x, lake.z - livePlayer.z) < lake.reach + AREA_OUT - AREA_IN)
      if (here && !inArea) {
        inArea = true
        showCard('Agara', 'ಅಗರ · by the lake and the flyover')
      } else if (gone) inArea = false

      const found = (id: SpotId, sub: string) => {
        if (!find(id)) return
        const spot = NAMMA_SPOTS.find((candidate) => candidate.id === id)
        showCard(`Namma spot: ${spot?.name ?? ''}`, sub)
      }
      if (livePlayer.height > DECK_HEIGHT && near(statue, STATUE_VIEW)) found('statue', 'Worth a picture: open the Camera app in your phone.')
      if (atLake && liveSky.hours >= 17 && liveSky.hours < 19) found('lake', 'Ticked off in Namma spots, in your phone.')
      if (liveSky.look.night > 0.6 && (near(temple, TEMPLE_NEAR) || near(jagannath, TEMPLE_NEAR) || near(statue, TEMPLE_NEAR))) found('temple', 'Ticked off in Namma spots, in your phone.')
    }, 400)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!card) return
    const timer = setTimeout(() => useDiscovery.getState().clearCard(card.id), CARD_TIME)
    return () => clearTimeout(timer)
  }, [card])

  if (!card) return null
  return (
    <div className="area-card" key={card.id} role="status">
      <p className="area-card-title">{card.title}</p>
      <p className="area-card-sub">{card.sub}</p>
    </div>
  )
}
