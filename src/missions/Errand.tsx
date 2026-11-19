import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { playPing } from '../audio/uiSounds'
import { useGameStore } from '../game/gameStore'
import { clearSpots, setInterest, setSpot } from '../game/interact'
import { liveMission } from '../game/livePlayer'
import { theItem } from '../game/objective'
import { liveRoom } from '../game/rooms'
import { setStep } from '../ui/uiState'
import { isAfoot, type ScooterState } from '../vehicle/ScooterController'
import { liveVehicle } from '../vehicle/vehicleCatalog'
import type { DarkStore } from '../world/darkStore'
import { enterRoom, ROOM_SPOTS } from '../world/roomShapes'

/*
 * An order's steps on foot. Riding there is the mission tracker's; from the kerb on it's this:
 *
 *   pickup    park by the dark store, walk in, collect the bag from the counter (E), walk out
 *   delivery  park by the address, walk to the customer and hand it over (E)
 *
 * It keeps the interact spots (game/interact.ts) and the objective's step (ui/uiState.ts) in line
 * with where the rider is, a few times a second. Nothing here draws anything.
 */

const CHECK_EVERY = 0.12
/** "Get off" is offered, and the objective talks about parking, this near the door, in metres. */
const PARK_RANGE = 45
/** How far out from its front wall a dark store's door spot is, and how near the rider must be to use it. */
const STORE_DOOR_OUT = 1.1
const DOOR_REACH = 2.2

const vehicleWord = () => (liveVehicle.spec.size.cab ? liveVehicle.spec.name : liveVehicle.spec.kind.toLowerCase().includes('bicycle') ? 'bicycle' : liveVehicle.spec.name)

export function Errand({ scooter, stores }: { scooter: RefObject<ScooterState>; stores: DarkStore[] }) {
  const since = useRef(0)

  useEffect(
    () => () => {
      clearSpots('errand:')
      setInterest('errand', null)
      setStep(null)
    },
    [],
  )

  useFrame((_, delta) => {
    since.current += delta
    if (since.current < CHECK_EVERY) return
    since.current = 0
    const game = useGameStore.getState()
    const state = scooter.current
    const { mission, phase } = game
    const afoot = isAfoot(state)
    const here = afoot ? state.rider : state

    if (!mission || (phase !== 'toPickup' && phase !== 'toCustomer')) {
      clearSpots('errand:')
      setInterest('errand', null)
      setStep(null)
      return
    }

    if (phase === 'toPickup') {
      const store = stores.find(({ node }) => node === mission.pickup.node) ?? stores[0]
      const outX = Math.sin(store.rotation)
      const outZ = Math.cos(store.rotation)
      const door = { x: store.x + outX * STORE_DOOR_OUT, z: store.z + outZ * STORE_DOOR_OUT }
      const away = Math.hypot(door.x - here.x, door.z - here.z)
      setInterest('errand', { ...door, reach: PARK_RANGE })
      setSpot('errand:door', {
        ...door,
        radius: DOOR_REACH,
        text: 'Go in',
        run: () => enterRoom('store', door, { x: outX, z: outZ }, 'ORDER PICKUP', 'Dark store'),
      })
      setSpot('errand:hand', null)
      if (liveRoom.kind === 'store') {
        const { counter } = ROOM_SPOTS.store
        setSpot('errand:counter', {
          x: liveRoom.x + counter.x,
          z: liveRoom.z + counter.z,
          radius: 1.5,
          room: 'store',
          priority: 2,
          text: 'Pick up',
          run: () => {
            useGameStore.getState().collectOrder()
            playPing('message')
            useGameStore.getState().postChat('dispatch', 'Dark store', `${mission.story.item} for ${mission.story.customer}. Jopana, maga!`)
          },
        })
        setStep(`Collect ${theItem(mission.story.item)} from the counter`)
      } else {
        setSpot('errand:counter', null)
        setStep(afoot ? 'Walk in at the dark store’s door' : away < PARK_RANGE ? 'Park by the dark store and get off' : null)
      }
      return
    }

    // On the way to the customer.
    setSpot('errand:door', null)
    setSpot('errand:counter', null)
    const { waiting, story } = mission
    const away = Math.hypot(waiting.x - here.x, waiting.z - here.z)
    setInterest('errand', { x: waiting.x, z: waiting.z, reach: PARK_RANGE })
    if (liveRoom.kind === 'store') {
      setStep(`Got it. Back out to your ${vehicleWord()}`)
      setSpot('errand:hand', null)
      return
    }
    setSpot('errand:hand', {
      x: waiting.x,
      z: waiting.z,
      radius: 2.6,
      priority: 2,
      text: 'Hand over',
      run: () => useGameStore.getState().arriveAtStop(liveMission.elapsed),
    })
    if (afoot) setStep(away < PARK_RANGE ? `Walk up to ${story.customer} and hand it over` : `Get back on your ${vehicleWord()}`)
    else setStep(away < PARK_RANGE ? `Park and walk ${theItem(story.item)} to ${story.customer}` : null)
  })

  return null
}

