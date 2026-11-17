import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { createWomanGeometry } from '../traffic/peopleShapes'
import { People } from '../traffic/Traffic'
import type { Pedestrian } from '../traffic/trafficLogic'
import { livePlayer } from '../game/livePlayer'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { ShopPerson } from './shopPeoplePlacement'

/*
 * People who stand about at shops (ART_DIRECTION.md: a street with life in it):
 * a shopkeeper in the doorway of some shops, and customers at the counter of
 * darshinis, chaat and tea stalls, now and then at a kirana. They stand, breathe
 * and sway, by the same shader as the walkers (`People` in Traffic.tsx).
 *
 * Only on the streets with the new ground for now (27th Main), so there are a
 * few dozen, not thousands: each is redrawn every frame. Even so, a person
 * model is thousands of triangles, so only those near the rider are drawn: the
 * list is picked again whenever the rider has moved `REFRESH` metres.
 */

/** People are drawn this near the rider, in metres; on Low, nearer. */
const REACH = 70
const LOW_REACH = 45
const REFRESH = 12

type Seen = { x: number; z: number; reach: number }

/** Whether the rider has moved far enough, or the reach changed, to pick again. */
function hasMoved(seen: Seen, reach: number): boolean {
  return seen.reach !== reach || Math.hypot(livePlayer.x - seen.x, livePlayer.z - seen.z) > REFRESH
}

function toPedestrian({ x, z, heading, tint, skin }: ShopPerson): Pedestrian {
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

export function ShopPeople({ people }: { people: ShopPerson[] }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const woman = useMemo(() => createWomanGeometry(), [])
  const bodies = useMemo(() => [getModel(scene, 'man'), getModel(scene, 'teen'), woman], [scene, woman])
  useEffect(() => () => woman.dispose(), [woman])
  const reach = useGameStore((state) => (QUALITY_PRESETS[state.quality].kitDetail === 0 ? LOW_REACH : REACH))
  const seen = useRef<Seen>({ x: Infinity, z: Infinity, reach: 0 })
  const [near, setNear] = useState<ShopPerson[]>([])
  useFrame(() => {
    if (!hasMoved(seen.current, reach)) return
    seen.current = { x: livePlayer.x, z: livePlayer.z, reach }
    setNear(people.filter((person) => Math.hypot(person.x - livePlayer.x, person.z - livePlayer.z) < reach))
  })
  const groups = useMemo(() => [0, 1, 2].map((body) => near.filter((person) => person.body === body).map(toPedestrian)), [near])
  return (
    <>
      {groups.map((items, body) => (items.length > 0 ? <People key={body} items={items} body={bodies[body]} /> : null))}
    </>
  )
}
