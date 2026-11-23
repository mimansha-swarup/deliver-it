import { useEffect, useRef, type RefObject } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { playPing } from '../audio/uiSounds'
import { useGameStore } from '../game/gameStore'
import { borrow } from '../game/borrow'
import { clearSpots, setInterest, setSpot } from '../game/interact'
import { setPrompt } from '../game/prompts'
import { liveMission, livePlayer, liveRoute, liveView } from '../game/livePlayer'
import { theItem } from '../game/objective'
import { goThrough, leaveRoom, liveRoom, ROOM_DOOR, setRoom } from '../game/rooms'
import { isDebug } from '../dev/spawn'
import { doorsteps, errandLive, useGuard } from '../game/doorsteps'
import { discover } from '../game/discovery'
import type { DoorPlan } from '../game/gameTypes'
import { sayLine } from '../audio/voiceCues'
import { playBarks, playDoorbell, playLift, playPen, playStairs } from '../audio/doorSounds'
import { setStep } from '../ui/uiState'
import { getTravelSpeed, isAfoot, type ScooterState } from '../vehicle/ScooterController'
import { liveVehicle } from '../vehicle/vehicleCatalog'
import type { DarkStore } from '../world/darkStore'
import { enterRoom, planRoom, ROOM_SPOTS } from '../world/roomShapes'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('missions and markers')

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
const DOOR_REACH = 2.9
/** A kerbside handover is offered stopped within this of the door, in metres, and slower than this, in m/s. */
const KERB_RANGE = 20
const KERB_SPEED = 1.2

/** How long after the bell the customer comes to the door, by what's going on behind it, in milliseconds. */
const WAIT_MS = { plain: 1700, tryOn: 1700, dog: 3600, outside: 2600 }

type Stage = { door: DoorPlan | null; step: 'approach' | 'rung' | 'out'; at: number }

/** The order's next step on foot is here (game/doorsteps.ts): the marker, the arrow and the map's pin follow it. */
function aimAt(spot: { x: number; z: number }, indoors = false) {
  errandLive.goal = { x: spot.x, z: spot.z, y: indoors ? liveRoom.floorY : 0, kind: 'door', indoors }
}
/**
 * Upstairs or in a lobby with nothing left to do there (the order's handed over, or the next drop
 * is at another building): the way out is pointed at and said, and from anywhere in a corridor the
 * interact key goes down, so nobody is left looking for an unmarked corner by the lift.
 */
function showWayOut(say: boolean) {
  if (liveRoom.kind === 'corridor') {
    const { down } = ROOM_SPOTS.corridor
    aimAt({ x: liveRoom.x + down.x, z: liveRoom.z + down.z }, true)
    setSpot('room:down-anywhere', { x: liveRoom.x, z: liveRoom.z, radius: 12, room: 'corridor', priority: -1, text: 'Go down to the street', run: () => leaveRoom('Down to the street') })
    if (say) setStep('Go back down to the street')
  } else if (liveRoom.kind === 'lobby') {
    aimAt({ x: liveRoom.x + ROOM_DOOR.x, z: liveRoom.z + ROOM_DOOR.z + 0.45 }, true)
    if (say) setStep('Leave by the door, back to the street')
  }
}

/** Wandered off on foot: the way back to the vehicle. */
function aimAtVehicle() {
  errandLive.goal = { x: livePlayer.vehicleX, z: livePlayer.vehicleZ, y: 0, kind: 'vehicle', indoors: false }
}

const vehicleWord = () => (liveVehicle.spec.size.cab ? liveVehicle.spec.name : liveVehicle.spec.kind.toLowerCase().includes('bicycle') ? 'bicycle' : liveVehicle.spec.name)

export function Errand({ scooter, stores }: { scooter: RefObject<ScooterState>; stores: DarkStore[] }) {
  const since = useRef(0)
  // Debug: where the order's next step on foot is, the room and the view, for driving a walk from the console (and recording one).
  useEffect(() => {
    if (isDebug()) Object.assign(window, { __deliverItFoot: { errand: errandLive, room: liveRoom, view: liveView, exit: ROOM_DOOR, player: livePlayer, route: liveRoute } })
  }, [])
  const stage = useRef<Stage>({ door: null, step: 'approach', at: 0 })
  /** Whose building the lobby or corridor the rider is in belongs to. */
  const roomFor = useRef<DoorPlan | null>(null)

  useEffect(
    () => () => {
      clearSpots('errand:')
      setInterest('errand', null)
      setPrompt('kerbside', null)
      setStep(null)
      errandLive.goal = null
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
    errandLive.goal = null

    if (!mission || (phase !== 'toPickup' && phase !== 'toCustomer')) {
      setPrompt('kerbside', null)
      clearSpots('errand:')
      setInterest('errand', null)
      setStep(null)
      if (!mission) {
        stage.current = { door: null, step: 'approach', at: 0 }
        errandLive.customerAt = null
      }
      // Still up in the flats after the hand-over: the way down. (Behind the result card the line is the card's.)
      if (afoot && phase !== 'handingOver' && phase !== 'collecting') showWayOut(!game.lastReward)
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
            sayLine('store.ready', 'Dark store', { before: `${mission.story.item} for ${mission.story.customer}. ` })
          },
        })
        setStep(`Collect ${theItem(mission.story.item)} from the counter`)
        aimAt({ x: liveRoom.x + counter.x, z: liveRoom.z + counter.z }, true)
      } else {
        if (!liveRoom.kind) aimAt(door)
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
      // The way out is marked: with the bag in hand there was no marker in the room at all, and the door is behind them.
      aimAt({ x: liveRoom.x + ROOM_DOOR.x, z: liveRoom.z + ROOM_DOOR.z }, true)
      return
    }
    const now = performance.now()
    // What the customer says, from the voice script (audio/voiceCues.ts): in the chat, and aloud where it's recorded.
    const say = (line: string) => sayLine(line, story.customer)
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
              window.setTimeout(() => say('cust.dog'), 1400)
            } else if (door.scene === 'outside') window.setTimeout(() => say('cust.outside'), 900)
            else window.setTimeout(() => say('cust.coming'), 700)
          },
        })
        setStep(room ? `Ring the bell at flat ${door.flat}` : `Ring the bell at ${story.customer}’s ${door.atGate ? 'gate' : 'door'}`)
        aimAt(bell, room !== undefined)
        return
      }
      setSpot('errand:bell', null)
      aimAt(bell, room !== undefined)
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
          if (door.kind === 'house') say('cust.kerb')
          handOver()
        },
      })
    } else setPrompt('kerbside', null)

    if (door.kind === 'kerb') {
      setSpot('errand:hand', { x: waiting.x, z: waiting.z, radius: 2.6, priority: 2, text: 'Hand over', run: handOver })
      if (afoot && away >= PARK_RANGE) aimAtVehicle()
      else aimAt(waiting)
      if (afoot) setStep(away < PARK_RANGE ? `Walk up to ${story.customer} and hand it over` : `Get back on your ${vehicleWord()}`)
      else if (kerbside) setStep(away < KERB_RANGE ? `Stop by ${story.customer} and hand over ${theItem(story.item)}` : null)
      else setStep(away < PARK_RANGE ? `Park and walk ${theItem(story.item)} to ${story.customer}` : null)
      return
    }

    if (door.kind === 'house') {
      if (!afoot) {
        clearSpots('errand:')
        aimAt(door)
        if (kerbside) setStep(away < KERB_RANGE ? `Stop and hand over at the kerb, or walk it to ${story.customer}’s ${spot}` : away < PARK_RANGE ? `Stop by ${story.customer}’s ${spot}` : null)
        else setStep(away < PARK_RANGE ? `Park and walk to ${story.customer}’s ${door.atGate ? 'gate' : 'door'}` : null)
        return
      }
      if (away > PARK_RANGE * 1.5) {
        clearSpots('errand:')
        setStep(`Get back on your ${vehicleWord()}`)
        aimAtVehicle()
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
      const security = (line: string, after = '') => sayLine(line, `Security · ${society.name}`, { after })
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
            security('guard.otp', ` Flat ${door.flat}.`)
            useGuard.setState({ card: { step: 'otp', ...card } })
            window.setTimeout(() => {
              stage.current = { ...stage.current, step: 'rung' }
              security('guard.match')
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
              security('guard.go', ` Floor ${door.floor}.`)
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
      // The guard first, where there is one; then the building's own door.
      if (afoot && away > PARK_RANGE * 1.5) aimAtVehicle()
      else aimAt(door.kind === 'society' && society && !errandLive.cleared ? society.guard : door)
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
          if (blocked) sayLine('guard.stop', `Security · ${name}`, { after: ' OTP and the register.', urgent: true })
          else {
            roomFor.current = door
            enterRoom('lobby', door, { x: door.outX, z: door.outZ }, name, name)
          }
        },
      })
      setStep(away > PARK_RANGE * 1.5 ? `Get back on your ${vehicleWord()}` : blocked ? (stage.current.step === 'approach' ? `Show the guard at ${name}’s gate your OTP: ${door.otp}` : 'Sign the visitors’ register') : `Walk in to ${name}: flat ${door.flat}, floor ${door.floor}`)
      return
    }
    setSpot('errand:lobby', null)
    // In a building that isn't this order's (a double order's first drop was here): out first.
    if (roomFor.current !== door) {
      clearSpots('errand:')
      showWayOut(true)
      return
    }
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
          else say('cust.lift')
        },
      })
      setSpot('errand:stairs', { x: liveRoom.x + stairs.x, z: liveRoom.z + stairs.z, radius: 1.4, room: 'lobby', priority: 2, text: `Stairs to floor ${door.floor}`, run: () => goUp('stairs') })
      setStep(`Take the lift or the stairs to floor ${door.floor}`)
      const up = door.liftWorks ? lift : stairs
      aimAt({ x: liveRoom.x + up.x, z: liveRoom.z + up.z }, true)
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
