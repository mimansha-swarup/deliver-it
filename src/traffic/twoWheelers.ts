import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * The everyday two-wheelers of Bengaluru, built in code with real proportions
 * and simplified parts (ART_DIRECTION.md): a step-through scooter, and a
 * 100-125 cc commuter motorcycle. Neither carries a maker's name or badge.
 * Facing +Z, as all traffic does, sized for the seated rider in vehicleShapes.ts.
 * Painted parts are marked with `_paint` 1, so each copy takes its own colour.
 */

type Vec = [number, number, number]

const TYRE = '#151618'
const RIM = '#9a9da2'
const DARK = '#232428'
const SEAT = '#1a1a1c'
const METAL = '#b9bcc0'
const ENGINE = '#5b5e63'
const LAMP = '#f2efe2'
const TAIL = '#b3241e'
/** Painted parts are white in the shape, and take each copy's colour. */
const PAINT = '#ffffff'

function finish(geometry: THREE.BufferGeometry, color: string, painted: boolean): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.deleteAttribute('uv')
  const count = flat.getAttribute('position').count
  const { r, g, b } = new THREE.Color(color)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  flat.setAttribute('_paint', new THREE.BufferAttribute(new Float32Array(count).fill(painted ? 1 : 0), 1))
  return flat
}

function block(size: Vec, at: Vec, color: string, painted = false): THREE.BufferGeometry {
  return finish(new THREE.BoxGeometry(...size).translate(...at), color, painted)
}

/** A rod from one point to another. */
function rod(from: Vec, to: Vec, radius: number, color: string): THREE.BufferGeometry {
  const start = new THREE.Vector3(...from)
  const end = new THREE.Vector3(...to)
  const length = start.distanceTo(end)
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 6)
  geometry.translate(0, length / 2, 0)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()))
  geometry.translate(...from)
  return finish(geometry, color, false)
}

/** A wheel standing on the ground at `z`: tyre and rim. */
function wheel(z: number, radius: number, width: number): THREE.BufferGeometry[] {
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 14).rotateZ(Math.PI / 2).translate(0, radius, z)
  const rim = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.012, 10).rotateZ(Math.PI / 2).translate(0, radius, z)
  return [finish(tyre, TYRE, false), finish(rim, RIM, false)]
}

/** A side view (z forwards, y up) given its width across, centred. */
function profile(points: [number, number][], width: number, color: string, painted: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 2 })
  geometry.translate(0, 0, -width / 2)
  // The shape's x becomes forwards (+Z), and its depth runs across.
  geometry.rotateY(-Math.PI / 2)
  return finish(geometry, color, painted)
}

function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Could not build a two-wheeler')
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}

/** A step-through scooter: small wheels, a floorboard, a leg shield in front and a rounded body behind. About 1.8 m long. */
export function createScooterGeometry(): THREE.BufferGeometry {
  const radius = 0.26
  return join([
    ...wheel(0.63, radius, 0.1),
    ...wheel(-0.63, radius, 0.11),
    // The body over the rear wheel and engine, rounded at the back.
    profile([[-0.86, 0.44], [-0.82, 0.62], [-0.6, 0.76], [-0.02, 0.77], [0.08, 0.6], [0.05, 0.36], [-0.5, 0.34], [-0.78, 0.38]], 0.36, PAINT, true),
    block([0.3, 0.07, 0.6], [0, 0.82, -0.32], SEAT),
    block([0.32, 0.05, 0.44], [0, 0.32, 0.2], DARK),
    // The leg shield, rising from the floor to the handlebar.
    profile([[0.38, 0.32], [0.56, 0.3], [0.68, 0.62], [0.62, 1.0], [0.5, 1.02], [0.45, 0.6]], 0.42, PAINT, true),
    block([0.16, 0.06, 0.26], [0, 0.56, 0.7], PAINT, true),
    rod([0, 0.3, 0.64], [0, 1.0, 0.56], 0.025, METAL),
    block([0.66, 0.035, 0.035], [0, 1.06, 0.52], DARK),
    block([0.34, 0.14, 0.16], [0, 1.03, 0.6], PAINT, true),
    block([0.16, 0.08, 0.02], [0, 1.0, 0.69], LAMP),
    block([0.18, 0.06, 0.03], [0, 0.62, -0.87], TAIL),
  ])
}

/** A commuter motorcycle: bigger wheels, a fuel tank, a long flat seat, the engine and exhaust in view. About 1.95 m long. */
export function createMotorcycleGeometry(): THREE.BufferGeometry {
  const radius = 0.31
  return join([
    ...wheel(0.64, radius, 0.08),
    ...wheel(-0.62, radius, 0.09),
    // The fuel tank, sloping down to the seat.
    profile([[-0.02, 0.8], [0.05, 0.94], [0.32, 0.99], [0.45, 0.9], [0.38, 0.78]], 0.3, PAINT, true),
    // Side panels under the seat.
    profile([[-0.46, 0.6], [-0.42, 0.8], [-0.04, 0.8], [-0.04, 0.62]], 0.26, PAINT, true),
    block([0.28, 0.07, 0.76], [0, 0.84, -0.33], SEAT),
    block([0.24, 0.3, 0.4], [0, 0.45, 0.14], ENGINE),
    rod([0.17, 0.36, 0.25], [0.17, 0.42, -0.78], 0.04, METAL),
    rod([0, 0.6, 0.36], [0, 0.42, -0.62], 0.03, DARK),
    rod([0, 0.31, 0.64], [0, 1.0, 0.48], 0.028, METAL),
    block([0.7, 0.03, 0.03], [0, 1.06, 0.42], DARK),
    block([0.24, 0.18, 0.16], [0, 0.97, 0.56], PAINT, true),
    block([0.14, 0.12, 0.03], [0, 0.95, 0.65], LAMP),
    block([0.14, 0.04, 0.34], [0, radius + 0.25, 0.66], PAINT, true),
    block([0.16, 0.04, 0.34], [0, 0.6, -0.72], PAINT, true),
    block([0.16, 0.06, 0.03], [0, 0.66, -0.9], TAIL),
  ])
}
