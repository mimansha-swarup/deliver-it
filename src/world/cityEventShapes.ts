import * as THREE from 'three'
import { box, colored, merge } from './simpleShapes'

/*
 * The shapes of the things that happen on the roads (CityEvents.tsx), each in its own space: its
 * front to +z, standing on y = 0. Simple, weathered, in the street's own light: a city bus with its
 * bonnet up, a dug-up road, a wedding car, a cow.
 */

const ball = (size: [number, number, number], at: [number, number, number], color: string) => {
  const geometry = new THREE.SphereGeometry(0.5, 10, 8).toNonIndexed()
  geometry.scale(...size)
  geometry.translate(...at)
  return colored(geometry, color)
}
const drum = (radius: number, length: number, at: [number, number, number], color: string, axis: 'x' | 'y' | 'z' = 'y') => {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12).toNonIndexed()
  if (axis === 'x') geometry.rotateZ(Math.PI / 2)
  if (axis === 'z') geometry.rotateX(Math.PI / 2)
  geometry.translate(...at)
  return colored(geometry, color)
}
const finish = (parts: THREE.BufferGeometry[]) => {
  for (const part of parts) part.deleteAttribute('uv')
  const geometry = merge(parts)
  geometry.computeVertexNormals()
  return geometry
}

/** A city bus, broken down: faded red and cream, a dusty windscreen, the engine hatch open at the back, a warning branch and a triangle behind it. */
export function createBrokenBus(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const RED = '#a8382c'
  parts.push(box([2.4, 1.1, 10], [0, 1.05, 0], RED), box([2.4, 1.25, 10], [0, 2.2, 0], '#d9d2bd'), box([2.44, 0.12, 10.04], [0, 2.88, 0], '#8f8a7c'))
  // Windows along both sides, the windscreen, the destination board.
  for (const side of [-1, 1]) for (let bay = 0; bay < 7; bay++) parts.push(box([0.03, 0.75, 1.1], [side * 1.21, 2.25, -3.9 + bay * 1.3], '#2c3a41'))
  parts.push(box([2.1, 0.95, 0.03], [0, 2.15, 5.01], '#31454f'), box([1.6, 0.26, 0.04], [0, 2.72, 5.02], '#1c1d20'), box([1.2, 0.14, 0.01], [0, 2.72, 5.05], '#e8a53a'))
  parts.push(box([2.3, 0.3, 0.2], [0, 0.6, 5.0], '#3a3d42'), box([2.3, 0.3, 0.2], [0, 0.6, -5.0], '#3a3d42'))
  for (const side of [-1, 1]) for (const z of [3.2, -3.0]) parts.push(drum(0.5, 0.3, [side * 1.08, 0.5, z], '#17171a', 'x'))
  // The engine hatch propped open at the back, a toolbox and a jack on the road.
  parts.push(box([1.5, 0.05, 0.9], [0, 1.75, -5.35], RED), box([0.04, 0.8, 0.04], [0.6, 1.35, -5.5], '#5d6166'))
  parts.push(box([0.5, 0.22, 0.26], [1.6, 0.11, -5.2], '#2b5fa8'), box([0.16, 0.3, 0.16], [0.4, 0.15, -5.6], '#b3261e'))
  // What stands in for a hazard light here: a leafy branch stuck in the road, and a red triangle.
  parts.push(drum(0.03, 1.1, [0.2, 0.55, -8.2], '#5b4630'), ball([0.8, 0.7, 0.8], [0.2, 1.2, -8.2], '#3f7d3a'), ball([0.6, 0.5, 0.6], [0.5, 0.95, -8.0], '#4a8a40'))
  parts.push(box([0.5, 0.45, 0.04], [-0.6, 0.25, -7.2], '#c62828'), box([0.3, 0.25, 0.05], [-0.6, 0.22, -7.2], '#e9e4d8'))
  return finish(parts)
}

/** A road dug up for pipe work, `width` metres across: a trench, heaps of red earth, a stack of pipes, a small digger, and barricades with boards at both ends. */
export function createDigSite(width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const half = width / 2
  // The trench: dark, with a broken tarmac lip, a blue pipe lying in it.
  parts.push(box([width - 0.6, 0.05, 2.4], [0, 0.03, 0], '#2a2018'), box([width - 0.4, 0.09, 0.3], [0, 0.05, 1.35], '#3d3e44'), box([width - 0.4, 0.09, 0.3], [0, 0.05, -1.35], '#3d3e44'))
  parts.push(drum(0.2, width - 1.2, [0, 0.16, 0.2], '#2a6fb0', 'x'))
  // Heaps of the red earth that came out of it, either side.
  for (const [x, z, size] of [[-half * 0.5, 2.6, 1.9], [half * 0.4, 2.9, 1.5], [0.3, -2.8, 2.1], [-half * 0.6, -2.5, 1.3], [half * 0.7, -2.4, 1.1]]) parts.push(ball([size, size * 0.55, size * 0.9], [x, 0.1, z], '#A65A35'))
  // Pipes stacked on the road, and the digger: a cab, an arm, a bucket.
  for (let pipe = 0; pipe < 3; pipe++) parts.push(drum(0.24, 3.4, [half * 0.2 + pipe * 0.5, 0.26, 5.0], '#3a7cc0', 'z'))
  parts.push(drum(0.24, 3.4, [half * 0.2 + 0.25, 0.68, 5.0], '#3a7cc0', 'z'), drum(0.24, 3.4, [half * 0.2 + 0.75, 0.68, 5.0], '#3a7cc0', 'z'))
  const dx = -half * 0.45
  parts.push(box([1.5, 0.5, 2.6], [dx, 0.55, -5.2], '#2b2d30'), box([1.4, 1.2, 1.5], [dx, 1.4, -5.6], '#d9a520'), box([1.2, 0.6, 0.03], [dx, 1.6, -4.84], '#31454f'))
  const arm = box([0.22, 0.22, 2.6], [0, 0, 1.3], '#d9a520')
  arm.rotateX(-0.55)
  arm.translate(dx, 1.5, -4.7)
  parts.push(arm, box([0.6, 0.5, 0.5], [dx, 0.5, -2.2], '#3a3d42'))
  // Barricades across the road at both ends: striped rails on trestles, and a board.
  for (const end of [-1, 1]) {
    const z = end * 8
    for (const rail of [0.55, 0.95]) for (let stripe = 0; stripe < 8; stripe++) parts.push(box([(width + 1) / 8, 0.16, 0.06], [-(width + 1) / 2 + (stripe + 0.5) * ((width + 1) / 8), rail, z], stripe % 2 ? '#e9e4d8' : '#d9a520'))
    for (const x of [-half, 0, half]) parts.push(box([0.08, 1.05, 0.5], [x, 0.52, z], '#5d6166'))
    parts.push(box([1.5, 0.7, 0.05], [0, 1.5, z + end * 0.04], '#1d4f91'), box([1.3, 0.12, 0.02], [0, 1.62, z + end * 0.08], '#f1ede2'), box([1.0, 0.1, 0.02], [0, 1.4, z + end * 0.08], '#f1ede2'))
    parts.push(box([0.06, 1.2, 0.06], [-0.6, 0.6, z], '#5d6166'), box([0.06, 1.2, 0.06], [0.6, 0.6, z], '#5d6166'))
  }
  return finish(parts)
}

/** The wedding car: an old white saloon dressed in marigold and jasmine garlands, a bow on its bonnet. */
export function createWeddingCar(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  parts.push(box([1.7, 0.55, 4.2], [0, 0.72, 0], '#ece8dc'), box([1.55, 0.6, 2.2], [0, 1.28, -0.2], '#ece8dc'), box([1.5, 0.45, 0.04], [0, 1.28, 0.92], '#31454f'), box([1.5, 0.45, 0.04], [0, 1.28, -1.32], '#31454f'))
  for (const side of [-1, 1]) {
    parts.push(box([0.04, 0.4, 1.9], [side * 0.79, 1.3, -0.2], '#31454f'))
    for (const z of [1.3, -1.3]) parts.push(drum(0.33, 0.22, [side * 0.8, 0.33, z], '#17171a', 'x'))
    // Garlands along the sides: marigold and white by turns.
    for (let bead = 0; bead < 14; bead++) parts.push(ball([0.14, 0.14, 0.14], [side * 0.88, 0.95 + Math.sin(bead * 0.9) * 0.08, -1.9 + bead * 0.29], bead % 2 ? '#f2a516' : '#f7f4ec'))
  }
  for (let bead = 0; bead < 9; bead++) parts.push(ball([0.15, 0.15, 0.15], [-0.7 + bead * 0.175, 1.0, 2.12], bead % 2 ? '#f2a516' : '#c62828'))
  parts.push(ball([0.5, 0.3, 0.4], [0, 1.08, 1.5], '#c62828'), ball([0.3, 0.3, 0.3], [0, 1.2, 1.5], '#f2a516'))
  parts.push(box([1.72, 0.2, 0.14], [0, 0.5, 2.12], '#b8bcc0'), box([1.72, 0.2, 0.14], [0, 0.5, -2.12], '#b8bcc0'))
  return finish(parts)
}

