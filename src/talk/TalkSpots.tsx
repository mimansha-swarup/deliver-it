import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { timedFrame } from '../dev/frameTimes'
import { lifeCounts } from '../dev/lifeCounts'
import { doorsteps } from '../game/doorsteps'
import { eateries } from '../game/eateries'
import { useGameStore } from '../game/gameStore'
import { clearSpots, setSpot } from '../game/interact'
import { liveRoom } from '../game/rooms'
import { EXTRA_PEOPLE, getModel, PEOPLE_MODELS_URL, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { createPerson } from '../traffic/person'
import { People } from '../traffic/Traffic'
import { holdVehicle, releaseVehicle, takeBumpedAuto, type Pedestrian, type TrafficWorld, type Vehicle } from '../traffic/trafficLogic'
import { getTravelSpeed, isAfoot, type ScooterState } from '../vehicle/ScooterController'
import { isNearBuilding, type CollisionWorld } from '../world/collision'
import type { DarkStore } from '../world/darkStore'
import type { RoadGraph } from '../world/roadGraph'
import { bark, characterAt, closeTalk, earn, keepTalkNear, openTalk, talkLive, talkPlaces, useTalk, useTalkGoal, watchTalk, type Character, type Plan } from './talk'

type Stop = (typeof talkPlaces.stops)[number]

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('missions and markers')

/*
 * The people the rider can talk to (talk.ts; who they are and what they say is characters.json),
 * stood in the world by where each belongs:
 *
 *   chaiStall    the chai anna, outside every chai stall, beside its door
 *   societyGate  the guard at the gated society's gate (he's drawn by the gate itself)
 *   darkStore    two fellow riders waiting outside each dark store
 *   busStop      an aunty who has lost her way, at one bus stop in four
 *   bumpedAuto   the driver of an auto the rider has run into, out beside it
 *
 * and what their talk can set going: a lift for the aunty to the stop she asked for, a time trial
 * a fellow rider dares, an auto held at the kerb while its driver has his say. Only the people
 * near the rider are drawn (one instanced mesh for each body among them), and all of this is
 * looked at four times a second, not every frame.
 */

const BODIES = ['man', 'teen', ...EXTRA_PEOPLE] as const
/** People are drawn within this of the rider, and can be talked to within `TALK` of them, in metres. */
const DRAWN = 65
const TALK = 2.4
const CHECK_EVERY = 0.25
/** They turn to face a rider on foot this near, this fast (radians a second). */
const NOTICE = { within: 7, turn: 3 }
/** A lift ends, and a race is won, this near the place, in metres; a lift also needs the rider nearly stopped (m/s). */
const ARRIVE = { lift: 14, liftSpeed: 2, trial: 16 }
/** How far away the aunty's place and a race's end may be, in metres; a race allows `pace` m/s along a road `wiggle` times the straight line, and `slack` seconds more. */
const FAR = { lift: [220, 800], trial: [320, 760], pace: 7, wiggle: 1.45, slack: 10 }
/** The auto anna: how long he holds his auto at the kerb, how long between one bump's argument and the next, and how slow the auto must be before he's out, in seconds and m/s. */
const AUTO = { holds: 40, rest: 75, stopped: 0.4, gone: 1.6 }

type Standing = { character: Character; person: Pedestrian; body: number; heading: number; key: string; stop?: Stop }
type AutoAnna = Standing & { vehicle: Vehicle | null; out: boolean; leaving: number }

function createAutoAnna(): AutoAnna | null {
  const character = characterAt('bumpedAuto')
  if (!character) return null
  const anna = { ...stand(character, 0, 0, 0, 'auto', 5), vehicle: null, out: false, leaving: 0 }
  anna.person.hidden = true
  return anna
}

const bodyOf = (name: string) => Math.max(0, (BODIES as readonly string[]).indexOf(name))

function stand(character: Character, x: number, z: number, heading: number, key: string, vary: number, stop?: Stop): Standing {
  const person = createPerson(x, z, heading, (character.look.tint + vary * 0.13) % 1, 0.74 + ((vary * 0.37) % 0.28))
  person.idle = 1 + (vary % 2) * 2
  person.stride = vary * 1.7
  return { character, person, body: bodyOf(character.look.body), heading, key, stop }
}

/** Everyone who stands somewhere fixed: worked out once from the map. */
function planStanding(stores: DarkStore[], collisions: CollisionWorld): Standing[] {
  const standing: Standing[] = []
  const clear = (x: number, z: number) => !isNearBuilding(collisions, x, z, 0.32)
  const chai = characterAt('chaiStall')
  if (chai) {
    eateries.list.forEach((eatery, index) => {
      if (eatery.kind !== 'chai') return
      // Beside the door, a step out from the front: whichever side is clear.
      for (const side of index % 2 ? [1, -1] : [-1, 1]) {
        const x = eatery.x + eatery.outZ * side * 1.9 + eatery.outX * 0.85
        const z = eatery.z - eatery.outX * side * 1.9 + eatery.outZ * 0.85
        if (!clear(x, z)) continue
        standing.push(stand(chai, x, z, Math.atan2(eatery.outX, eatery.outZ), `chai:${index}`, index))
        break
      }
    })
  }
  const rider = characterAt('darkStore')
  if (rider) {
    stores.forEach((store, index) => {
      const outX = Math.sin(store.rotation)
      const outZ = Math.cos(store.rotation)
      const side = index % 2 ? 1 : -1
      // Two of them, off to one side of the door, half turned to each other.
      const places: [number, number, number][] = [[store.width * 0.38, 1.5, 0.5], [store.width * 0.38 - 1.1, 2.2, -0.6]]
      places.forEach(([across, out, turn], who) => {
        const x = store.x + outZ * side * across + outX * out
        const z = store.z - outX * side * across + outZ * out
        if (clear(x, z)) standing.push(stand(rider, x, z, store.rotation + turn * side, `rider:${index}:${who}`, index * 2 + who + 3))
      })
    })
  }
  const aunty = characterAt('busStop')
  if (aunty) {
    talkPlaces.stops.forEach((stop, index) => {
      if (index % 4 !== 1 || !stop.name) return
      // At the end of the shelter, a step out towards the road.
      const x = stop.x + Math.cos(stop.rotation) * 2.3 + Math.sin(stop.rotation) * 0.5
      const z = stop.z - Math.sin(stop.rotation) * 2.3 + Math.cos(stop.rotation) * 0.5
      if (clear(x, z)) standing.push(stand(aunty, x, z, stop.rotation, `aunty:${index}`, index, stop))
    })
  }
  return standing
}

/** The road point nearest a place, for the map's waypoint. */
function nearestNode(graph: RoadGraph, x: number, z: number): number {
  let best = 0
  let bestDistance = Infinity
  for (let node = 0; node < graph.xs.length; node++) {
    const distance = Math.abs(graph.xs[node] - x) + Math.abs(graph.zs[node] - z)
    if (distance < bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best
}

/** A named bus stop between `from` and `to` metres of a point: the nearest such, so the trip is a short one. */
function stopNear(x: number, z: number, [from, to]: number[], not?: Stop): Stop | null {
  let best: Stop | null = null
  let bestDistance = Infinity
  for (const stop of talkPlaces.stops) {
    if (!stop.name || stop === not) continue
    const distance = Math.hypot(stop.x - x, stop.z - z)
    if (distance < from || distance > to) continue
    // Not always the very nearest: a little chance in it, so the same aunty doesn't always want the same stop.
    const score = distance * (0.7 + Math.random() * 0.6)
    if (score < bestDistance) {
      best = stop
      bestDistance = score
    }
  }
  return best
}

export function TalkSpots({ scooter, world, stores, collisions, graph }: { scooter: RefObject<ScooterState>; world: TrafficWorld; stores: DarkStore[]; collisions: CollisionWorld; graph: RoadGraph }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const { scene: extraPeople } = useGLTF(PEOPLE_MODELS_URL)
  const bodies = useMemo(() => [getModel(scene, 'man'), getModel(scene, 'teen'), ...EXTRA_PEOPLE.map((name) => getModel(extraPeople, name))], [scene, extraPeople])
  const standing = useMemo(() => planStanding(stores, collisions), [stores, collisions])
  /** The auto anna, when there is one: his auto, and how long since he had his say. Made the first time he's looked for. */
  const autoRef = useRef<AutoAnna | null | undefined>(undefined)
  const [near, setNear] = useState<Standing[]>([])
  /** The same people as `near`, for the frame to turn and move. */
  const drawnNow = useRef<Standing[]>([])
  const nearKey = useRef('')
  const since = useRef(0)
  const sinceAuto = useRef(AUTO.rest)
  /** Who is being talked to: the aunty's own stop is where her lift starts from. */
  const talkingTo = useRef<Standing | null>(null)
  const riding = useRef<Standing | null>(null)

  useEffect(() => watchTalk(), [])
  useEffect(() => {
    lifeCounts.talkers = standing.length
    // Debug: where they stand, to go and find them from a script (`__deliverItTalk.people`, with ?debug).
    const debug = (window as unknown as { __deliverItTalk?: { people?: unknown } }).__deliverItTalk
    if (debug) debug.people = standing.map(({ key, person }) => ({ key, x: person.x, z: person.z }))
    const waypointTo = (plan: Plan) => useGameStore.getState().setWaypoint({ x: plan.x, z: plan.z, node: nearestNode(graph, plan.x, plan.z) })
    talkLive.planLift = () => {
      const from = talkingTo.current
      const { x, z } = from?.person ?? scooter.current.rider
      const stop = stopNear(x, z, FAR.lift, from?.stop)
      if (!stop) return null
      const distance = Math.hypot(stop.x - x, stop.z - z)
      return { place: `${stop.name} bus stop`, x: stop.x, z: stop.z, seconds: 0, reward: 15 + Math.round(distance / 40) }
    }
    talkLive.startLift = (plan) => {
      talkLive.lift = plan
      riding.current = talkingTo.current
      if (riding.current) riding.current.person.hidden = true
      waypointTo(plan)
    }
    talkLive.planTrial = () => {
      const { x, z } = scooter.current.rider.phase === 'on' ? scooter.current : scooter.current.rider
      const stop = stopNear(x, z, FAR.trial)
      if (!stop) return null
      const distance = Math.hypot(stop.x - x, stop.z - z)
      return { place: `${stop.name} bus stop`, x: stop.x, z: stop.z, seconds: Math.round((distance * FAR.wiggle) / FAR.pace + FAR.slack), reward: 20 + Math.round(distance / 30) }
    }
    talkLive.startTrial = (plan) => {
      talkLive.trial = { ...plan, left: plan.seconds }
      waypointTo(plan)
    }
    return () => {
      talkLive.planLift = talkLive.startLift = talkLive.planTrial = talkLive.startTrial = talkLive.release = null
      clearSpots('talk:')
      closeTalk()
    }
  }, [standing, graph, scooter])

  useFrame((_, delta) => {
    const state = scooter.current
    const afoot = isAfoot(state)
    const me = state.rider.phase === 'on' ? state : state.rider
    const step = Math.min(delta, 0.1)

    // A race against the clock: it runs every frame, so the seconds are true.
    const trial = talkLive.trial
    if (trial) {
      trial.left -= step
      const away = Math.hypot(trial.x - me.x, trial.z - me.z)
      if (away < ARRIVE.trial || trial.left <= 0) {
        const won = away < ARRIVE.trial
        if (won) earn('Time trial won', trial.reward)
        // On the phone: he's back at the dark store.
        bark(won ? 'talk.rider.win' : 'talk.rider.lose', 'Fellow rider', 'phone')
        if (won) useGameStore.getState().postChat('customer', 'Fellow rider', `You made it with ${Math.ceil(trial.left)} s to spare. ₹${trial.reward}, for a chai.`)
        talkLive.trial = null
        useGameStore.getState().setWaypoint(null)
      }
    }
    // People near a rider on foot turn to them; otherwise they stand as they were.
    for (const one of drawnNow.current) {
      if (one.person.hidden) continue
      const close = afoot && Math.abs(one.person.x - me.x) < NOTICE.within && Math.abs(one.person.z - me.z) < NOTICE.within
      const wanted = close ? Math.atan2(me.x - one.person.x, me.z - one.person.z) : one.heading
      const turn = Math.atan2(Math.sin(wanted - one.person.heading), Math.cos(wanted - one.person.heading))
      if (Math.abs(turn) > 0.01) one.person.heading += turn * Math.min(1, step * NOTICE.turn)
    }

    since.current += delta
    sinceAuto.current += delta
    if (since.current < CHECK_EVERY) return
    since.current = 0
    // A talk the rider has ridden or walked away from is over.
    keepTalkNear(me.x, me.z)

    // ---- The aunty's lift: there, and nearly stopped, she gets down, tips, and stands at the stop.
    const lift = talkLive.lift
    if (lift) {
      const away = Math.hypot(lift.x - me.x, lift.z - me.z)
      if (away < ARRIVE.lift && getTravelSpeed(state) < ARRIVE.liftSpeed) {
        earn('Tip from aunty', lift.reward)
        bark('talk.aunty.drop', 'Aunty')
        useGameStore.getState().postChat('customer', 'Aunty', `Dropped at ${lift.place}. She tipped ₹${lift.reward}.`)
        const aunty = riding.current
        if (aunty) {
          aunty.person.x = lift.x + Math.sin(aunty.heading) * 0.6
          aunty.person.z = lift.z + Math.cos(aunty.heading) * 0.6
          aunty.person.hidden = false
        }
        riding.current = null
        talkLive.lift = null
        useGameStore.getState().setWaypoint(null)
      }
    }
    const goal = talkLive.trial
      ? `Time trial · ${talkLive.trial.place} · ${Math.max(0, Math.ceil(talkLive.trial.left))} s · ${Math.round(Math.hypot(talkLive.trial.x - me.x, talkLive.trial.z - me.z))} m`
      : talkLive.lift
        ? `Aunty is riding with you · ${talkLive.lift.place} · ${Math.round(Math.hypot(talkLive.lift.x - me.x, talkLive.lift.z - me.z))} m`
        : null
    if (useTalkGoal.getState().text !== goal) useTalkGoal.setState({ text: goal })

    // ---- The auto anna: an auto the rider has run into pulls in, and its driver gets out to say so.
    if (autoRef.current === undefined) autoRef.current = createAutoAnna()
    const autoAnna = autoRef.current
    if (autoAnna) {
      const bumped = takeBumpedAuto(world)
      if (bumped && !autoAnna.vehicle && sinceAuto.current > AUTO.rest && state.rider.phase === 'on' && bumped.lane !== -1 && !bumped.body) {
        autoAnna.vehicle = bumped
        autoAnna.out = false
        autoAnna.leaving = 0
        holdVehicle(bumped, AUTO.holds)
        bark('talk.auto.bump', 'Auto anna')
        talkLive.release = () => {
          if (autoAnna.vehicle) releaseVehicle(autoAnna.vehicle)
          autoAnna.leaving = AUTO.gone
        }
      }
      const auto = autoAnna.vehicle
      if (auto) {
        // Knocked over or taken off the road, it's over at once; let go (or out of patience), he takes a moment to get back in.
        const gone = auto.lane === -1 || !!auto.body
        if (autoAnna.leaving > 0) autoAnna.leaving -= CHECK_EVERY
        if (gone || (!auto.halt && autoAnna.leaving <= 0)) {
          // He's back in, and it's traffic again.
          autoAnna.vehicle = null
          autoAnna.out = false
          autoAnna.person.hidden = true
          sinceAuto.current = 0
          if (useTalk.getState().card?.character === autoAnna.character) closeTalk()
        } else if (!autoAnna.out && auto.speed < AUTO.stopped) {
          // Out on the kerb side (the left), by his door, facing whoever hit him.
          autoAnna.out = true
          autoAnna.person.hidden = false
          autoAnna.person.x = auto.x + Math.cos(auto.heading) * (auto.radius + 0.55)
          autoAnna.person.z = auto.z - Math.sin(auto.heading) * (auto.radius + 0.55)
          autoAnna.heading = Math.atan2(me.x - autoAnna.person.x, me.z - autoAnna.person.z)
          autoAnna.person.heading = autoAnna.heading
          autoAnna.person.idle = 3
        }
      } else autoAnna.person.hidden = true
    }

    // ---- Who is near: drawn, and (on foot, on the street) offered for a talk.
    const drawn: Standing[] = []
    for (const one of standing) {
      if (Math.abs(one.person.x - me.x) < DRAWN && Math.abs(one.person.z - me.z) < DRAWN) drawn.push(one)
    }
    if (autoAnna?.out) drawn.push(autoAnna)
    const key = drawn.map((one) => one.key).join()
    if (key !== nearKey.current) {
      nearKey.current = key
      clearSpots('talk:')
      drawnNow.current = drawn
      setNear(drawn)
    }
    lifeCounts.talkersDrawn = drawn.length
    const talking = useTalk.getState().card !== null
    const open = afoot && !liveRoom.kind && !talking
    for (const one of drawn) {
      const reach = open && !one.person.hidden && Math.hypot(one.person.x - me.x, one.person.z - me.z) < TALK + 3
      setSpot(`talk:${one.key}`, reach ? { x: one.person.x, z: one.person.z, radius: TALK, text: one.character.prompt, run: () => { talkingTo.current = one; openTalk(one.character) } } : null)
    }
    // The guard stands at the gate already (SocietyGate.tsx): a talk when there's no delivery to sign in (that spot outranks this one).
    const society = doorsteps.society
    const guard = characterAt('societyGate')
    if (society && guard) {
      const reach = open && Math.hypot(society.guard.x - me.x, society.guard.z - me.z) < 6
      setSpot('talk:guard', reach ? { x: society.guard.x, z: society.guard.z, radius: 2.8, priority: -1, text: guard.prompt, run: () => { talkingTo.current = null; openTalk(guard) } } : null)
    }
  })

  const groups = useMemo(() => bodies.map((_, body) => near.filter((one) => one.body === body).map((one) => one.person)), [near, bodies])
  return (
    <>
      {groups.map((items, body) => (items.length > 0 ? <People key={body} items={items} body={bodies[body]} /> : null))}
    </>
  )
}
