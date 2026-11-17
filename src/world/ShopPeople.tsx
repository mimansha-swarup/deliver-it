import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { STRIDE_PER_METRE } from '../traffic/gait'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { People } from '../traffic/Traffic'
import type { Pedestrian } from '../traffic/trafficLogic'
import { livePlayer } from '../game/livePlayer'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { ShopLife, ShopPerson, ShopWalker } from './shopPeoplePlacement'

/*
 * People at the shops (ART_DIRECTION.md: a street with life in it), planned by
 * shopPeoplePlacement.ts: shopkeepers, customers and people talking, who stand
 * and breathe and shift their weight or look at their phones, and a few walkers
 * pacing the footpath. All are drawn by the same shader as traffic's walkers
 * (`People` in Traffic.tsx), with the same two models, the man and the teen.
 *
 * Only on the streets with the new ground for now (27th Main), so there are a
 * few dozen, not thousands: each is redrawn every frame. Even so, a person
 * model is thousands of triangles, so only those near the rider are drawn: the
 * list is picked again whenever the rider has moved `REFRESH` metres.
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

export function ShopPeople({ people }: { people: ShopLife }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const bodies = useMemo(() => [getModel(scene, 'man'), getModel(scene, 'teen')], [scene])
  const low = useGameStore((state) => QUALITY_PRESETS[state.quality].kitDetail === 0)
  const reach = low ? LOW_REACH : REACH

  const standing = useMemo(() => people.standing.map((person) => ({ person, drawn: standingPedestrian(person) })), [people])
  const walkers = useMemo(() => people.walkers.map(startWalking), [people])
  const seen = useRef<Seen>({ x: Infinity, z: Infinity, reach: 0 })
  const [near, setNear] = useState<{ body: number; drawn: Pedestrian }[]>([])

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1)
    const shown = low ? walkers.slice(0, Math.ceil(walkers.length / 2)) : walkers
    for (const walker of shown) stepWalker(walker, step)
    if (!hasMoved(seen.current, reach)) return
    seen.current = { x: livePlayer.x, z: livePlayer.z, reach }
    const isNear = (x: number, z: number, extra = 0) => Math.hypot(x - livePlayer.x, z - livePlayer.z) < reach + extra
    setNear([
      ...standing.filter(({ person }) => isNear(person.x, person.z)).map(({ person, drawn }) => ({ body: person.body, drawn })),
      // A walker may be anywhere on their stretch by the next pick, so they count from its middle.
      ...shown
        .filter(({ plan, length }) => isNear((plan.from[0] + plan.to[0]) / 2, (plan.from[1] + plan.to[1]) / 2, length / 2))
        .map(({ plan, person }) => ({ body: plan.body, drawn: person })),
    ])
  })
  const groups = useMemo(() => bodies.map((_, body) => near.filter((item) => item.body === body).map((item) => item.drawn)), [near, bodies])
  return (
    <>
      {groups.map((items, body) => (items.length > 0 ? <People key={body} items={items} body={bodies[body]} /> : null))}
    </>
  )
}
