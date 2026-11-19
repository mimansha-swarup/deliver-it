import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import { liveRoom, ROOM_DEPTH, useRoom, type RoomKind } from '../game/rooms'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { createPerson } from '../traffic/person'
import { People } from '../traffic/Traffic'
import type { Pedestrian } from '../traffic/trafficLogic'
import { SHIRT_COLOR } from '../vehicle/shirtPrint'
import { planRoom } from './roomShapes'

/*
 * The room the rider is in, if any (game/rooms.ts): one mesh, its sign, and whoever works there.
 * Nothing is built or drawn while the rider is out on the street, so it costs the ride nothing.
 * The mesh carries its own shading (roomShapes.ts) and is drawn unlit, like the dark store's shelves
 * seen from the street: there's no sun down there to light it. It dims a little at night.
 */

const SIGN_FONT = "'Baloo Tamma 2', 'Arial Black', system-ui, sans-serif"

/** A room's sign: its name large, a line under it, in that kind of place's colours. */
function drawSign(kind: RoomKind, label: string, floor: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = kind === 'chai' ? 384 : 220
  const context = canvas.getContext('2d')
  if (context) {
    const look = {
      store: { back: '#0f1012', ink: '#ffffff', sub: '#f2b82a', title: 'ORDER PICKUP', line: 'Deliver It · riders only · ಆರ್ಡರ್ ಪಿಕಪ್' },
      chai: { back: '#7a1f12', ink: '#ffe9a8', sub: '#ffffff', title: label || 'Darshini', line: 'Chai ₹10 · Filter coffee ₹15 · Bun maska ₹15 · Idli vada ₹40' },
      lobby: { back: '#2f3a35', ink: '#f2e6d0', sub: '#c9d6cf', title: label || 'Residency', line: 'Lift ◀   Stairs ▶   Visitors: sign at the gate' },
      corridor: { back: '#2f3a35', ink: '#f2e6d0', sub: '#c9d6cf', title: `Floor ${floor}`, line: `Flats ${floor}01 · ${floor}02 · ${floor}03` },
    }[kind]
    context.fillStyle = look.back
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = look.ink
    let size = kind === 'chai' ? 120 : 104
    context.font = `800 ${size}px ${SIGN_FONT}`
    while (context.measureText(look.title).width > canvas.width - 80 && size > 40) {
      size -= 6
      context.font = `800 ${size}px ${SIGN_FONT}`
    }
    context.fillText(look.title, canvas.width / 2, canvas.height * (kind === 'chai' ? 0.36 : 0.4))
    context.fillStyle = look.sub
    context.font = `600 ${kind === 'chai' ? 40 : 34}px ${SIGN_FONT}`
    context.fillText(look.line, canvas.width / 2, canvas.height * 0.8, canvas.width - 60)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const STAFF_CLOTHES = [SHIRT_COLOR]

/** People standing about a room shift their weight from foot to foot. */
function shiftWeight(people: Pedestrian[], time: number) {
  for (const one of people) {
    one.stride = Math.PI / 2
    one.walking = 0.08 + Math.sin(time * 1.1 + one.tint * 9) * 0.06
  }
}

function RoomSet({ kind, label }: { kind: RoomKind; label: string }) {
  const plan = useMemo(() => planRoom(kind), [kind])
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const body = useMemo(() => getModel(scene, 'man'), [scene])
  const material = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true }), [])
  const sign = useMemo(() => drawSign(kind, label, liveRoom.floor), [kind, label])
  const signMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: sign }), [sign])
  useEffect(() => () => { sign.dispose(); signMaterial.dispose() }, [sign, signMaterial])
  useEffect(() => () => material.dispose(), [material])
  // Who's there: staff in the store's shirt, anyone else in their own clothes. Standing on the room's floor.
  const [staff, others] = useMemo(() => {
    const person = ({ x, z, heading, tint, skin }: (typeof plan.people)[number]) => {
      const made = createPerson(liveRoom.x + x, liveRoom.z + z, heading, tint, skin)
      made.deck = 1
      return made
    }
    return [plan.people.filter((one) => one.staff).map(person), plan.people.filter((one) => !one.staff).map(person)]
  }, [plan])
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    // A little dimmer and warmer after dark, as a room on its tube lights is.
    const night = liveSky.look.night
    material.color.setRGB(1 - 0.16 * night, 1 - 0.2 * night, 1 - 0.3 * night)
    signMaterial.color.copy(material.color)
    shiftWeight(staff, clock.elapsedTime)
    shiftWeight(others, clock.elapsedTime)
  })
  const { at, size, turn } = plan.sign
  return (
    <>
      <group ref={group} position={[liveRoom.x, ROOM_DEPTH, liveRoom.z]}>
        <mesh geometry={plan.geometry} material={material} />
        <mesh position={at} rotation={[0, turn, 0]} material={signMaterial}>
          <planeGeometry args={size} />
        </mesh>
      </group>
      {staff.length > 0 && <People items={staff} body={body} palette={kind === 'store' ? STAFF_CLOTHES : ['#f4f1e8']} ground={ROOM_DEPTH} />}
      {others.length > 0 && <People items={others} body={body} ground={ROOM_DEPTH} />}
    </>
  )
}

export function Rooms() {
  const kind = useRoom((state) => state.kind)
  const label = useRoom((state) => state.label)
  if (!kind) return null
  return <RoomSet key={`${kind} ${label} ${liveRoom.x} ${liveRoom.z} ${liveRoom.floor}`} kind={kind} label={label} />
}
