import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { chunkKey } from './chunks'
import { groundLift } from './groundLift'
import { createRandom } from './props'
import type { ShopFront } from './shopFrontPlacement'
import { colored } from './simpleShapes'
import type { ShopType } from './signboards'

/*
 * The 3D front of every shop, in front of its room (ART_DIRECTION.md: shops
 * should read as places you could walk into):
 *
 * - the rolled-up shutter in its box over the doorway, its guide rails down
 *   each side, and a granite step;
 * - what each kind of shop puts out front: strips of snack packets hanging from
 *   the shutter box and rice sacks at a kirana, a steel counter with big vessels
 *   at a darshini, a kettle and glasses at a chai stall, a glass display at a
 *   bakery, glass counters at chemists and phone shops, a rail of clothes, and
 *   buckets and pipes at a hardware shop;
 * - a cool-drinks fridge by the door at some.
 *
 * All vertex-coloured, merged into one shape per map square. Not solid: it
 * all stands within about half a metre of the wall.
 */

/** Matches ShopFronts.tsx: the room's top, under the shutter box. */
export const SHUTTER_BOTTOM = 2.62
const SHUTTER_TOP = 2.88

const PACKETS = ['#e8352b', '#f6c21c', '#2a7fc2', '#2fa34a', '#f07a1a', '#b23aa8', '#d9262b', '#14a3a3']
const STEEL = '#c9ccd0'
const FRIDGES = ['#c8202a', '#1f5fae', '#d8d8d8']

type Frame = {
  /** The shop's middle at the wall, and the way out from the wall and to the right along it. */
  x: number
  z: number
  lift: number
  rotation: number
}

/** A box in the shop's own frame: `across` to the right of the middle, `out` from the wall, from `bottom` up. */
function box(frame: Frame, across: number, out: number, bottom: number, width: number, height: number, depth: number, color: string): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth).toNonIndexed()
  geometry.translate(across, frame.lift + bottom + height / 2, out)
  geometry.rotateY(frame.rotation)
  geometry.translate(frame.x, 0, frame.z)
  return colored(geometry, color)
}

function cylinder(frame: Frame, across: number, out: number, bottom: number, radius: number, height: number, color: string, top = radius): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(top, radius, height, 10).toNonIndexed()
  geometry.translate(across, frame.lift + bottom + height / 2, out)
  geometry.rotateY(frame.rotation)
  geometry.translate(frame.x, 0, frame.z)
  return colored(geometry, color)
}

/** A counter at the front, to one side of the doorway: a body and a lighter top. */
function counter(parts: THREE.BufferGeometry[], frame: Frame, across: number, width: number, height: number, body: string, top: string) {
  parts.push(box(frame, across, 0.3, 0, width, height - 0.04, 0.5, body))
  parts.push(box(frame, across, 0.3, height - 0.04, width + 0.04, 0.04, 0.54, top))
}

function fridge(parts: THREE.BufferGeometry[], frame: Frame, across: number, color: string) {
  parts.push(box(frame, across, 0.36, 0, 0.62, 1.75, 0.6, color))
  // The glass door, a paler panel on the front, with rows of bottles behind it.
  parts.push(box(frame, across, 0.67, 0.25, 0.5, 1.2, 0.02, '#d9eef2'))
  for (let shelf = 0; shelf < 4; shelf++) parts.push(box(frame, across, 0.68, 0.32 + shelf * 0.3, 0.44, 0.16, 0.02, PACKETS[shelf * 2]))
}

/** Strips of snack packets hanging from the shutter box, across the doorway. */
function snackStrips(parts: THREE.BufferGeometry[], frame: Frame, width: number, random: () => number, share = 1) {
  const count = Math.max(2, Math.floor((width * share) / 0.32))
  for (let strip = 0; strip < count; strip++) {
    if (random() < 0.2) continue
    const across = -width * share / 2 + (strip + 0.5) * ((width * share) / count)
    const color = PACKETS[Math.floor(random() * PACKETS.length)]
    const packets = 3 + Math.floor(random() * 4)
    for (let packet = 0; packet < packets; packet++) {
      parts.push(box(frame, across, 0.3, SHUTTER_BOTTOM - 0.06 - (packet + 1) * 0.21, 0.15, 0.19, 0.03, color))
    }
  }
}

/** What each kind of shop puts at its front. `width` is the doorway; `side` picks which side the counter goes. */
const FRONTS: Record<ShopType, (parts: THREE.BufferGeometry[], frame: Frame, width: number, side: number, random: () => number) => void> = {
  kirana: (parts, frame, width, side, random) => {
    snackStrips(parts, frame, width, random)
    counter(parts, frame, side * width * 0.25, width * 0.4, 0.95, '#7a5a3a', '#cdb48c')
    // Jars of sweets on the counter, and rice sacks by the door.
    for (let jar = 0; jar < 4; jar++) parts.push(cylinder(frame, side * width * 0.25 + (jar - 1.5) * 0.22, 0.3, 0.95, 0.08, 0.24, PACKETS[jar + 1]))
    for (let sack = 0; sack < 2; sack++) parts.push(cylinder(frame, -side * (width * 0.38 - sack * 0.45), 0.35, 0, 0.2, 0.6, '#e8dcbc', 0.17))
  },
  general: (parts, frame, width, side, random) => {
    snackStrips(parts, frame, width, random, 0.6)
    counter(parts, frame, side * width * 0.25, width * 0.4, 0.95, '#6d5844', '#c9b28d')
  },
  supermarket: (parts, frame, width, side) => {
    // Baskets stacked by the door.
    for (let basket = 0; basket < 3; basket++) parts.push(box(frame, side * width * 0.38, 0.3, basket * 0.18, 0.45, 0.17, 0.34, '#d9262b'))
  },
  darshini: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.22, width * 0.45, 1.0, '#a9adb2', STEEL)
    // Big steel vessels of sambar and chutney.
    for (let pot = 0; pot < 3; pot++) parts.push(cylinder(frame, side * width * 0.22 + (pot - 1) * 0.42, 0.3, 1.0, 0.17, 0.32, STEEL, 0.15))
  },
  chai: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.25, width * 0.4, 1.0, '#6a4a2a', '#b98e5c')
    parts.push(cylinder(frame, side * width * 0.25 - 0.25, 0.3, 1.0, 0.12, 0.3, STEEL, 0.09))
    for (let glass = 0; glass < 5; glass++) parts.push(cylinder(frame, side * width * 0.25 + glass * 0.1, 0.42, 1.0, 0.03, 0.09, '#e9f3f2'))
    // A bench for those who sit with their tea.
    parts.push(box(frame, -side * width * 0.3, 0.45, 0.4, 1.1, 0.05, 0.3, '#6b4a2c'))
    for (const end of [-0.45, 0.45]) parts.push(box(frame, -side * width * 0.3 + end, 0.45, 0, 0.05, 0.4, 0.26, '#3a2a1c'))
  },
  coffee: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.25, width * 0.4, 1.0, '#5a3a24', '#c4a27a')
    parts.push(cylinder(frame, side * width * 0.25, 0.3, 1.0, 0.13, 0.4, STEEL, 0.1))
  },
  chats: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.2, width * 0.5, 0.95, '#d8d4c8', STEEL)
    for (let pot = 0; pot < 4; pot++) parts.push(cylinder(frame, side * width * 0.2 + (pot - 1.5) * 0.3, 0.3, 0.95, 0.11, 0.2, STEEL))
  },
  bakery: (parts, frame, width, side) => {
    // A glass display: a wooden base, trays of cakes and puffs stepping back, and a glass top.
    const across = side * width * 0.22
    parts.push(box(frame, across, 0.3, 0, width * 0.45, 0.75, 0.5, '#8a5a32'))
    const cakes = ['#f3d9a4', '#e86a8a', '#7a4a2a', '#f7e7c4', '#d4934a']
    for (let tray = 0; tray < 2; tray++) {
      for (let cake = 0; cake < 6; cake++) parts.push(box(frame, across + (cake - 2.5) * width * 0.07, 0.38 - tray * 0.14, 0.78 + tray * 0.2, width * 0.05, 0.08, 0.1, cakes[(cake + tray) % cakes.length]))
    }
    parts.push(box(frame, across, 0.3, 1.24, width * 0.45, 0.03, 0.5, '#e4f1f3'))
  },
  pharmacy: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.2, width * 0.5, 1.0, '#e8eef0', '#2fa34a')
  },
  clothing: (parts, frame, width, side, random) => {
    // A rail of shirts and kurtas outside, on a stand.
    const across = -side * width * 0.3
    parts.push(box(frame, across, 0.4, 1.65, 1.2, 0.03, 0.03, '#3a3c40'))
    for (const end of [-0.6, 0.6]) parts.push(box(frame, across + end, 0.4, 0, 0.03, 1.66, 0.03, '#3a3c40'))
    for (let item = 0; item < 9; item++) parts.push(box(frame, across - 0.5 + item * 0.125, 0.4, 0.8, 0.03, 0.82, 0.42, ['#1f3c88', '#c62f5c', '#f2b705', '#f5f0e6', '#3f9b5a', '#7b3fa0'][Math.floor(random() * 6)]))
  },
  tailor: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.2, width * 0.45, 0.85, '#7a5a3a', '#b99a72')
    parts.push(box(frame, side * width * 0.2, 0.3, 0.85, 0.35, 0.12, 0.18, '#1b1b1b'))
  },
  salon: (parts, frame, width, side) => {
    // A potted plant and a bench by the door for those waiting.
    parts.push(cylinder(frame, side * width * 0.4, 0.3, 0, 0.18, 0.35, '#a8562e', 0.22))
    parts.push(cylinder(frame, side * width * 0.4, 0.3, 0.35, 0.28, 0.5, '#3f7a3a', 0.12))
    parts.push(box(frame, -side * width * 0.3, 0.4, 0.4, 1.0, 0.05, 0.32, '#3a3c40'))
  },
  jewellery: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.2, width * 0.5, 0.95, '#4a1010', '#f0d78a')
  },
  electronics: (parts, frame, width, side) => {
    // Boxed appliances stacked by the door.
    parts.push(box(frame, side * width * 0.35, 0.35, 0, 0.7, 1.6, 0.6, '#c9a777'))
    parts.push(box(frame, side * width * 0.35 - 0.8, 0.35, 0, 0.6, 0.9, 0.55, '#d4b88a'))
  },
  mobiles: (parts, frame, width, side) => {
    counter(parts, frame, side * width * 0.2, width * 0.5, 1.0, '#2b2f33', '#cfe7f0')
  },
  hardware: (parts, frame, width, side, random) => {
    // Buckets stacked in towers, and pipes leaning on the wall.
    for (let tower = 0; tower < 3; tower++) {
      const color = ['#e8352b', '#2a7fc2', '#f6c21c', '#2fa34a'][Math.floor(random() * 4)]
      for (let bucket = 0; bucket < 4; bucket++) parts.push(cylinder(frame, side * (width * 0.38 - tower * 0.38), 0.3, bucket * 0.08, 0.15, 0.28, color, 0.18))
    }
    for (let pipe = 0; pipe < 5; pipe++) {
      const geometry = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6).toNonIndexed()
      geometry.translate(0, 1.2, 0)
      geometry.rotateX(-0.12)
      geometry.translate(-side * width * 0.38 + pipe * 0.08, frame.lift, 0.35)
      geometry.rotateY(frame.rotation)
      geometry.translate(frame.x, 0, frame.z)
      parts.push(colored(geometry, pipe % 2 ? '#e9e9e9' : '#f4f4f4'))
    }
  },
}

/** Fridges by the door at some of the shops that sell cold drinks, on the side their counter leaves free. */
const FRIDGE_SHOPS = new Set<ShopType>(['general', 'bakery', 'chats', 'supermarket', 'pharmacy'])
const FRIDGE_SHARE = 0.55

/** The 3D fronts of every shop, one geometry per map square. */
export function createShopFrontKit(shopFronts: ShopFront[]): THREE.BufferGeometry[] {
  const chunks = new Map<number, THREE.BufferGeometry[]>()
  shopFronts.forEach((shop, index) => {
    const { x, z, rotation, width, type, variation } = shop
    const out: [number, number] = [Math.sin(rotation), Math.cos(rotation)]
    const frame: Frame = { x, z, rotation, lift: groundLift.at(x + out[0] * 0.6, z + out[1] * 0.6) }
    const random = createRandom(index * 7919 + 13)
    const side = variation < 0.5 ? 1 : -1
    const parts: THREE.BufferGeometry[] = []

    // The rolled-up shutter in its box, its guide rails, and the step.
    parts.push(box(frame, 0, 0.14, SHUTTER_BOTTOM, width, SHUTTER_TOP - SHUTTER_BOTTOM, 0.28, '#7d8186'))
    parts.push(box(frame, 0, 0.27, SHUTTER_BOTTOM - 0.03, width, 0.03, 0.03, '#2b2c2f'))
    for (const end of [-1, 1]) parts.push(box(frame, end * (width / 2 - 0.04), 0.05, 0, 0.08, SHUTTER_BOTTOM, 0.1, '#5c6066'))
    parts.push(box(frame, 0, 0.22, -0.05, width + 0.1, 0.2, 0.44, '#8f8a84'))

    FRONTS[type](parts, frame, width - 0.2, side, random)
    if (FRIDGE_SHOPS.has(type) && random() < FRIDGE_SHARE && width > 3) fridge(parts, frame, -side * (width / 2 - 0.45), FRIDGES[Math.floor(random() * FRIDGES.length)])

    const key = chunkKey(x, z)
    const list = chunks.get(key) ?? []
    chunks.set(key, list)
    list.push(...parts)
  })

  return [...chunks.values()].map((parts) => {
    const merged = mergeGeometries(parts)
    parts.forEach((part) => part.dispose())
    if (!merged) throw new Error('Could not merge shop fronts')
    merged.computeBoundingSphere()
    return merged
  })
}
