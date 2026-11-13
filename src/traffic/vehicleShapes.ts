import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { box, colored, merge } from '../world/simpleShapes'
import { getModel } from './modelFiles'

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

/** Where the delivery box sits on the model: behind the seat and above it. */
const BOX_ZONE = { behind: -0.45, above: 0.82 }
/** How far a parked scooter leans onto its side stand, and how far its bars are turned, in radians. */
const STAND_LEAN = 0.11
const PARKED_STEER = 0.35

type WheelData = { wheelPositions: [number, number, number][] }

const KEPT_ATTRIBUTES = ['position', 'normal', 'color', '_paint']

/** Reads one number of an attribute, undoing any packing (a model's colours can be stored as whole numbers). */
function readValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number, part: number) {
  return [attribute.getX, attribute.getY, attribute.getZ, attribute.getW][part].call(attribute, index)
}

/**
 * A copy of a model as plain triangles, keeping only the attributes every part
 * shares, all as ordinary floats, so the parts can be merged and cut up.
 */
function plain(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const copy = new THREE.BufferGeometry()
  for (const name of KEPT_ATTRIBUTES) {
    const attribute = source.getAttribute(name)
    if (!attribute) continue
    const values = new Float32Array(attribute.count * attribute.itemSize)
    for (let index = 0; index < attribute.count; index++) {
      for (let part = 0; part < attribute.itemSize; part++) {
        values[index * attribute.itemSize + part] = readValue(attribute, index, part)
      }
    }
    copy.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize))
  }
  return copy
}

/** Leaves out every triangle that's part of the delivery box, which a parked scooter doesn't carry. */
function withoutBox(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  const paint = geometry.getAttribute('_paint')
  const keep: number[] = []
  for (let corner = 0; corner < position.count; corner += 3) {
    const y = (position.getY(corner) + position.getY(corner + 1) + position.getY(corner + 2)) / 3
    const z = (position.getZ(corner) + position.getZ(corner + 1) + position.getZ(corner + 2)) / 3
    const isBox = paint.getX(corner) < 0.5 && y > BOX_ZONE.above && z < BOX_ZONE.behind
    if (!isBox) keep.push(corner, corner + 1, corner + 2)
  }

  const result = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const size = attribute.itemSize
    const values = new Float32Array(keep.length * size)
    keep.forEach((corner, index) => {
      for (let part = 0; part < size; part++) values[index * size + part] = attribute.getComponent(corner, part)
    })
    result.setAttribute(name, new THREE.BufferAttribute(values, size))
  }
  return result
}

/**
 * A parked scooter: the player's own sculpted scooter from `traffic.glb`,
 * without the delivery box, its bars turned and leaning a little onto its side
 * stand, as scooters stand outside every shop. Only its paint takes each
 * scooter's colour, so the seat, tyres and trim stay as they are.
 */
export function createParkedScooterGeometry(scene: THREE.Group, steeringZ: number): THREE.BufferGeometry {
  const { wheelPositions } = scene.getObjectByName('delivery')?.userData as WheelData
  const [frontAxle, rearAxle] = [...wheelPositions].sort((a, b) => b[2] - a[2])

  const body = withoutBox(plain(getModel(scene, 'delivery')))
  const rearWheel = plain(getModel(scene, 'delivery-wheel')).translate(...rearAxle)

  // The front end, wheel and all, turns about the steering axis.
  const front = mergeGeometries([
    plain(getModel(scene, 'delivery-front')),
    plain(getModel(scene, 'delivery-wheel')).translate(...frontAxle),
  ])
  if (!front) throw new Error('Could not build the scooter front')
  front.translate(0, 0, -steeringZ).rotateY(PARKED_STEER).translate(0, 0, steeringZ)

  const scooter = merge([body, rearWheel, front])
  // Both tyres touch the ground on the scooter's middle line, so leaning about it keeps them down.
  scooter.rotateZ(STAND_LEAN)
  return scooter
}

/**
 * A parked car: one of the traffic models from `traffic.glb` with its wheels
 * fixed in place, as one shape that can be copied many times.
 */
export function createParkedCarGeometry(scene: THREE.Group, name: string): THREE.BufferGeometry {
  const { wheelModel, wheelRadius, wheelPositions } = scene.getObjectByName(name)?.userData as {
    wheelModel: string
    wheelRadius: number
    wheelPositions: [number, number, number][]
  }
  const sourceRadius = (scene.getObjectByName(`${wheelModel}-wheel`)?.userData as { wheelRadius: number }).wheelRadius
  const scale = wheelRadius / sourceRadius
  // Wheels on the left are the same wheel turned round, so their hub faces out.
  const wheels = wheelPositions.map((position) => {
    const wheel = plain(getModel(scene, `${wheelModel}-wheel`)).scale(scale, scale, scale)
    if (position[0] < 0) wheel.rotateY(Math.PI)
    return wheel.translate(...position)
  })
  return merge([plain(getModel(scene, name)), ...wheels])
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
