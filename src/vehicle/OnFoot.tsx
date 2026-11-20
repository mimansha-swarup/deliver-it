import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { borrow, driveOffer, followWanted } from '../game/borrow'
import { useGameStore } from '../game/gameStore'
import { isNearInterest, spotInReach } from '../game/interact'
import { isKey } from '../game/keyBindings'
import { setPrompt } from '../game/prompts'
import { liveRoom, roomMover } from '../game/rooms'
import type { CollisionWorld } from '../world/collision'
import { getOff, getOn, getTravelSpeed, isAfoot, isBesideVehicle, scooterLevel, type ScooterState } from './ScooterController'
import { UP_ON_DECK } from '../world/transitPlacement'
import { liveVehicle } from './vehicleCatalog'

/*
 * Getting off and on (F), and using things on foot (E). The walking itself is in the controller
 * (`stepOnFoot`); this listens for the two keys and keeps their prompts honest: "F · Get off" only
 * stopped near something worth walking to, "F · Get on" beside the vehicle, "E · …" in reach of a
 * door, a counter or a bell (game/interact.ts).
 */

/** How often the prompts are worked out, in seconds. */
const CHECK_EVERY = 0.1

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
}

export function OnFoot({ scooter, collisions, deckCollisions }: { scooter: RefObject<ScooterState>; collisions: CollisionWorld; deckCollisions: (height: number) => CollisionWorld }) {
  const since = useRef(0)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || isTyping(event) || !isKey('mount', event.code)) return
      const game = useGameStore.getState()
      if (!game.started || game.photoMode || game.phase === 'handingOver' || game.phase === 'collecting') return
      const state = scooter.current
      if (state.rider.phase === 'on') {
        const level = scooterLevel(state)
        if (getOff(state, level > UP_ON_DECK ? deckCollisions(level) : collisions)) liveVehicle.cockpit = false
      } else if (!getOn(state) && state.rider.phase === 'afoot' && !liveRoom.kind) {
        // Away from the vehicle they came on: their own, if it's the one beside them, or one off the street ("Use any vehicle").
        driveOffer(state)?.run()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [scooter, collisions, deckCollisions])

  // Doors and lifts move the rider (game/rooms.ts).
  useEffect(() => {
    roomMover.place = (x, z, heading) => {
      const { rider } = scooter.current
      rider.x = x
      rider.z = z
      rider.heading = heading
      rider.velocityX = 0
      rider.pace = 0
      // Straight onto that floor, or back up onto the street (the ground there is found on the next step).
      rider.ground = liveRoom.kind ? liveRoom.floorY : 0.08
      rider.y = rider.ground + 0.93
    }
  }, [scooter])

  useFrame((_, delta) => {
    since.current += delta
    if (since.current < CHECK_EVERY) return
    since.current = 0
    const state = scooter.current
    const afoot = isAfoot(state)
    const name = liveVehicle.spec.size.cab ? 'Get in' : 'Get on'
    const stopped = state.rider.phase === 'on' && state.crashLeft === 0 && getTravelSpeed(state) < 0.6
    // Off: stopped near something to walk to. On: beside the vehicle.
    if (stopped && isNearInterest(state.x, state.z)) setPrompt('mount', { action: 'mount', text: liveVehicle.spec.size.cab ? 'Get out' : 'Get off', priority: 1 })
    else if (stopped && borrow.vehicle) setPrompt('mount', { action: 'mount', text: 'Get out', priority: 1 })
    else if (afoot && isBesideVehicle(state)) setPrompt('mount', { action: 'mount', text: name, priority: 1 })
    else {
      // "F · Drive" by any vehicle on the street while the setting is on; "F · Get on your scooter" back at their own.
      const offer = afoot && !liveRoom.kind ? driveOffer(state) : null
      setPrompt('mount', offer ? { action: 'mount', text: offer.text, priority: 1 } : null)
    }
    followWanted(state)

    const spot = state.rider.phase === 'afoot' && !liveRoom.frozen ? spotInReach(state.rider.x, state.rider.z, liveRoom.kind) : null
    setPrompt('interact', spot ? { action: 'interact', text: spot.text, run: spot.run, priority: 2 } : null)
  })

  return null
}
