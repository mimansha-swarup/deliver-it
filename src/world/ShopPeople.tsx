import { useMemo, useRef, useState } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { useGLTF } from '@react-three/drei'
import { STRIDE_PER_METRE } from '../traffic/gait'
import { getModel, TRAFFIC_MODELS_URL, EXTRA_PEOPLE, PEOPLE_MODELS_URL } from '../traffic/modelFiles'
import { People } from '../traffic/Traffic'
import type { Pedestrian, TrafficWorld } from '../traffic/trafficLogic'
import { lifeCounts } from '../dev/lifeCounts'
import { livePlayer } from '../game/livePlayer'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { ShopLife, ShopPerson, ShopWalker } from './shopPeoplePlacement'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('pedestrians')

/*
 * People at the shops (ART_DIRECTION.md: a street with life in it), planned by
 * shopPeoplePlacement.ts: shopkeepers, customers and people talking, who stand
 * and breathe and shift their weight or look at their phones, and a few walkers
 * pacing the footpath. All are drawn by the same shader as traffic's walkers
 * (`People` in Traffic.tsx), with the same two models, the man and the teen.
 *
 * There are thousands across the map, so only those near the rider are drawn,
 * and only the walkers among them move: a person model is thousands of
 * triangles. The list is picked again whenever the rider has moved `REFRESH` metres.
 */

/** People are drawn this near the rider, in metres; on Low, nearer, and with half the walkers. */
const REACH = 70
const LOW_REACH = 45
const REFRESH = 12
/** How quickly walkers start and stop, and turn, per second. */
const EASE = 3
const TURN = 4

type Seen = { x: number; z: number; reach: number }

/** Whether the rider has moved far enough, or the reach changed, to pick again. */
function hasMoved(seen: Seen, reach: number): boolean {
  return seen.reach !== reach || Math.hypot(livePlayer.x - seen.x, livePlayer.z - seen.z) > REFRESH
}

function toPedestrian({ x, z, heading, tint, skin }: { x: number; z: number; heading: number; tint: number; skin: number }): Pedestrian {
  return {
    lane: -1,
    along: 0,
    speed: 0,
    x,
    z,
    heading,
    lift: 0,
    tint,
    dodgeX: 0,
    dodgeZ: 0,
    stride: 0,
    walking: 0,
    skin,
    body: null,
    rotation: null,
    downTime: 0,
    down: 0,
    fallen: null,
    fallenLift: 0,
    rising: 0,
  }
}

function standingPedestrian(person: ShopPerson): Pedestrian {
  // Standing still, the stride only sets where they are in their own idle movements.
  return { ...toPedestrian(person), stride: person.phase, idle: person.idle }
}

/** A walker and where they are: how far along, which way, and how long they've stood at an end. */
type Walking = { plan: ShopWalker; person: Pedestrian; length: number; along: number; direction: 1 | -1; waited: number }

function startWalking(plan: ShopWalker): Walking {
  const [ax, az] = plan.from
  const [bx, bz] = plan.to
  const length = Math.hypot(bx - ax, bz - az)
  const along = plan.start * length
  const person = toPedestrian({ x: ax + ((bx - ax) * along) / length, z: az + ((bz - az) * along) / length, heading: Math.atan2(bx - ax, bz - az), tint: plan.tint, skin: plan.skin })
  person.walking = 1
  return { plan, person, length, along, direction: 1, waited: 0 }
}

/** Walks on, stops at the end of the stretch, stands a moment, turns, and walks back. */
function stepWalker(walker: Walking, delta: number) {
  const { plan, person, length } = walker
  const [ax, az] = plan.from
  const [bx, bz] = plan.to
  const atEnd = walker.direction > 0 ? walker.along >= length : walker.along <= 0
  if (atEnd) {
    walker.waited += delta
    if (walker.waited > plan.pause) {
      walker.direction = walker.direction > 0 ? -1 : 1
      walker.waited = 0
    }
  }
  const moving = atEnd ? 0 : 1
  person.walking = (person.walking ?? 0) + (moving - (person.walking ?? 0)) * Math.min(1, delta * EASE)
  const step = plan.speed * person.walking * delta
  walker.along = Math.max(0, Math.min(length, walker.along + walker.direction * step))
  person.stride += step * STRIDE_PER_METRE
  person.x = ax + ((bx - ax) * walker.along) / length
  person.z = az + ((bz - az) * walker.along) / length
  // Turns to face the way they'll go next, before setting off.
  const wanted = Math.atan2((bx - ax) * walker.direction, (bz - az) * walker.direction)
  const turn = Math.atan2(Math.sin(wanted - person.heading), Math.cos(wanted - person.heading))
  person.heading += turn * Math.min(1, delta * TURN)
}

/**
 * Getting on the bus. When one pulls up at a stop (it waits there nine seconds: trafficLogic.ts'
 * `BUS_STOP`), some of the people waiting walk to its door and are gone with it; a while after,
 * someone else comes along the footpath and stands in their place. `share` of those waiting get on
 * each bus; a bus counts as at the stop within `reach` metres of it; the next person comes after
 * between `comes` seconds (lowest to highest), from `from` metres along the footpath.
 */
const BOARD = { share: 0.6, reach: 16, pace: 1.5, comes: [18, 45], from: 7, door: 0.7 }
type Waiter = { person: ShopPerson; drawn: Pedestrian; mode: 'wait' | 'board' | 'gone' | 'come'; timer: number; bus: number }

/** One step of someone at a bus stop. `buses`: those standing at a stop now. */
function stepWaiter(waiter: Waiter, buses: { x: number; z: number; heading: number; radius: number; halfLength: number; id: number }[], delta: number) {
  const { person, drawn } = waiter
  const stop = person.stop
  if (!stop) return
  const walkTo = (x: number, z: number): boolean => {
    const toX = x - drawn.x
    const toZ = z - drawn.z
    const away = Math.hypot(toX, toZ)
    if (away < 0.25) return true
    const step = Math.min(away, BOARD.pace * delta)
    drawn.x += (toX / away) * step
    drawn.z += (toZ / away) * step
    drawn.heading = Math.atan2(toX, toZ)
    drawn.stride += step * STRIDE_PER_METRE
    drawn.walking = 1
    return false
  }
  if (waiter.mode === 'wait') {
    const bus = buses.find((one) => Math.hypot(one.x - stop.x, one.z - stop.z) < BOARD.reach)
    if (!bus || bus.id === waiter.bus) return
    // Each makes up their mind once about each bus: it's theirs, or it isn't.
    waiter.bus = bus.id
    if (((person.phase * 7.3 + bus.id * 0.61) % 1) < BOARD.share) waiter.mode = 'board'
  } else if (waiter.mode === 'board') {
    const bus = buses.find((one) => one.id === waiter.bus)
    // The front door, on the kerb side (the left).
    const there = bus && walkTo(bus.x + Math.cos(bus.heading) * (bus.radius + 0.25) + Math.sin(bus.heading) * bus.halfLength * BOARD.door, bus.z - Math.sin(bus.heading) * (bus.radius + 0.25) + Math.cos(bus.heading) * bus.halfLength * BOARD.door)
    if (!bus && !there) {
      // It left without them: back to the shelter, for the next one.
      waiter.mode = 'come'
    } else if (there) {
      lifeCounts.boarded++
      drawn.hidden = true
      waiter.mode = 'gone'
      waiter.timer = BOARD.comes[0] + ((person.phase * 3.7) % 1) * (BOARD.comes[1] - BOARD.comes[0])
    }
  } else if (waiter.mode === 'gone') {
    waiter.timer -= delta
    if (waiter.timer > 0) return
    // Someone new, coming along the footpath from past the end of the shelter.
    const side = person.phase % 2 < 1 ? 1 : -1
    drawn.x = person.x + stop.alongX * side * BOARD.from
    drawn.z = person.z + stop.alongZ * side * BOARD.from
    drawn.tint = (drawn.tint + 0.37) % 1
    drawn.hidden = false
    waiter.mode = 'come'
  } else if (walkTo(person.x, person.z)) {
    drawn.heading = person.heading
    drawn.walking = 0
    waiter.mode = 'wait'
  }
}

export function ShopPeople({ people, traffic }: { people: ShopLife; traffic?: TrafficWorld }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const { scene: extraPeople } = useGLTF(PEOPLE_MODELS_URL)
  // The plans say one of two bodies; each stands for three here, picked by the person's own tint, so
  // the same plan gives a mixed crowd: the man, the striped shirt or the office-goer; the teenager,
  // the man in a plain shirt or the woman in a saree.
  const bodies = useMemo(() => [getModel(scene, 'man'), getModel(scene, 'teen'), ...EXTRA_PEOPLE.map((name) => getModel(extraPeople, name))], [scene, extraPeople])
  const bodyOf = (body: number, tint: number) => (body + Math.floor((tint % 1) * 2.999) * 2) % bodies.length
  const low = useGameStore((state) => QUALITY_PRESETS[state.quality].kitDetail === 0)
  const reach = low ? LOW_REACH : REACH

  const standing = useMemo(() => people.standing.map((person) => ({ person, drawn: standingPedestrian(person) })), [people])
  const walkers = useMemo(() => people.walkers.map(startWalking), [people])
  const seen = useRef<Seen>({ x: Infinity, z: Infinity, reach: 0 })
  const [near, setNear] = useState<{ body: number; drawn: Pedestrian }[]>([])
  /** The walkers near the rider: only they are moved. Far away, nobody sees where they are. */
  const moving = useRef<Walking[]>([])
  /** Those waiting at bus stops near the rider, and the buses standing at stops just now (kept, and refilled). */
  const [waiters] = useState(() => new Map<ShopPerson, Waiter>())
  const waiting = useRef<Waiter[]>([])
  const buses = useRef<{ x: number; z: number; heading: number; radius: number; halfLength: number; id: number }[]>([])

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1)
    for (const walker of moving.current) stepWalker(walker, step)
    // Buses standing at stops, and the people there who get on them.
    if (traffic && waiting.current.length > 0) {
      let count = 0
      for (let index = 0; index < traffic.vehicles.length; index++) {
        const vehicle = traffic.vehicles[index]
        if (vehicle.kind !== 'bus' || vehicle.lane === -1 || !((vehicle.busDwell ?? 0) > 0)) continue
        const bus = (buses.current[count++] ??= { x: 0, z: 0, heading: 0, radius: 0, halfLength: 0, id: 0 })
        bus.x = vehicle.x
        bus.z = vehicle.z
        bus.heading = vehicle.heading
        bus.radius = vehicle.radius
        bus.halfLength = vehicle.halfLength
        // Which bus, and which of its stops: a new number each time it pulls up somewhere.
        bus.id = index * 1000 + ((vehicle.servedStop ?? 0) % 997) + 1
      }
      buses.current.length = count
      let boarding = 0
      for (const waiter of waiting.current) {
        stepWaiter(waiter, buses.current, step)
        if (waiter.mode === 'board') boarding++
      }
      lifeCounts.boarding = boarding
      lifeCounts.atStops = waiting.current.length
    }
    if (!hasMoved(seen.current, reach)) return
    seen.current = { x: livePlayer.x, z: livePlayer.z, reach }
    const isNear = (x: number, z: number, extra = 0) => Math.hypot(x - livePlayer.x, z - livePlayer.z) < reach + extra
    // On Low, every other walker stays home.
    const shown = low ? walkers.filter((_walker, i) => i % 2 === 0) : walkers
    // A walker may be anywhere on their stretch by the next pick, so they count from its middle.
    moving.current = shown.filter(({ plan, length }) => isNear((plan.from[0] + plan.to[0]) / 2, (plan.from[1] + plan.to[1]) / 2, length / 2))
    const nearStanding = standing.filter(({ person }) => isNear(person.x, person.z))
    waiting.current = nearStanding.flatMap(({ person, drawn }) => {
      if (!person.stop) return []
      let waiter = waiters.get(person)
      if (!waiter) waiters.set(person, (waiter = { person, drawn, mode: 'wait', timer: 0, bus: 0 }))
      return [waiter]
    })
    lifeCounts.shopPeople = nearStanding.length
    lifeCounts.shopWalkers = moving.current.length
    setNear([
      ...nearStanding.map(({ person, drawn }) => ({ body: bodyOf(person.body, person.tint), drawn })),
      ...moving.current.map(({ plan, person }) => ({ body: bodyOf(plan.body, plan.tint), drawn: person })),
    ])
  })
  const groups = useMemo(() => bodies.map((_, body) => near.filter((item) => item.body === body).map((item) => item.drawn)), [near, bodies])
  return (
    <>
      {groups.map((items, body) => (items.length > 0 ? <People key={body} items={items} body={bodies[body]} /> : null))}
    </>
  )
}
