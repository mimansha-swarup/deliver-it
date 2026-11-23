import { useEffect, useRef, type RefObject } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { playPing } from '../audio/uiSounds'
import { eateryAt, FRESH, MEALS } from '../game/eateries'
import { useGameStore } from '../game/gameStore'
import { useTutorial } from '../game/tutorial'

/** With an order to collect, no eatery's door is offered within this of the dark store's stop, in metres. */
const STORE_QUIET = 28
import { discover } from '../game/discovery'
import { clearSpots, setSpot } from '../game/interact'
import { liveSky } from '../game/livePlayer'
import { goThrough, liveRoom } from '../game/rooms'
import { isAfoot, type ScooterState } from '../vehicle/ScooterController'
import { enterRoom, ROOM_SPOTS } from '../world/roomShapes'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('missions and markers')

/*
 * Walking into a chai stall or a darshini to eat and rest (game/eateries.ts): the door on the street,
 * the counter inside. Draws nothing: the room is Rooms.tsx's.
 */

const CHECK_EVERY = 0.15

export function Eating({ scooter }: { scooter: RefObject<ScooterState> }) {
  const since = useRef(0)
  /** Which kind of place the rider is in, kept from the door they came through. */
  const inside = useRef<'chai' | 'darshini'>('chai')
  useEffect(() => () => clearSpots('eat:'), [])

  useFrame((_, delta) => {
    since.current += delta
    if (since.current < CHECK_EVERY) return
    since.current = 0
    const state = scooter.current
    if (!isAfoot(state)) {
      clearSpots('eat:')
      return
    }
    if (!liveRoom.kind) {
      setSpot('eat:counter', null)
      // Not while an order is being collected at a dark store close by, nor at any point of the tutorial:
      // "Go in to eat" beside "Go in" at the dark store sent first-timers into the darshini next door.
      const game = useGameStore.getState()
      const collecting = game.mission !== null && game.phase === 'toPickup' && Math.hypot(game.mission.pickup.x - state.rider.x, game.mission.pickup.z - state.rider.z) < STORE_QUIET
      const eatery = collecting || useTutorial.getState().step !== null ? null : eateryAt(state.rider.x, state.rider.z, 2.6)
      if (!eatery) {
        setSpot('eat:door', null)
        return
      }
      const door = { x: eatery.x + eatery.outX * 1.0, z: eatery.z + eatery.outZ * 1.0 }
      const name = eatery.kind === 'chai' ? 'Chai · Kaapi · Bun' : 'Tiffin · Kaapi'
      setSpot('eat:door', {
        ...door,
        radius: 2.4,
        text: eatery.kind === 'chai' ? 'Go in for a chai' : 'Go in to eat',
        run: () => {
          inside.current = eatery.kind
          enterRoom('chai', door, { x: eatery.outX, z: eatery.outZ }, name, eatery.kind === 'chai' ? 'Chai stall' : 'Darshini')
        },
      })
      return
    }
    setSpot('eat:door', null)
    if (liveRoom.kind !== 'chai') {
      setSpot('eat:counter', null)
      return
    }
    const meal = MEALS[inside.current]
    const { counter } = ROOM_SPOTS.chai
    setSpot('eat:counter', {
      x: liveRoom.x + counter.x,
      z: liveRoom.z + counter.z,
      radius: 1.5,
      room: 'chai',
      priority: 2,
      text: `${meal.order} · ₹${meal.price}`,
      run: () => {
        const game = useGameStore.getState()
        if (!game.eat(meal.order, meal.price)) {
          game.postChat('customer', 'Counter', `₹${meal.price}, anna. Not enough in the wallet? Come back after an order.`)
          return
        }
        playPing('message')
        game.postChat('customer', 'Counter', meal.said)
        discover('adda')
        // A few minutes go by at the table.
        goThrough(meal.having, () => {
          liveSky.setHoursTo = (liveSky.hours + meal.minutes / 60) % 24
          useGameStore.getState().raviSays(`Good, you ate. Fresh riders get better tips: +${Math.round(FRESH.tipShare * 100)}% on your next ${FRESH.deliveries} deliveries.`)
        }, 1900)
      },
    })
  })

  return null
}
