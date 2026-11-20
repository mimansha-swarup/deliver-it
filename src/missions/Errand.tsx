import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { playPing } from '../audio/uiSounds'
import { useGameStore } from '../game/gameStore'
import { borrow } from '../game/borrow'
import { clearSpots, setInterest, setSpot } from '../game/interact'
import { setPrompt } from '../game/prompts'
import { liveMission } from '../game/livePlayer'
import { theItem } from '../game/objective'
import { goThrough, leaveRoom, liveRoom, setRoom } from '../game/rooms'
import { doorsteps, errandLive, useGuard } from '../game/doorsteps'
import { discover } from '../game/discovery'
import type { DoorPlan } from '../game/gameTypes'
import { playBarks, playDoorbell, playLift, playPen, playStairs } from '../audio/doorSounds'
import { setStep } from '../ui/uiState'
import { getTravelSpeed, isAfoot, type ScooterState } from '../vehicle/ScooterController'
import { liveVehicle } from '../vehicle/vehicleCatalog'
import type { DarkStore } from '../world/darkStore'
import { enterRoom, planRoom, ROOM_SPOTS } from '../world/roomShapes'

/*
 * An order's steps on foot. Riding there is the mission tracker's; from the kerb on it's this:
 *
 *   pickup    park by the dark store, walk in, collect the bag from the counter (E), walk out
 *   delivery  park by the address and walk to the door: a house's gate or front door (ring the bell,
 *             wait for them, hand over), or a flat (in at the lobby, the lift or the stairs to the
 *             floor, the bell at their door). In the gated society the guard comes first (item 13).
 *             With no door near the stop, the customer waits at the kerb.
 *             A street address (a house, or a customer at the kerb) needn't be walked: stopped by the
 *             gate, E from the vehicle calls them out and hands over there. Flats, the gated society
 *             and the dark store are always on foot; so is everything with "Always walk to the door" on.
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
/** A kerbside handover is offered stopped within this of the door, in metres, and slower than this, in m/s. */
const KERB_RANGE = 20
const KERB_SPEED = 1.2
const KERB_LINES = ['Coming, coming! Stay there, I’ll come to the gate.', 'One second, I’m coming out!', 'Wait there only, I’ll come down.']

/** How long after the bell the customer comes to the door, by what's going on behind it, in milliseconds. */
const WAIT_MS = { plain: 1700, tryOn: 1700, dog: 3600, outside: 2600 }
const DOG_LINES = ['Bruno! Quiet! Sorry, he only barks, he never bites. Coming!', 'Tiger, inside! Inside! One minute, I am tying him.', 'Don’t mind the dog, he is just saying hello. Coming!']
const OUTSIDE_LINES = ['I’m on a call, please keep it outside the door. Thank you!', 'Baby is sleeping, don’t ring again please! Just leave it at the door.', 'Hands are full in the kitchen. Keep it outside na, I’ll take it.']

type Stage = { door: DoorPlan | null; step: 'approach' | 'rung' | 'out'; at: number }

const vehicleWord = () => (liveVehicle.spec.size.cab ? liveVehicle.spec.name : liveVehicle.spec.kind.toLowerCase().includes('bicycle') ? 'bicycle' : liveVehicle.spec.name)

export function Errand({ scooter, stores }: { scooter: RefObject<ScooterState>; stores: DarkStore[] }) {
  const since = useRef(0)
  const stage = useRef<Stage>({ door: null, step: 'approach', at: 0 })

  useEffect(
    () => () => {
      clearSpots('errand:')
      setInterest('errand', null)
      setPrompt('kerbside', null)
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
      setPrompt('kerbside', null)
      clearSpots('errand:')
      setInterest('errand', null)
      setStep(null)
      if (!mission) {
        stage.current = { door: null, step: 'approach', at: 0 }
        errandLive.customerAt = null
      }
      return
    }

    if (phase === 'toPickup') {
      setPrompt('kerbside', null)
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
            // The app wants the order on the rider's own vehicle, or a rented one: not one off the street.
            if (borrow.vehicle) {
              useGameStore.getState().postChat('customer', 'Deliver It app', 'Orders go on your own or a rented vehicle. Come back on yours, or rent one from GaadiGo.', true)
              return
            }
            useGameStore.getState().collectOrder()
            playPing('message')
            useGameStore.getState().postChat('customer', 'Dark store', `${mission.story.item} for ${mission.story.customer}. Jopana, maga!`)
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
    const { waiting, story, door } = mission
    // A new door (a new order, or a double drop's second customer): the errand starts again.
    if (stage.current.door !== door) {
      stage.current = { door, step: 'approach', at: 0 }
      errandLive.customerOut = door.kind === 'kerb'
      errandLive.customerAt = null
      errandLive.scene = door.scene
      errandLive.cleared = false
    }
    const away = Math.hypot(door.x - here.x, door.z - here.z)
    setInterest('errand', { x: door.x, z: door.z, reach: PARK_RANGE })
    if (liveRoom.kind === 'store' || liveRoom.kind === 'chai') {
      setStep(`Got it. Back out to your ${vehicleWord()}`)
      clearSpots('errand:')
      return
    }
    const now = performance.now()
    const say = (text: string) => useGameStore.getState().postChat('customer', story.customer, text)
    const handOver = () => useGameStore.getState().arriveAtStop(liveMission.elapsed)

    // The bell, the wait, and the hand-over, wherever the door is: on the street, or along a corridor upstairs.
    const atTheDoor = (bell: { x: number; z: number }, room: string | undefined) => {
      const current = stage.current
      if (current.step === 'approach') {
        setSpot('errand:hand', null)
        setSpot('errand:bell', {
          ...bell,
          radius: 2.1,
          room,
          priority: 2,
          text: 'Ring the bell',
          run: () => {
            playDoorbell()
            stage.current = { ...current, step: 'rung', at: performance.now() }
            if (door.scene === 'dog') {
              window.setTimeout(() => playBarks(4), 500)
              window.setTimeout(() => say(DOG_LINES[Math.floor(Math.random() * DOG_LINES.length)]), 1400)
            } else if (door.scene === 'outside') window.setTimeout(() => say(OUTSIDE_LINES[Math.floor(Math.random() * OUTSIDE_LINES.length)]), 900)
            else window.setTimeout(() => say('Coming, coming! One second.'), 700)
          },
        })
        setStep(room ? `Ring the bell at flat ${door.flat}` : `Ring the bell at ${story.customer}’s ${door.atGate ? 'gate' : 'door'}`)
        return
      }
      setSpot('errand:bell', null)
      if (current.step === 'rung') {
        setStep(door.scene === 'dog' ? 'Wait: the dog is being called off' : `Wait for ${story.customer}`)
        if (now - current.at > WAIT_MS[door.scene]) {
          stage.current = { ...current, step: 'out' }
          errandLive.customerOut = true
        }
        return
      }
      const leaveIt = door.scene === 'outside'
      setSpot('errand:hand', { ...bell, radius: 2.6, room, priority: 2, text: leaveIt ? 'Leave it at the door' : 'Hand over', run: handOver })
      setStep(leaveIt ? 'Leave the order at the door' : `Hand ${theItem(story.item)} to ${story.customer}`)
    }

    // A street address from the vehicle: stopped near enough, E calls them out to the kerb and hands over there.
    const street = door.kind === 'kerb' || door.kind === 'house'
    const kerbside = street && !afoot && !game.alwaysWalk && state.rider.phase === 'on' && stage.current.step === 'approach'
    const spot = door.kind === 'house' ? (door.atGate ? 'gate' : 'door') : 'spot'
    if (kerbside && away < KERB_RANGE && getTravelSpeed(state) < KERB_SPEED) {
      setPrompt('kerbside', {
        action: 'interact',
        text: 'Hand over at the kerb',
        priority: 3,
        run: () => {
          setPrompt('kerbside', null)
          // Whatever was going on behind the door, they come out for it themselves.
          errandLive.scene = 'plain'
          errandLive.customerOut = true
          stage.current = { ...stage.current, step: 'out' }
          if (door.kind === 'house') say(KERB_LINES[Math.floor(Math.random() * KERB_LINES.length)])
          handOver()
        },
      })
    } else setPrompt('kerbside', null)

    if (door.kind === 'kerb') {
      setSpot('errand:hand', { x: waiting.x, z: waiting.z, radius: 2.6, priority: 2, text: 'Hand over', run: handOver })
      if (afoot) setStep(away < PARK_RANGE ? `Walk up to ${story.customer} and hand it over` : `Get back on your ${vehicleWord()}`)
      else if (kerbside) setStep(away < KERB_RANGE ? `Stop by ${story.customer} and hand over ${theItem(story.item)}` : null)
      else setStep(away < PARK_RANGE ? `Park and walk ${theItem(story.item)} to ${story.customer}` : null)
      return
    }

    if (door.kind === 'house') {
      if (!afoot) {
        clearSpots('errand:')
        if (kerbside) setStep(away < KERB_RANGE ? `Stop and hand over at the kerb, or walk it to ${story.customer}’s ${spot}` : away < PARK_RANGE ? `Stop by ${story.customer}’s ${spot}` : null)
        else setStep(away < PARK_RANGE ? `Park and walk to ${story.customer}’s ${door.atGate ? 'gate' : 'door'}` : null)
        return
      }
      if (away > PARK_RANGE * 1.5) {
        clearSpots('errand:')
        setStep(`Get back on your ${vehicleWord()}`)
        return
      }
      atTheDoor(door, undefined)
      return
    }

    // A flat: in at the building's door, up by the lift or the stairs, along the corridor to their door.
    const name = door.building
    // In the gated society the guard comes first: the order's OTP, then a line in the visitors' register.
    const society = doorsteps.society
    if (door.kind === 'society' && society && !errandLive.cleared && afoot && !liveRoom.kind) {
      const asked = stage.current.step !== 'approach'
      const security = (text: string) => useGameStore.getState().postChat('customer', `Security · ${society.name}`, text)
      setSpot('errand:guard', {
        x: society.guard.x,
        z: society.guard.z,
        radius: 3,
        priority: 3,
        text: asked ? 'Sign the register' : 'Show the OTP',
        run: () => {
          const card = { otp: door.otp, flat: door.flat, society: society.name, time: useGameStore.getState().skyTime }
          liveRoom.frozen = true
          if (!asked) {
            security(`Delivery? OTP please, for flat ${door.flat}.`)
            useGuard.setState({ card: { step: 'otp', ...card } })
            window.setTimeout(() => {
              stage.current = { ...stage.current, step: 'rung' }
              security('Okay, it matches. Sign the register.')
              useGuard.setState({ card: null })
              liveRoom.frozen = false
            }, 2300)
          } else {
            playPen()
            useGuard.setState({ card: { step: 'register', ...card } })
            window.setTimeout(() => {
              stage.current = { ...stage.current, step: 'approach' }
              errandLive.cleared = true
              discover('society')
              security(`Go ahead: floor ${door.floor}. Your vehicle stays outside the gate.`)
              useGuard.setState({ card: null })
              liveRoom.frozen = false
            }, 2000)
          }
        },
      })
    } else setSpot('errand:guard', null)
    if (!liveRoom.kind) {
      setSpot('errand:bell', null)
      setSpot('errand:hand', null)
      if (!afoot) {
        setSpot('errand:lobby', null)
        setStep(away < PARK_RANGE ? `Park and walk in to ${name}: flat ${door.flat}` : null)
        return
      }
      const blocked = door.kind === 'society' && !errandLive.cleared
      setSpot('errand:lobby', {
        x: door.x,
        z: door.z,
        radius: DOOR_REACH,
        text: 'Go in',
        run: () => {
          if (blocked) useGameStore.getState().postChat('customer', `Security · ${name}`, 'Hello! Delivery? Come to the gate first: OTP and the register.', true)
          else enterRoom('lobby', door, { x: door.outX, z: door.outZ }, name, name)
        },
      })
      setStep(away > PARK_RANGE * 1.5 ? `Get back on your ${vehicleWord()}` : blocked ? (stage.current.step === 'approach' ? `Show the guard at ${name}’s gate your OTP: ${door.otp}` : 'Sign the visitors’ register') : `Walk in to ${name}: flat ${door.flat}, floor ${door.floor}`)
      return
    }
    setSpot('errand:lobby', null)
    if (liveRoom.kind === 'lobby') {
      setSpot('errand:bell', null)
      setSpot('errand:hand', null)
      const goUp = (how: 'lift' | 'stairs') => {
        if (how === 'lift') playLift()
        else playStairs(Math.min(14, door.floor * 5))
        goThrough(how === 'lift' ? `Lift to floor ${door.floor}` : `Up the stairs to floor ${door.floor}`, () => {
          const { down, customer } = ROOM_SPOTS.corridor
          setRoom('corridor', { x: liveRoom.x, z: liveRoom.z }, liveRoom.exit, name, planRoom('corridor').blocks, door.floor, { x: down.x + 0.5, z: down.z, heading: Math.PI / 2 })
          errandLive.customerAt = { x: liveRoom.x + customer.x, z: liveRoom.z + customer.z, rotation: 0, floorY: liveRoom.floorY }
          setSpot('room:down', { x: liveRoom.x + down.x, z: liveRoom.z + down.z, radius: 1.4, room: 'corridor', text: 'Go down', run: () => leaveRoom('Down to the street') })
        }, how === 'lift' ? 1100 : 500 + door.floor * 450)
      }
      const { lift, stairs } = ROOM_SPOTS.lobby
      setSpot('errand:lift', {
        x: liveRoom.x + lift.x,
        z: liveRoom.z + lift.z,
        radius: 1.5,
        room: 'lobby',
        priority: 2,
        text: door.liftWorks ? `Lift to floor ${door.floor}` : 'Lift: out of order',
        run: () => {
          if (door.liftWorks) goUp('lift')
          else useGameStore.getState().postChat('customer', story.customer, 'Sorry, the lift is not working since morning! Please take the stairs.')
        },
      })
      setSpot('errand:stairs', { x: liveRoom.x + stairs.x, z: liveRoom.z + stairs.z, radius: 1.4, room: 'lobby', priority: 2, text: `Stairs to floor ${door.floor}`, run: () => goUp('stairs') })
      setStep(`Take the lift or the stairs to floor ${door.floor}`)
      return
    }
    setSpot('errand:lift', null)
    setSpot('errand:stairs', null)
    if (liveRoom.kind === 'corridor') {
      const { bell } = ROOM_SPOTS.corridor
      atTheDoor({ x: liveRoom.x + bell.x, z: liveRoom.z + bell.z }, 'corridor')
    }
  })

  return null
}
