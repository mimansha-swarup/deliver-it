import * as THREE from 'three'
import { box, colored, merge } from '../world/simpleShapes'

const GLASS = '#1b2228'
const TYRE = '#141517'
const HUB = '#8c8f94'
const TRIM = '#1f2023'
const BODY = '#ffffff'
const AUTO_ROOF = '#1c1c1c'
const LIGHT = '#f4f1e2'

type Point = [along: number, height: number]

/**
 * Draws a side view and gives it width, which is a far better car shape than
 * stacked boxes. "Along" runs from the back of the vehicle to the front.
 */
function sideProfile(points: Point[], width: number, color: string): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const bevel = 0.05
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  })
  geometry.translate(0, 0, -(width - bevel * 2) / 2)
  // Extruding pushes along Z, so a quarter turn makes "along" face forwards.
  geometry.rotateY(-Math.PI / 2)
  return colored(geometry.toNonIndexed(), color)
}

function wheel(x: number, z: number, radius: number, width: number): THREE.BufferGeometry[] {
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 10)
  tyre.rotateZ(Math.PI / 2)
  tyre.translate(x, radius, z)

  const hub = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 8)
  hub.rotateZ(Math.PI / 2)
  hub.translate(x, radius, z)

  return [colored(tyre.toNonIndexed(), TYRE), colored(hub.toNonIndexed(), HUB)]
}

export function createAutoGeometry(): THREE.BufferGeometry {
  const hood = new THREE.CylinderGeometry(0.72, 0.72, 2.05, 10, 1, false, -Math.PI / 2, Math.PI)
  hood.rotateX(Math.PI / 2)
  hood.scale(1, 0.42, 1)
  hood.translate(0, 1.5, -0.12)

  return merge([
    sideProfile([[-1.2, 0.34], [-1.2, 1.02], [0.85, 0.98], [1.2, 0.62], [1.25, 0.34]], 1.36, BODY),
    sideProfile([[0.72, 0.98], [0.82, 1.5], [0.92, 1.5], [1.02, 0.98]], 1.24, GLASS),
    colored(hood.toNonIndexed(), AUTO_ROOF),
    box([0.08, 0.5, 0.08], [-0.62, 1.25, -1.05], TRIM),
    box([0.08, 0.5, 0.08], [0.62, 1.25, -1.05], TRIM),
    box([0.24, 0.24, 0.06], [0, 0.72, 1.24], LIGHT),
    ...wheel(0, 1.02, 0.25, 0.14),
    ...wheel(-0.68, -0.82, 0.25, 0.14),
    ...wheel(0.68, -0.82, 0.25, 0.14),
  ])
}

const TROUSERS = '#39404c'
const GLOVE = '#1f2023'

type Joint = [x: number, y: number, z: number]

/** A round bar from one joint to another, with a ball at the far end so bends look solid. */
function limb(from: Joint, to: Joint, radius: number, color: string): THREE.BufferGeometry[] {
  const start = new THREE.Vector3(...from)
  const end = new THREE.Vector3(...to)
  const direction = end.clone().sub(start)

  const bar = new THREE.CylinderGeometry(radius, radius, direction.length(), 7)
  bar.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
  )
  bar.translate(...start.clone().add(end).multiplyScalar(0.5).toArray())

  const joint = new THREE.SphereGeometry(radius, 7, 5)
  joint.translate(...to)
  return [colored(bar.toNonIndexed(), color), colored(joint.toNonIndexed(), color)]
}

/**
 * A motorbike rider, who takes their bike's colour. The joints are measured from
 * the Yamaha in `models/yamaha.glb`: crouched forward, with hands on its low bars.
 */
export function createBikeRiderGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.15, 0.17, 0.5, 8)
  body.rotateX(0.62)
  body.translate(0, 1.07, -0.16)

  const helmet = new THREE.SphereGeometry(0.135, 10, 8)
  helmet.translate(0, 1.42, 0.1)

  const sides = [-1, 1].flatMap((side) => [
    ...limb([side * 0.16, 1.27, -0.02], [side * 0.26, 1.09, 0.13], 0.05, BODY),
    ...limb([side * 0.26, 1.09, 0.13], [side * 0.3, 0.98, 0.33], 0.042, GLOVE),
    ...limb([side * 0.1, 0.87, -0.32], [side * 0.2, 0.74, 0], 0.075, TROUSERS),
    ...limb([side * 0.2, 0.74, 0], [side * 0.18, 0.4, -0.2], 0.06, TROUSERS),
  ])

  return merge([colored(body.toNonIndexed(), BODY), colored(helmet.toNonIndexed(), BODY), ...sides])
}

/** A parked scooter on its stand. White parts take on each scooter's own colour. */
export function createParkedScooterGeometry(): THREE.BufferGeometry {
  return merge([
    box([0.34, 0.4, 0.9], [0, 0.45, -0.18], BODY),
    box([0.3, 0.14, 0.6], [0, 0.72, -0.3], TRIM),
    box([0.3, 0.72, 0.14], [0, 0.72, 0.42], BODY),
    box([0.1, 0.46, 1.5], [0, 0.23, 0], TRIM),
    box([0.6, 0.05, 0.06], [0, 1.08, 0.42], TRIM),
  ])
}

/** Lights for after dark: bright spots on the vehicle, and a fading pool on the road ahead. */
export function createVehicleGlowGeometry(
  front: number,
  back: number,
  apart: number,
  height: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const add = (x: number, y: number, z: number, [r, g, b]: number[]) => {
    positions.push(x, y, z)
    colors.push(r, g, b)
  }
  const quad = (x: number, y: number, z: number, size: number, color: number[]) => {
    add(x - size, y - size, z, color)
    add(x + size, y - size, z, color)
    add(x + size, y + size, z, color)
    add(x - size, y - size, z, color)
    add(x + size, y + size, z, color)
    add(x - size, y + size, z, color)
  }

  const white = [1.4, 1.3, 1]
  const red = [1.3, 0.1, 0.06]
  const lamps = apart === 0 ? [0] : [-apart, apart]
  for (const x of lamps) {
    quad(x, height, front + 0.06, 0.1, white)
    quad(x, height, back - 0.06, 0.08, red)
  }

  // The beam: bright at the bumper, and gone by its far corners.
  const reach = 11
  const spread = 2.4
  const near = [0.13, 0.12, 0.09]
  const far = [0, 0, 0]
  add(-0.6, 0.14, front, near)
  add(spread, 0.14, front + reach, far)
  add(0.6, 0.14, front, near)
  add(-0.6, 0.14, front, near)
  add(-spread, 0.14, front + reach, far)
  add(spread, 0.14, front + reach, far)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}
