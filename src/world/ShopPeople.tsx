import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { createWomanGeometry } from '../traffic/peopleShapes'
import { People } from '../traffic/Traffic'
import type { Pedestrian } from '../traffic/trafficLogic'
import type { ShopPerson } from './shopPeoplePlacement'

/*
 * People who stand about at shops (ART_DIRECTION.md: a street with life in it):
 * a shopkeeper in the doorway of some shops, and customers at the counter of
 * darshinis, chaat and tea stalls, now and then at a kirana. They stand, breathe
 * and sway, by the same shader as the walkers (`People` in Traffic.tsx).
 *
 * Only on the streets with the new ground for now (27th Main), so there are a
 * few dozen, not thousands: each is redrawn every frame.
 */

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
  const groups = useMemo(() => [0, 1, 2].map((body) => people.filter((person) => person.body === body).map(toPedestrian)), [people])
  return (
    <>
      {groups.map((items, body) => (items.length > 0 ? <People key={body} items={items} body={bodies[body]} /> : null))}
    </>
  )
}
