import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { isSaturday, PLINTH, STATUE_HEIGHT, type Agara as AgaraPlan } from './agaraPlacement'
import { ShopPeople } from './ShopPeople'
import { box, colored, merge } from './simpleShapes'
import { StiltParking } from './StiltParking'

/*
 * The Abhaya Anjaneya statue at Agara and the life at its temple's door (agaraPlacement.ts).
 *
 * The statue is one shape of about 3,000 triangles, drawn at any distance (the haze takes it far
 * off, as it does everything), so it stands over the rooftops from much of the map. Painted stone
 * with gilded crown, mace and ornaments; at night it's floodlit: a warm glow that comes up with the
 * street lamps.
 */

const STONE = '#b9a58c'
const STONE_SHADE = '#a08c74'
const CLOTH = '#c9692e'
const GOLD = '#d9a93a'
const GARLAND = '#e8862a'
const PLINTH_STONE = '#a9a297'
const PLINTH_BAND = '#8d867b'

const solid = (geometry: THREE.BufferGeometry, color: string) => colored(geometry.index ? geometry.toNonIndexed() : geometry, color)
/** A tapered round limb from `from` to `to`, `radiusFrom` to `radiusTo`. */
function limb(from: [number, number, number], to: [number, number, number], radiusFrom: number, radiusTo: number, color: string) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const length = a.distanceTo(b)
  const geometry = new THREE.CylinderGeometry(radiusTo, radiusFrom, length, 10)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return solid(geometry, color)
}
const ball = (at: [number, number, number], radius: number, color: string, squash: [number, number, number] = [1, 1, 1]) => {
  const geometry = new THREE.SphereGeometry(radius, 12, 9)
  geometry.scale(...squash)
  // Squashing leaves the normals a ball's: worked out again, while its corners are still shared.
  geometry.computeVertexNormals()
  geometry.translate(...at)
  return solid(geometry, color)
}

/**
 * Hanuman standing, facing +z: right hand raised, palm out, in blessing (abhaya); the mace (gada)
 * held upright at his left side, its head by his shoulder; his tail rising in an arc behind his head.
 * Drawn 1 unit to the metre, the plinth's foot at 0 and the crown's tip at STATUE_HEIGHT.
 */
function createStatueGeometry(): THREE.BufferGeometry {
  const base = 4.2 // The top of the plinth, where he stands.
  const figure = STATUE_HEIGHT - base
  const u = figure / 26 // The figure is modelled 26 units tall.
  const y = (units: number) => base + units * u
  const parts: THREE.BufferGeometry[] = []

  // The plinth: three steps, a banded block, and a lotus ring under his feet.
  parts.push(box([PLINTH + 2, 0.5, PLINTH + 2], [0, 0.25, 0], PLINTH_BAND))
  parts.push(box([PLINTH + 1, 0.5, PLINTH + 1], [0, 0.75, 0], PLINTH_STONE))
  parts.push(box([PLINTH, 2.4, PLINTH], [0, 2.2, 0], PLINTH_STONE))
  parts.push(box([PLINTH + 0.3, 0.35, PLINTH + 0.3], [0, 3.55, 0], PLINTH_BAND))
  const lotus = new THREE.CylinderGeometry(3.6, 4.1, 0.5, 16)
  lotus.translate(0, 3.95, 0)
  parts.push(solid(lotus, GOLD))

  // Legs and feet.
  for (const side of [-1, 1]) {
    parts.push(limb([side * 1.5 * u, y(0.3), 0], [side * 1.35 * u, y(5.2), 0], 1.0 * u, 1.25 * u, STONE))
    parts.push(limb([side * 1.35 * u, y(5.2), 0], [side * 1.1 * u, y(10.2), 0], 1.25 * u, 1.55 * u, STONE))
    parts.push(ball([side * 1.5 * u, y(0.35), 0.6 * u], 1.0 * u, STONE_SHADE, [1, 0.45, 1.6]))
    parts.push(ball([side * 1.38 * u, y(5.2), 0.1 * u], 1.25 * u, STONE))
    // Anklets.
    const anklet = new THREE.TorusGeometry(1.05 * u, 0.16 * u, 6, 12)
    anklet.rotateX(Math.PI / 2).translate(side * 1.48 * u, y(1.1), 0)
    parts.push(solid(anklet, GOLD))
  }
  // The cloth at the waist, with a gold border and a sash hanging in front.
  const cloth = new THREE.CylinderGeometry(2.45 * u, 2.75 * u, 3.6 * u, 14)
  cloth.translate(0, y(9.9), 0)
  parts.push(solid(cloth, CLOTH))
  const border = new THREE.TorusGeometry(2.72 * u, 0.2 * u, 6, 16)
  border.rotateX(Math.PI / 2).translate(0, y(8.15), 0)
  parts.push(solid(border, GOLD))
  const belt = new THREE.TorusGeometry(2.4 * u, 0.3 * u, 6, 16)
  belt.rotateX(Math.PI / 2).translate(0, y(11.7), 0)
  parts.push(solid(belt, GOLD))
  parts.push(box([1.1 * u, 4.2 * u, 0.3 * u], [0, y(9.4), 2.6 * u], GOLD))

  // Torso: waist to a broad chest, and the shoulders.
  parts.push(limb([0, y(11.6), 0], [0, y(15.4), 0], 2.3 * u, 2.9 * u, STONE))
  parts.push(ball([0, y(16.3), 0.15 * u], 3.0 * u, STONE, [1.12, 0.92, 0.82]))
  for (const side of [-1, 1]) parts.push(ball([side * 3.3 * u, y(17.5), 0], 1.35 * u, STONE))
  // The sacred thread and a garland of marigolds.
  const garland = new THREE.TorusGeometry(2.3 * u, 0.36 * u, 6, 16)
  garland.rotateX(Math.PI / 2 - 0.55).translate(0, y(16.6), 1.3 * u)
  parts.push(solid(garland, GARLAND))
  const necklace = new THREE.TorusGeometry(1.25 * u, 0.18 * u, 6, 14)
  necklace.rotateX(Math.PI / 2 - 0.3).translate(0, y(18.5), 0.5 * u)
  parts.push(solid(necklace, GOLD))

  // His right arm (at -x, as he faces +z): raised, the palm out in blessing.
  parts.push(limb([-3.4 * u, y(17.4), 0], [-4.6 * u, y(14.6), 0.9 * u], 1.15 * u, 0.95 * u, STONE))
  parts.push(limb([-4.6 * u, y(14.6), 0.9 * u], [-4.4 * u, y(18.0), 2.2 * u], 0.95 * u, 0.75 * u, STONE))
  parts.push(box([1.5 * u, 2.1 * u, 0.5 * u], [-4.35 * u, y(19.1), 2.45 * u], STONE))
  for (const [at, height] of [[y(14.6), 0.9 * u], [y(17.2), 2.0 * u]] as const) {
    const bangle = new THREE.TorusGeometry(0.95 * u, 0.17 * u, 6, 12)
    bangle.rotateX(Math.PI / 2).translate(-4.5 * u, at, height)
    parts.push(solid(bangle, GOLD))
  }
  // His left arm: down at his side, the hand on the mace's shaft.
  parts.push(limb([3.4 * u, y(17.4), 0], [4.3 * u, y(13.6), 0.3 * u], 1.15 * u, 0.95 * u, STONE))
  parts.push(limb([4.3 * u, y(13.6), 0.3 * u], [4.6 * u, y(10.6), 1.3 * u], 0.95 * u, 0.75 * u, STONE))
  parts.push(ball([4.65 * u, y(10.4), 1.45 * u], 0.8 * u, STONE))
  // The mace: its shaft from the plinth to his shoulder, a ribbed head and a finial.
  parts.push(limb([4.7 * u, y(0.2), 1.6 * u], [4.7 * u, y(15.2), 1.6 * u], 0.34 * u, 0.34 * u, GOLD))
  parts.push(ball([4.7 * u, y(17.0), 1.6 * u], 1.9 * u, GOLD, [1, 1.12, 1]))
  for (const height of [15.9, 18.1]) {
    const rib = new THREE.TorusGeometry(1.25 * u, 0.2 * u, 6, 12)
    rib.rotateX(Math.PI / 2).translate(4.7 * u, y(height), 1.6 * u)
    parts.push(solid(rib, STONE_SHADE))
  }
  const finial = new THREE.ConeGeometry(0.55 * u, 1.4 * u, 8)
  finial.translate(4.7 * u, y(19.8), 1.6 * u)
  parts.push(solid(finial, GOLD))

  // Neck and head: the muzzle a little forward, ears, and the tall crown.
  parts.push(limb([0, y(18.6), 0], [0, y(19.8), 0.1 * u], 1.0 * u, 0.95 * u, STONE))
  parts.push(ball([0, y(21.1), 0.15 * u], 1.75 * u, STONE, [1, 1.05, 1]))
  parts.push(ball([0, y(20.5), 1.35 * u], 0.95 * u, STONE_SHADE, [1.15, 0.8, 1]))
  for (const side of [-1, 1]) {
    parts.push(ball([side * 1.75 * u, y(21.2), 0], 0.5 * u, STONE_SHADE, [0.5, 1, 0.8]))
    // Earrings.
    parts.push(ball([side * 1.85 * u, y(20.4), 0.1 * u], 0.3 * u, GOLD))
  }
  const crownBand = new THREE.CylinderGeometry(1.7 * u, 1.8 * u, 0.7 * u, 14)
  crownBand.translate(0, y(22.5), 0)
  parts.push(solid(crownBand, GOLD))
  const crown = new THREE.CylinderGeometry(0.75 * u, 1.6 * u, 2.3 * u, 12)
  crown.translate(0, y(23.9), 0)
  parts.push(solid(crown, GOLD))
  const tip = new THREE.ConeGeometry(0.72 * u, 1.0 * u, 10)
  tip.translate(0, y(25.5), 0)
  parts.push(solid(tip, GOLD))

  // The tail: from the base of his back, out behind and up in an arc over his head.
  const tail = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, y(11.2), -2.2 * u),
      new THREE.Vector3(0.6 * u, y(11.0), -5.0 * u),
      new THREE.Vector3(1.0 * u, y(15.5), -7.0 * u),
      new THREE.Vector3(0.6 * u, y(21.5), -6.2 * u),
      new THREE.Vector3(0, y(24.6), -3.6 * u),
    ]),
    20,
    0.55 * u,
    8,
  )
  parts.push(solid(tail, STONE_SHADE))
  parts.push(ball([0, y(24.6), -3.6 * u], 0.75 * u, STONE_SHADE))

  const statue = merge(parts)
  statue.computeBoundingSphere()
  return statue
}

/** A seller's stall, its front to +z: a low table of marigold garlands, or coconuts heaped round a basket. */
function createStallGeometry(coconuts: boolean): THREE.BufferGeometry {
  const parts = [
    box([1.7, 0.08, 0.9], [0, 0.62, 0], '#7a5230'),
    ...[-0.75, 0.75].flatMap((x) => [-0.35, 0.35].map((z) => box([0.06, 0.6, 0.06], [x, 0.3, z], '#3a2c20'))),
    // A cloth awning on two poles.
    ...[-0.8, 0.8].map((x) => box([0.05, 1.9, 0.05], [x, 0.95, -0.42], '#4a4d51')),
    box([1.9, 0.05, 1.2], [0, 1.92, 0], coconuts ? '#3f7d5a' : '#c9452f'),
  ]
  if (coconuts) {
    for (let i = 0; i < 9; i++) parts.push(ball([-0.6 + (i % 5) * 0.3, 0.76 + Math.floor(i / 5) * 0.2, -0.1 + (i % 2) * 0.22], 0.14, i % 3 === 0 ? '#8a6a45' : '#6f8f3c'))
    parts.push(box([0.5, 0.25, 0.4], [0.5, 0.78, 0.15], '#b58a4c'))
  } else {
    // Garlands in coils: marigold orange and yellow, jasmine white.
    ;['#e8862a', '#f2b705', '#f3efe2', '#e8862a', '#f2b705'].forEach((color, i) => {
      const coil = new THREE.TorusGeometry(0.15, 0.06, 5, 10)
      coil.rotateX(Math.PI / 2).translate(-0.62 + i * 0.31, 0.72, 0.05)
      parts.push(solid(coil, color))
    })
    parts.push(box([1.5, 0.3, 0.04], [0, 1.55, -0.4], '#e8862a'))
  }
  return merge(parts)
}

/** Footwear left outside a door: a dozen pairs of sandals and slippers, set down any way. */
function createFootwearGeometry(): THREE.BufferGeometry {
  const colors = ['#3a2c20', '#7a5230', '#2b3a55', '#8c2f2a', '#4a4d51', '#c9b38a']
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 12; i++) {
    const x = ((i * 37) % 11) / 11 - 0.5
    const z = ((i * 53) % 7) / 7 - 0.5
    const turn = (((i * 29) % 9) / 9 - 0.5) * 0.9
    for (const side of [-0.07, 0.07]) {
      const shoe = box([0.09, 0.03, 0.25], [side, 0.015, 0], colors[i % colors.length])
      shoe.rotateY(turn).translate(x * 1.5, 0, z * 0.9)
      parts.push(shoe)
    }
  }
  return merge(parts)
}

/** Each plan item's shape, turned and moved to where it stands, all in one shape. */
function placeAll(items: { x: number; z: number; rotation: number; variation: number }[], shape: (item: { variation: number }) => THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (items.length === 0) return null
  return merge(items.map((item) => shape(item).rotateY(item.rotation).translate(item.x, 0, item.z)))
}

const FLOODLIGHT = new THREE.Color('#ffb46a')
// One of each for the game's life (there's one Agara), so the frame loop may change the statue's glow.
const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: FLOODLIGHT, emissiveIntensity: 0 })
const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })

export function Agara({ agara }: { agara: AgaraPlan }) {
  const day = useGameStore((state) => state.day)
  const statue = useMemo(() => (agara.statue ? createStatueGeometry() : null), [agara])
  const details = useMemo(() => {
    const stalls = placeAll(agara.stalls, ({ variation }) => createStallGeometry(variation >= 0.5))
    const footwear = placeAll(agara.footwear, createFootwearGeometry)
    const parts = [stalls, footwear].filter((part): part is THREE.BufferGeometry => part !== null)
    return parts.length ? merge(parts) : null
  }, [agara])
  useEffect(() => () => {
    statue?.dispose()
    details?.dispose()
  }, [statue, details])
  const crowd = useMemo(() => ({ standing: agara.crowd, walkers: [] }), [agara])

  // Floodlit after dark, coming up with the street lamps.
  useFrame(() => {
    stone.emissiveIntensity = liveSky.look.night * 0.38
  })

  return (
    <>
      {statue && agara.statue && (
        <mesh geometry={statue} material={stone} position={[agara.statue.x, 0, agara.statue.z]} rotation={[0, agara.statue.rotation, 0]} castShadow receiveShadow />
      )}
      {details && <mesh geometry={details} material={plain} castShadow receiveShadow />}
      <StiltParking vehicles={agara.autos} carModels={AUTO_ONLY} drawDistance={120} />
      {isSaturday(day) && agara.crowd.length > 0 && <ShopPeople people={crowd} />}
    </>
  )
}

const AUTO_ONLY = ['auto'] as const
