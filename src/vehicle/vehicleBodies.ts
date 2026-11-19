import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintModel } from '../traffic/modelFiles'
import { createParkedCarGeometry } from '../traffic/vehicleShapes'
import type { VehicleSpec } from './vehicleCatalog'

/*
 * The bodies of the vehicles that aren't the scooter's own rig (vehicleCatalog.ts): a model from
 * the models' files, wheels and all, in the vehicle's paint; or one built here (the bicycle, the
 * electric scooter, the cargo three-wheeler), each its own shape.
 */

const tube = (from: [number, number, number], to: [number, number, number], radius: number, color: string) => {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const geometry = new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return tint(geometry, color)
}

function tint(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.deleteAttribute('uv')
  const { r, g, b } = new THREE.Color(color)
  const count = flat.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return flat
}

const boxAt = (size: [number, number, number], at: [number, number, number], color: string, turn: [number, number, number] = [0, 0, 0]) => {
  const geometry = new THREE.BoxGeometry(...size)
  geometry.rotateX(turn[0]).rotateY(turn[1]).rotateZ(turn[2])
  geometry.translate(...at)
  return tint(geometry, color)
}

/** A rounded lump: a ball squashed to `size` (its full width, height and length), smooth-shaded. */
const lump = (size: [number, number, number], at: [number, number, number], color: string, tilt = 0) => {
  const geometry = new THREE.SphereGeometry(0.5, 14, 10)
  geometry.scale(...size)
  geometry.computeVertexNormals()
  geometry.rotateX(tilt)
  geometry.translate(...at)
  return tint(geometry, color)
}

/** A wheel standing at the origin, its axle along x: a dark tyre, a rim, and a hub in `hub`. */
function wheelShape(radius: number, width: number, hub: string, spokes = 0): THREE.BufferGeometry {
  const parts = [
    tint(new THREE.TorusGeometry(radius - width / 2, width / 2, 8, 22).rotateY(Math.PI / 2), '#1c1c1e'),
    tint(new THREE.CylinderGeometry(radius * 0.36, radius * 0.36, width * 0.9, 12).rotateZ(Math.PI / 2), hub),
  ]
  if (spokes > 0) {
    for (let spoke = 0; spoke < spokes; spoke++) {
      const angle = (spoke / spokes) * Math.PI
      const reach = radius - width
      parts.push(tube([0, -Math.cos(angle) * reach, -Math.sin(angle) * reach], [0, Math.cos(angle) * reach, Math.sin(angle) * reach], 0.006, '#b8bcc0'))
    }
  } else {
    parts.push(tint(new THREE.CylinderGeometry(radius - width, radius - width, width * 0.5, 14).rotateZ(Math.PI / 2), '#8f9499'))
  }
  return join(parts)
}

function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Could not build a vehicle')
  return merged
}

/**
 * A vehicle built here, in pieces that move: the body; its wheels, each at its axle, which spin
 * with the road; and, on the bicycle, the cranks and pedals, which go round as it's pedalled.
 */
export type BuiltVehicle = {
  body: THREE.BufferGeometry
  wheels: { geometry: THREE.BufferGeometry; at: [number, number, number] }[]
  crank: { geometry: THREE.BufferGeometry; at: [number, number, number] } | null
}

export function disposeBuilt(built: BuiltVehicle) {
  built.body.dispose()
  built.wheels.forEach(({ geometry }) => geometry.dispose())
  built.crank?.geometry.dispose()
}

/**
 * A city bicycle, its front to +z: a diamond frame in the vehicle's paint, a saddle, swept
 * handlebars, mudguards, and a carrier with a crate on the back for the parcel. Spoked wheels
 * that turn, and cranks and pedals that go round.
 */
function createBicycle(paint: string): BuiltVehicle {
  const wheel = 0.34
  const rear: [number, number, number] = [0, wheel, -0.52]
  const front: [number, number, number] = [0, wheel, 0.55]
  const crank: [number, number, number] = [0, 0.3, -0.02]
  const seat: [number, number, number] = [0, 0.86, -0.22]
  const head: [number, number, number] = [0, 0.92, 0.38]
  const steel = '#8f9499'
  const parts: THREE.BufferGeometry[] = []
  parts.push(tube(crank, seat, 0.022, paint), tube(seat, head, 0.02, paint), tube(crank, head, 0.024, paint))
  parts.push(tube(rear, crank, 0.016, paint), tube(rear, seat, 0.014, paint), tube(head, front, 0.02, paint))
  parts.push(tube([0, 0.86, -0.22], [0, 0.98, -0.25], 0.016, steel))
  parts.push(lump([0.17, 0.06, 0.28], [0, 1.0, -0.26], '#2a211c'))
  parts.push(tube(head, [0, 1.06, 0.36], 0.016, steel), tube([-0.27, 1.06, 0.3], [0.27, 1.06, 0.3], 0.014, steel))
  for (const side of [-1, 1]) parts.push(tube([side * 0.27, 1.06, 0.3], [side * 0.29, 1.05, 0.18], 0.017, '#2a211c'))
  // Mudguards over both wheels, the carrier over the back one and the crate on it, a lamp at the front.
  for (const at of [rear, front]) parts.push(tint(new THREE.TorusGeometry(wheel + 0.03, 0.012, 4, 14, Math.PI * 0.7).rotateY(Math.PI / 2).rotateX(-Math.PI * 0.35).translate(...at), paint))
  parts.push(boxAt([0.2, 0.02, 0.42], [0, 0.74, -0.6], steel))
  parts.push(boxAt([0.34, 0.26, 0.36], [0, 0.88, -0.62], '#f2b82a'))
  parts.push(lump([0.07, 0.07, 0.06], [0, 0.96, 0.46], '#f1ead0'))
  // The cranks, one each side and opposite, with their pedals, about the bottom bracket.
  const cranks = join([
    tint(new THREE.CylinderGeometry(0.085, 0.085, 0.015, 14).rotateZ(Math.PI / 2).translate(0.05, 0, 0), steel),
    tube([0.07, 0, 0], [0.07, -0.17, 0], 0.012, steel),
    tube([-0.07, 0, 0], [-0.07, 0.17, 0], 0.012, steel),
    boxAt([0.1, 0.02, 0.07], [0.13, -0.17, 0], '#1c1c1e'),
    boxAt([0.1, 0.02, 0.07], [-0.13, 0.17, 0], '#1c1c1e'),
  ])
  return { body: join(parts), wheels: [rear, front].map((at) => ({ geometry: wheelShape(wheel, 0.045, steel, 6), at })), crank: { geometry: cranks, at: crank } }
}

/**
 * The Minchu E1, its front to +z: a slim electric scooter, nothing like the petrol one's round
 * body. A flat floor, a tall narrow apron in white with the paint as a blade down it, a ring of
 * light for a headlamp, a thin seat on a battery box, an upswept tail with a light bar, a hub
 * motor filling the back wheel, and an insulated bag on a rack.
 */
function createElectricScooter(paint: string): BuiltVehicle {
  const white = '#eef0ee'
  const dark = '#1d2024'
  const radius = 0.25
  const rear: [number, number, number] = [0, radius, -0.62]
  const front: [number, number, number] = [0, radius, 0.66]
  const parts: THREE.BufferGeometry[] = []
  // Floor and the battery under it.
  parts.push(boxAt([0.36, 0.05, 0.56], [0, 0.31, 0.06], dark))
  parts.push(lump([0.34, 0.14, 0.7], [0, 0.24, 0.02], paint))
  // The apron: narrow, tall, leaning back, the paint a blade down its face; the column and bars above.
  parts.push(lump([0.3, 0.72, 0.13], [0, 0.66, 0.44], white, -0.24))
  parts.push(boxAt([0.07, 0.6, 0.03], [0, 0.66, 0.515], paint, [-0.24, 0, 0]))
  parts.push(tube([0, 0.9, 0.38], [0, 1.03, 0.34], 0.035, dark))
  parts.push(tube([-0.3, 1.03, 0.33], [0.3, 1.03, 0.33], 0.016, dark))
  for (const side of [-1, 1]) parts.push(tube([side * 0.2, 1.03, 0.33], [side * 0.31, 1.03, 0.33], 0.022, '#3a3d42'))
  parts.push(boxAt([0.2, 0.09, 0.03], [0, 1.08, 0.37], dark, [-0.5, 0, 0]))
  // The headlamp: a ring of light, and a strip under it.
  parts.push(tint(new THREE.TorusGeometry(0.07, 0.014, 6, 20).rotateX(-0.24).translate(0, 0.9, 0.5), '#eaf6ff'))
  parts.push(boxAt([0.22, 0.015, 0.02], [0, 0.78, 0.535], '#eaf6ff', [-0.24, 0, 0]))
  // Front fork and a close mudguard.
  for (const side of [-1, 1]) parts.push(tube([side * 0.07, 0.86, 0.46], [side * 0.07, radius, 0.66], 0.018, dark))
  parts.push(tint(new THREE.TorusGeometry(radius + 0.025, 0.02, 4, 12, Math.PI * 0.6).rotateY(Math.PI / 2).rotateX(-Math.PI * 0.3).translate(...front), white))
  // The seat on its battery box, and the tail swept up to a light bar.
  parts.push(lump([0.3, 0.3, 0.62], [0, 0.56, -0.36], white))
  parts.push(lump([0.27, 0.08, 0.66], [0, 0.76, -0.34], dark))
  parts.push(lump([0.22, 0.14, 0.34], [0, 0.66, -0.72], paint, 0.35))
  parts.push(boxAt([0.2, 0.025, 0.02], [0, 0.71, -0.895], '#d3262b'))
  // A single swingarm, and the rack with its insulated bag.
  parts.push(tube([0.11, 0.36, -0.2], [0.11, radius, -0.62], 0.028, dark))
  parts.push(boxAt([0.26, 0.02, 0.3], [0, 0.82, -0.78], '#3a3d42'))
  parts.push(boxAt([0.36, 0.34, 0.34], [0, 1.0, -0.78], dark))
  parts.push(boxAt([0.37, 0.07, 0.35], [0, 1.0, -0.78], paint))
  return {
    body: join(parts),
    // The back wheel is nearly all hub: that's the motor.
    wheels: [
      { geometry: join([wheelShape(radius, 0.1, paint), tint(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.11, 16).rotateZ(Math.PI / 2), '#3a3d42')]), at: rear },
      { geometry: wheelShape(radius, 0.09, '#8f9499'), at: front },
    ],
    crank: null,
  }
}

/**
 * The Bhaara E-Cargo, its front to +z: an electric cargo three-wheeler. One wheel under a short
 * cab with a big windscreen and open sides, and behind it a tall load box on two wheels, in white
 * with a band of the vehicle's paint.
 */
function createCargoTrike(paint: string): BuiltVehicle {
  const white = '#e9e7e1'
  const dark = '#1d2024'
  const glass = '#22303a'
  const radius = 0.24
  const parts: THREE.BufferGeometry[] = []
  // The chassis rail and the cab's floor.
  parts.push(boxAt([1.2, 0.1, 2.9], [0, 0.34, -0.15], dark))
  // The cab: a nose over the front wheel, the screen, the roof on four posts, a bench inside.
  parts.push(lump([0.9, 0.5, 0.7], [0, 0.62, 1.05], paint))
  parts.push(boxAt([1.16, 0.5, 0.5], [0, 0.6, 0.72], paint))
  parts.push(boxAt([1.06, 0.72, 0.04], [0, 1.25, 0.86], glass, [-0.2, 0, 0]))
  parts.push(boxAt([1.2, 0.07, 1.05], [0, 1.68, 0.45], white))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.06, 0.86, 0.06], [side * 0.56, 1.25, 0.9], white, [-0.2, 0, 0]))
    parts.push(boxAt([0.06, 0.82, 0.06], [side * 0.56, 1.27, -0.02], white))
    parts.push(boxAt([0.05, 0.36, 0.86], [side * 0.58, 0.72, 0.42], paint))
    parts.push(lump([0.1, 0.1, 0.05], [side * 0.36, 0.72, 1.36], '#f1ead0'))
  }
  parts.push(boxAt([0.9, 0.12, 0.4], [0, 0.72, 0.12], dark))
  parts.push(boxAt([0.9, 0.5, 0.08], [0, 1.0, -0.08], dark))
  parts.push(tube([0, 0.86, 0.72], [0, 1.02, 0.6], 0.02, dark))
  parts.push(tint(new THREE.TorusGeometry(0.13, 0.015, 5, 14).rotateX(-0.9).translate(0, 1.04, 0.58), dark))
  parts.push(boxAt([1.24, 0.12, 0.08], [0, 0.42, 1.36], dark))
  // The load box: tall and square, its doors at the back, a band of paint round it.
  parts.push(boxAt([1.36, 1.3, 1.62], [0, 1.08, -0.92], white))
  parts.push(boxAt([1.38, 0.2, 1.64], [0, 0.72, -0.92], paint))
  parts.push(boxAt([1.38, 0.04, 1.64], [0, 1.72, -0.92], '#cfcdc6'))
  parts.push(boxAt([0.02, 1.2, 0.02], [0, 1.1, -1.735], '#9a9892'))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.05, 0.16, 0.03], [side * 0.12, 1.05, -1.74], '#6d7074'))
    parts.push(boxAt([0.16, 0.08, 0.03], [side * 0.52, 0.5, -1.74], '#d3262b'))
    // Wheel arches.
    parts.push(boxAt([0.14, 0.08, 0.66], [side * 0.69, 0.56, -1.0], dark))
  }
  return {
    body: join(parts),
    wheels: [
      { geometry: wheelShape(radius, 0.12, '#8f9499'), at: [0, radius, 1.08] },
      { geometry: wheelShape(radius, 0.13, '#8f9499'), at: [-0.62, radius, -1.0] },
      { geometry: wheelShape(radius, 0.13, '#8f9499'), at: [0.62, radius, -1.0] },
    ],
    crank: null,
  }
}

export type BuiltKind = 'bicycle' | 'ev' | 'trike'

export function createBuiltVehicle(kind: BuiltKind, paint: string): BuiltVehicle {
  return kind === 'bicycle' ? createBicycle(paint) : kind === 'ev' ? createElectricScooter(paint) : createCargoTrike(paint)
}

/** A built vehicle as one still shape, wheels and all: standing at a delivery, or ridden up to it. */
export function createBuiltStill(kind: BuiltKind, paint: string): THREE.BufferGeometry {
  const built = createBuiltVehicle(kind, paint)
  const parts = [built.body, ...built.wheels.map(({ geometry, at }) => geometry.translate(...at)), ...(built.crank ? [built.crank.geometry.translate(...built.crank.at)] : [])]
  return join(parts)
}

/** A model's body, wheels and all, painted and scaled: for the motorbike, three-wheeler, van and car. */
export function createModelBody(scene: THREE.Group, body: Extract<VehicleSpec['body'], { rig: 'model' }>, paint: string): THREE.BufferGeometry {
  const whole = createParkedCarGeometry(scene, body.model)
  const painted = paintModel(whole, paint)
  whole.dispose()
  painted.scale(body.scale, body.scale, body.scale)
  return painted
}
