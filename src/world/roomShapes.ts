import * as THREE from 'three'
import { goThrough, ROOM, setRoom, type Block, type RoomKind } from '../game/rooms'
import { box, colored, merge } from './simpleShapes'

/*
 * The rooms' shapes (game/rooms.ts), each one merged mesh in the room's own space: floor, walls,
 * ceiling and furniture, with its shading painted into its colours (lighter on top, darker under
 * and on the sides, grime towards the floor), as nothing down there is reached by the sun. Also
 * what's solid in each, where its people stand, and the spots things happen at.
 */

export type RoomPerson = { x: number; z: number; heading: number; tint: number; skin: number; staff?: boolean }
export type RoomPlan = {
  geometry: THREE.BufferGeometry
  blocks: Block[]
  people: RoomPerson[]
  /** Where the sign hangs: its middle, size, and which way it faces (0: into the room from the back wall). */
  sign: { at: [number, number, number]; size: [number, number]; turn: number }
}

/** Places in each room, in its own space, for the errands and prompts. */
export const ROOM_SPOTS = {
  store: { counter: { x: 0, z: 0.25 }, bag: { x: 0.2, y: 1.05, z: -0.55 } },
  chai: { counter: { x: 0, z: -0.55 } },
  lobby: { lift: { x: -1.9, z: -2.2 }, stairs: { x: 1.9, z: -1.0 } },
  corridor: { bell: { x: 0, z: -2.2 }, down: { x: -2.6, z: 1.6 }, customer: { x: 0, z: -2.45 } },
}

const HALF_X = ROOM.width / 2
const HALF_Z = ROOM.depth / 2
const WALL = 0.2
const DOOR = { width: 1.3, height: 2.2 }

type Parts = THREE.BufferGeometry[]

/** Floor, ceiling, four walls (a doorway in the front one when `door`), a skirting, and tube lights. */
function shell(parts: Parts, colours: { floor: string; wall: string; ceiling: string; skirting: string }, door = true) {
  const { floor, wall, ceiling, skirting } = colours
  parts.push(box([ROOM.width + WALL * 2, 0.2, ROOM.depth + WALL * 2], [0, -0.1, 0], floor))
  parts.push(box([ROOM.width + WALL * 2, 0.2, ROOM.depth + WALL * 2], [0, ROOM.height + 0.1, 0], ceiling))
  parts.push(box([ROOM.width + WALL * 2, ROOM.height, WALL], [0, ROOM.height / 2, -HALF_Z - WALL / 2], wall))
  for (const side of [-1, 1]) parts.push(box([WALL, ROOM.height, ROOM.depth], [side * (HALF_X + WALL / 2), ROOM.height / 2, 0], wall))
  if (door) {
    const sideWidth = (ROOM.width - DOOR.width) / 2 + WALL
    for (const side of [-1, 1]) parts.push(box([sideWidth, ROOM.height, WALL], [side * (DOOR.width / 2 + sideWidth / 2), ROOM.height / 2, HALF_Z + WALL / 2], wall))
    parts.push(box([DOOR.width, ROOM.height - DOOR.height, WALL], [0, DOOR.height + (ROOM.height - DOOR.height) / 2, HALF_Z + WALL / 2], wall))
    // Beyond the doorway: the bright street, as a pale panel, and the door's frame.
    parts.push(box([DOOR.width, DOOR.height, 0.04], [0, DOOR.height / 2, HALF_Z + WALL + 0.02], '#f3e7c8'))
    for (const side of [-1, 1]) parts.push(box([0.08, DOOR.height, WALL + 0.04], [side * (DOOR.width / 2 + 0.04), DOOR.height / 2, HALF_Z + WALL / 2], '#4a3a2c'))
  } else parts.push(box([ROOM.width + WALL * 2, ROOM.height, WALL], [0, ROOM.height / 2, HALF_Z + WALL / 2], wall))
  // Skirting all round, and two tube lights on the ceiling.
  parts.push(box([ROOM.width, 0.12, 0.03], [0, 0.06, -HALF_Z + 0.015], skirting))
  for (const side of [-1, 1]) parts.push(box([0.03, 0.12, ROOM.depth], [side * (HALF_X - 0.015), 0.06, 0], skirting))
  for (const z of [-1.4, 1.4]) {
    parts.push(box([1.3, 0.05, 0.14], [0, ROOM.height - 0.03, z], '#8f9499'))
    parts.push(box([1.2, 0.04, 0.06], [0, ROOM.height - 0.07, z], '#fffbe8'))
  }
}

/** A repeatable 0 to 1 number from a seed and an index, for laying things out the same every time. */
function chance(seed: number, index: number): number {
  const value = Math.sin(seed * 127.1 + index * 311.7) * 43758.5453
  return value - Math.floor(value)
}

/** A steel rack against a wall with cartons on its shelves. `along`: runs along x (a back wall) or z (a side wall). */
function rack(parts: Parts, at: [number, number], length: number, along: 'x' | 'z', seed: number) {
  const [x, z] = at
  const depth = 0.45
  const size = (l: number, h: number, d: number): [number, number, number] => (along === 'x' ? [l, h, d] : [d, h, l])
  for (const level of [0.25, 0.85, 1.45, 2.05]) parts.push(box(size(length, 0.04, depth), [x, level, z], '#6d7074'))
  for (const end of [-1, 1]) {
    const offset = (end * (length - 0.05)) / 2
    parts.push(box(size(0.05, 2.2, depth), [x + (along === 'x' ? offset : 0), 1.1, z + (along === 'z' ? offset : 0)], '#55585c'))
  }
  const CARTONS = ['#b98a55', '#a57a48', '#c9a26b', '#d9cdb4', '#8c6a3f', '#e8e1cf']
  let index = 0
  for (const level of [0.27, 0.87, 1.47]) {
    for (let run = -length / 2 + 0.25; run < length / 2 - 0.2; ) {
      const wide = 0.26 + chance(seed, index) * 0.22
      const tall = 0.2 + chance(seed, index + 50) * 0.26
      if (chance(seed, index + 100) > 0.18) {
        const colour = CARTONS[Math.floor(chance(seed, index + 150) * CARTONS.length)]
        parts.push(box(size(wide, tall, depth * 0.8), [x + (along === 'x' ? run + wide / 2 : 0), level + tall / 2, z + (along === 'z' ? run + wide / 2 : 0)], colour))
      }
      run += wide + 0.05
      index++
    }
  }
}

function storeRoom(): RoomPlan {
  const parts: Parts = []
  shell(parts, { floor: '#85827c', wall: '#d6d0c2', ceiling: '#c9c4b7', skirting: '#3a3d42' })
  // The counter across the room: dark laminate, a worn wooden top, the brand's marigold along its front.
  parts.push(box([4.8, 0.96, 0.7], [0, 0.48, -0.6], '#2f3237'))
  parts.push(box([4.9, 0.05, 0.8], [0, 0.985, -0.6], '#a8763f'))
  parts.push(box([4.8, 0.22, 0.02], [0, 0.72, -0.24], '#f2b82a'))
  // A till, a label printer, and a stack of flat-packed bags on it.
  parts.push(box([0.34, 0.26, 0.3], [-1.5, 1.14, -0.7], '#1c1d20'), box([0.3, 0.02, 0.2], [-1.5, 1.28, -0.62], '#31454f'))
  parts.push(box([0.26, 0.16, 0.22], [-0.8, 1.09, -0.72], '#d9d9d4'))
  parts.push(box([0.4, 0.1, 0.3], [1.6, 1.06, -0.66], '#c9a26b'))
  // Racks of parcels behind it and down both sides, and crates on the floor.
  rack(parts, [-1.9, -HALF_Z + 0.25], 3.0, 'x', 3)
  rack(parts, [1.9, -HALF_Z + 0.25], 3.0, 'x', 7)
  rack(parts, [-HALF_X + 0.25, 1.2], 2.6, 'z', 11)
  rack(parts, [HALF_X - 0.25, 1.2], 2.6, 'z', 17)
  parts.push(box([0.6, 0.4, 0.45], [2.6, 0.2, -1.9], '#2b5fa8'), box([0.6, 0.4, 0.45], [2.6, 0.6, -1.9], '#c62828'))
  return {
    geometry: finish(parts),
    blocks: [
      { minX: -2.45, maxX: 2.45, minZ: -0.98, maxZ: -0.2 },
      { minX: -HALF_X, maxX: -HALF_X + 0.5, minZ: -0.1, maxZ: 2.5 },
      { minX: HALF_X - 0.5, maxX: HALF_X, minZ: -0.1, maxZ: 2.5 },
    ],
    people: [{ x: 0.7, z: -1.45, heading: 0, tint: 0.3, skin: 0.85, staff: true }],
    sign: { at: [0, 2.45, -HALF_Z + 0.02], size: [2.6, 0.5], turn: 0 },
  }
}

/** A darshini: stand-and-eat. A steel counter with a glass case, vessels behind it, round standing tables. */
function chaiRoom(): RoomPlan {
  const parts: Parts = []
  shell(parts, { floor: '#9a8f80', wall: '#e4d9b8', ceiling: '#d8d2c0', skirting: '#7a3a20' })
  // A band of dark red tile round the walls to waist height, as these places have.
  parts.push(box([ROOM.width, 1.0, 0.02], [0, 0.5, -HALF_Z + 0.03], '#8a3b24'))
  for (const side of [-1, 1]) parts.push(box([0.02, 1.0, ROOM.depth], [side * (HALF_X - 0.03), 0.5, 0], '#8a3b24'))
  // The counter: steel, with a glass case of snacks at one end and a token desk at the other.
  parts.push(box([5.2, 0.95, 0.7], [0, 0.475, -1.4], '#a9adb0'))
  parts.push(box([5.3, 0.04, 0.8], [0, 0.97, -1.4], '#cfd3d6'))
  parts.push(box([1.5, 0.45, 0.5], [-1.6, 1.22, -1.4], '#bcd3d8'))
  for (let i = 0; i < 5; i++) parts.push(box([0.22, 0.1, 0.3], [-2.15 + i * 0.28, 1.06, -1.4], ['#c98a3a', '#e0b060', '#a8642a', '#d9a04a', '#f0d28a'][i]))
  parts.push(box([0.5, 0.3, 0.4], [2.0, 1.14, -1.45], '#2f3237'))
  // Behind: a stove with a big kettle and milk vessel, steel tumblers in a row, a shelf of tins.
  parts.push(box([1.6, 0.85, 0.6], [0.6, 0.425, -HALF_Z + 0.4], '#6d7074'))
  parts.push(cylinder(0.2, 0.34, [0.25, 1.02, -HALF_Z + 0.4], '#c9cdd0'), cylinder(0.24, 0.3, [0.95, 1.0, -HALF_Z + 0.4], '#b9bdc0'))
  for (let i = 0; i < 6; i++) parts.push(cylinder(0.04, 0.09, [-0.4 + i * 0.12, 1.035, -1.25], '#d9dde0'))
  parts.push(box([2.2, 0.04, 0.25], [-1.6, 1.75, -HALF_Z + 0.16], '#6b4a2c'))
  for (let i = 0; i < 6; i++) parts.push(cylinder(0.09, 0.2, [-2.5 + i * 0.36, 1.87, -HALF_Z + 0.16], ['#c62828', '#f2b705', '#2a7fc2', '#3f9b5a', '#e86a1c', '#e8e1cf'][i]))
  // Standing tables: a steel post and a round top, chest high.
  const tables: [number, number][] = [[-2.0, 1.0], [2.0, 1.0], [0, 1.9]]
  for (const [x, z] of tables) {
    parts.push(cylinder(0.04, 1.05, [x, 0.525, z], '#8f9499'), cylinder(0.42, 0.04, [x, 1.07, z], '#cfd3d6'), cylinder(0.22, 0.03, [x, 0.015, z], '#6d7074'))
  }
  // A glass and a plate left on one.
  parts.push(cylinder(0.035, 0.09, [-1.9, 1.135, 1.05], '#e8dcc0'), cylinder(0.11, 0.015, [-2.15, 1.1, 0.95], '#d9dde0'))
  // A wash basin by the door, and a water drum.
  parts.push(box([0.5, 0.14, 0.38], [HALF_X - 0.28, 0.8, 2.3], '#e9e7e1'), cylinder(0.24, 0.7, [-HALF_X + 0.4, 0.35, 2.5], '#2a7fc2'))
  return {
    geometry: finish(parts),
    blocks: [
      { minX: -2.65, maxX: 2.65, minZ: -1.8, maxZ: -1.0 },
      ...tables.map(([x, z]) => ({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 })),
      { minX: -HALF_X, maxX: -HALF_X + 0.7, minZ: 2.2, maxZ: 2.8 },
    ],
    people: [
      { x: -0.4, z: -2.1, heading: 0, tint: 0.62, skin: 0.8, staff: true },
      { x: 2.0, z: 1.75, heading: Math.PI, tint: 0.15, skin: 0.9 },
      { x: 2.55, z: 0.75, heading: -1.9, tint: 0.8, skin: 0.75 },
    ],
    sign: { at: [1.9, 2.3, -HALF_Z + 0.02], size: [2.4, 0.9], turn: 0 },
  }
}

/** A block of flats' lobby: the lift on the left of the back wall, the stairs going up on the right, letterboxes, a notice board. */
function lobbyRoom(): RoomPlan {
  const parts: Parts = []
  shell(parts, { floor: '#b9b2a3', wall: '#e2dccb', ceiling: '#d5d0c2', skirting: '#5a5348' })
  // Floor tiles: a darker border, and a diamond in the middle.
  parts.push(box([ROOM.width - 0.5, 0.012, 0.12], [0, 0.006, HALF_Z - 0.4], '#7c7468'), box([ROOM.width - 0.5, 0.012, 0.12], [0, 0.006, -HALF_Z + 0.4], '#7c7468'))
  // The lift: a steel frame, two door leaves, the call button, and the floor's number above.
  parts.push(box([1.5, 2.3, 0.08], [-1.9, 1.15, -HALF_Z + 0.04], '#6d7074'))
  for (const side of [-1, 1]) parts.push(box([0.58, 2.05, 0.04], [-1.9 + side * 0.3, 1.03, -HALF_Z + 0.09], '#aeb3b7'))
  parts.push(box([0.1, 0.18, 0.03], [-1.0, 1.15, -HALF_Z + 0.03], '#2f3237'), box([0.05, 0.05, 0.02], [-1.0, 1.18, -HALF_Z + 0.05], '#f2b705'))
  parts.push(box([0.4, 0.18, 0.04], [-1.9, 2.45, -HALF_Z + 0.04], '#1c1d20'), box([0.1, 0.1, 0.02], [-1.9, 2.45, -HALF_Z + 0.07], '#e8462a'))
  // The stairs: a flight going up to the right at the back, with a rail; under it, a dark store room door.
  const steps = 9
  for (let step = 0; step < steps; step++) {
    parts.push(box([1.5, 0.19 * (step + 1), 0.26], [2.75, (0.19 * (step + 1)) / 2, -0.75 - step * 0.26], '#a39c8e'))
  }
  parts.push(box([0.05, 0.9, 2.5], [1.98, 1.35, -1.9], '#2b2d30'))
  parts.push(box([0.05, 0.05, 2.6], [1.98, 1.85, -1.9], '#4a3a2c'))
  // Letterboxes in rows on the right wall, a notice board on the left, a plant, a visitor's bench.
  for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) parts.push(box([0.03, 0.2, 0.3], [HALF_X - 0.03, 1.1 + row * 0.26, 0.6 + column * 0.36], row === 1 && column === 2 ? '#c9a26b' : '#7d6a4f'))
  parts.push(box([0.03, 0.8, 1.2], [-HALF_X + 0.03, 1.6, 0.8], '#5c7a4e'), box([0.02, 0.3, 0.22], [-HALF_X + 0.05, 1.7, 0.6], '#f4f1e8'), box([0.02, 0.22, 0.3], [-HALF_X + 0.05, 1.5, 1.05], '#ffe9a8'))
  parts.push(cylinder(0.2, 0.36, [-HALF_X + 0.45, 0.18, 2.5], '#a4552f'), cylinder(0.3, 0.7, [-HALF_X + 0.45, 0.75, 2.5], '#3f7d3a', 7))
  parts.push(box([1.3, 0.06, 0.4], [-HALF_X + 0.9, 0.44, -0.9], '#6b4a2c'), box([0.06, 0.44, 0.36], [-HALF_X + 0.35, 0.22, -0.9], '#4a3a2c'), box([0.06, 0.44, 0.36], [-HALF_X + 1.45, 0.22, -0.9], '#4a3a2c'))
  return {
    geometry: finish(parts),
    blocks: [
      { minX: 2.0, maxX: HALF_X, minZ: -HALF_Z, maxZ: -0.62 },
      { minX: -HALF_X, maxX: -HALF_X + 1.6, minZ: -1.15, maxZ: -0.65 },
      { minX: -HALF_X, maxX: -HALF_X + 0.75, minZ: 2.2, maxZ: 2.8 },
    ],
    people: [],
    sign: { at: [0.2, 2.35, -HALF_Z + 0.02], size: [2.2, 0.55], turn: 0 },
  }
}

/** A corridor on a floor of flats: three front doors along the back wall, the customer's in the middle; the lift and stairs to one side. */
function corridorRoom(): RoomPlan {
  const parts: Parts = []
  shell(parts, { floor: '#b3ab9c', wall: '#e6dfcc', ceiling: '#d5d0c2', skirting: '#5a5348' }, false)
  // Front doors: teak-coloured, each with a frame, a nameplate and a doormat; the middle one has a
  // kolam sticker, a shoe rack and a grille door folded back.
  const doors = [-2.4, 0, 2.4]
  doors.forEach((x, index) => {
    parts.push(box([1.1, 2.15, 0.06], [x, 1.075, -HALF_Z + 0.03], '#e9e4d8'))
    parts.push(box([0.94, 2.05, 0.05], [x, 1.025, -HALF_Z + 0.06], ['#5a3a24', '#6a4428', '#4f3320'][index]))
    parts.push(box([0.05, 0.14, 0.04], [x + 0.36, 1.0, -HALF_Z + 0.1], '#c9a227'))
    parts.push(box([0.3, 0.1, 0.02], [x, 1.65, -HALF_Z + 0.095], '#d8c690'))
    parts.push(box([0.8, 0.02, 0.45], [x, 0.01, -HALF_Z + 0.4], ['#7a3a20', '#3f5d7a', '#5c7a4e'][index]))
    parts.push(box([0.07, 0.07, 0.03], [x + 0.68, 1.3, -HALF_Z + 0.03], '#f4f1e8'), box([0.03, 0.03, 0.02], [x + 0.68, 1.3, -HALF_Z + 0.05], '#c62828'))
  })
  parts.push(box([0.5, 0.5, 0.01], [0, 1.2, -HALF_Z + 0.095], '#f7f4ec'))
  parts.push(box([0.6, 0.5, 0.26], [0.95, 0.25, -HALF_Z + 0.16], '#6b4a2c'), box([0.2, 0.08, 0.2], [0.85, 0.54, -HALF_Z + 0.16], '#17171a'), box([0.2, 0.08, 0.2], [1.1, 0.54, -HALF_Z + 0.16], '#e9e7e1'))
  // The lift's doors on the left wall, the stairwell's opening beside them towards the front.
  parts.push(box([0.08, 2.3, 1.5], [-HALF_X + 0.04, 1.15, -0.4], '#6d7074'))
  for (const side of [-1, 1]) parts.push(box([0.04, 2.05, 0.58], [-HALF_X + 0.09, 1.03, -0.4 + side * 0.3], '#aeb3b7'))
  parts.push(box([0.04, 2.2, 1.2], [-HALF_X + 0.02, 1.1, 1.7], '#3a352e'))
  parts.push(box([0.03, 0.9, 1.2], [-HALF_X + 0.3, 0.45, 1.7], '#2b2d30'))
  // A window with a grille at the front end, bright with the day outside; a plant under it.
  parts.push(box([2.4, 1.2, 0.03], [0.6, 1.6, HALF_Z - 0.02], '#f3e7c8'))
  for (let bar = 0; bar < 9; bar++) parts.push(box([0.03, 1.2, 0.03], [-0.5 + bar * 0.275, 1.6, HALF_Z - 0.05], '#3b3e43'))
  parts.push(cylinder(0.18, 0.32, [2.9, 0.16, 2.7], '#a4552f'), cylinder(0.26, 0.6, [2.9, 0.62, 2.7], '#3f7d3a', 7))
  return {
    geometry: finish(parts),
    blocks: [
      { minX: 0.6, maxX: 1.3, minZ: -HALF_Z, maxZ: -HALF_Z + 0.34 },
      { minX: 2.6, maxX: HALF_X, minZ: 2.4, maxZ: HALF_Z },
    ],
    people: [],
    sign: { at: [-2.4, 2.45, -HALF_Z + 0.02], size: [1.6, 0.4], turn: 0 },
  }
}

function cylinder(radius: number, height: number, at: [number, number, number], color: string, sides = 12): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, sides).toNonIndexed()
  geometry.translate(...at)
  return colored(geometry, color)
}

/** Merges a room's parts and paints its shading into its colours: by which way each face points, and darker towards the floor. */
function finish(parts: Parts): THREE.BufferGeometry {
  for (const part of parts) part.deleteAttribute('uv')
  const geometry = merge(parts)
  geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal')
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  for (let i = 0; i < color.count; i++) {
    const ny = normal.getY(i)
    const facing = ny > 0.5 ? 1 : ny < -0.5 ? 0.62 : 0.8 + 0.08 * Math.abs(normal.getZ(i))
    // Grime and shade gather low on the walls; the ceiling's light falls off towards the floor.
    const height = Math.max(0, Math.min(1, position.getY(i) / ROOM.height))
    const shade = facing * (0.86 + 0.14 * height)
    color.setXYZ(i, color.getX(i) * shade, color.getY(i) * shade, color.getZ(i) * shade)
  }
  return geometry
}

const plans = new Map<RoomKind, RoomPlan>()

/** A room's plan, built the first time it's entered and kept: four small meshes at most. */
export function planRoom(kind: RoomKind): RoomPlan {
  let plan = plans.get(kind)
  if (!plan) {
    plan = kind === 'store' ? storeRoom() : kind === 'chai' ? chaiRoom() : kind === 'lobby' ? lobbyRoom() : corridorRoom()
    plans.set(kind, plan)
  }
  return plan
}

/** Goes into a room through its street door, with the fade: `at` is the door on the street, `out` the way it faces. */
export function enterRoom(kind: RoomKind, at: { x: number; z: number }, out: { x: number; z: number }, label: string, fadeText: string) {
  goThrough(fadeText, () => {
    // Back out on the street: a step outside the door, facing away from it.
    setRoom(kind, at, { x: at.x + out.x * 0.6, z: at.z + out.z * 0.6, heading: Math.atan2(out.x, out.z) }, label, planRoom(kind).blocks)
  })
}
