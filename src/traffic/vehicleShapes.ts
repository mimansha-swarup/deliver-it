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

/** Where the delivery box sits on the model: behind the seat and above it. */
const BOX_ZONE = { behind: -0.45, above: 0.82 }

/** Whether a triangle, by its corners from `first`, is part of the delivery box. */
function isBoxTriangle(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, paint: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, first: number) {
  const y = (position.getY(first) + position.getY(first + 1) + position.getY(first + 2)) / 3
  const z = (position.getZ(first) + position.getZ(first + 1) + position.getZ(first + 2)) / 3
  return paint.getX(first) < 0.5 && y > BOX_ZONE.above && z < BOX_ZONE.behind
}

/** The triangles of a non-indexed geometry whose first corners are listed, as a new geometry. */
function pickTriangles(geometry: THREE.BufferGeometry, corners: number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const size = attribute.itemSize
    const values = new Float32Array(corners.length * size)
    corners.forEach((corner, index) => {
      for (let part = 0; part < size; part++) values[index * size + part] = attribute.getComponent(corner, part)
    })
    result.setAttribute(name, new THREE.BufferAttribute(values, size))
  }
  return result
}

/**
 * Splits a scooter model into the scooter and its delivery box, so the box can
 * have a material of its own: it's painted plastic, not the bike's glossy
 * metal paint. Also returns where the box is, for putting a logo on it.
 */
export function splitDeliveryBox(model: THREE.BufferGeometry): { scooter: THREE.BufferGeometry; box: THREE.BufferGeometry; bounds: THREE.Box3 } {
  const geometry = model.index ? model.toNonIndexed() : model
  const position = geometry.getAttribute('position')
  const paint = geometry.getAttribute('_paint')
  const keep: number[] = []
  const box: number[] = []
  for (let corner = 0; corner < position.count; corner += 3) {
    const list = isBoxTriangle(position, paint, corner) ? box : keep
    list.push(corner, corner + 1, corner + 2)
  }
  const result = { scooter: pickTriangles(geometry, keep), box: pickTriangles(geometry, box), bounds: new THREE.Box3() }
  result.box.computeBoundingBox()
  if (result.box.boundingBox) result.bounds.copy(result.box.boundingBox)
  if (geometry !== model) geometry.dispose()
  return result
}
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
    if (!isBoxTriangle(position, paint, corner)) keep.push(corner, corner + 1, corner + 2)
  }
  return pickTriangles(geometry, keep)
}

/**
 * A parked scooter: the player's own sculpted scooter from `traffic.glb`,
 * without the delivery box, its bars turned and leaning a little onto its side
 * stand, as scooters stand outside every shop. Only its paint takes each
 * scooter's colour, so the seat, tyres and trim stay as they are.
 */
export function createParkedScooterGeometry(scene: THREE.Group, steeringZ: number, far = false): THREE.BufferGeometry {
  const { wheelPositions } = scene.getObjectByName('delivery')?.userData as WheelData
  const [frontAxle, rearAxle] = [...wheelPositions].sort((a, b) => b[2] - a[2])
  // The far version is the same parts, each simplified to a few hundred triangles (prepare_traffic_models.mjs).
  const part = (name: string) => plain(getModel(scene, far ? `${name}-far` : name))

  const body = withoutBox(part('delivery'))
  const rearWheel = part('delivery-wheel').translate(...rearAxle)

  // The front end, wheel and all, turns about the steering axis.
  const front = mergeGeometries([part('delivery-front'), part('delivery-wheel').translate(...frontAxle)])
  if (!front) throw new Error('Could not build the scooter front')
  front.translate(0, 0, -steeringZ).rotateY(PARKED_STEER).translate(0, 0, steeringZ)

  const scooter = merge([body, rearWheel, front])
  // Both tyres touch the ground on the scooter's middle line, so leaning about it keeps them down.
  scooter.rotateZ(STAND_LEAN)
  return scooter
}

/**
 * The same scooter as it's ridden in traffic: upright, bars straight, no box, its wheels part of
 * the one shape (they don't spin; at a commuter's speed and from behind, nobody sees).
 */
export function createRidingScooterGeometry(scene: THREE.Group): THREE.BufferGeometry {
  const { wheelPositions } = scene.getObjectByName('delivery')?.userData as WheelData
  const [frontAxle, rearAxle] = [...wheelPositions].sort((a, b) => b[2] - a[2])
  const part = (name: string) => plain(getModel(scene, name))
  return merge([withoutBox(part('delivery')), part('delivery-front'), part('delivery-wheel').translate(...frontAxle), part('delivery-wheel').translate(...rearAxle)])
}

/**
 * A parked car: one of the traffic models from `traffic.glb` with its wheels
 * fixed in place, as one shape that can be copied many times.
 */
export function createParkedCarGeometry(scene: THREE.Group, name: string, far = false): THREE.BufferGeometry {
  const suffix = far ? '-far' : ''
  const { wheelModel, wheelRadius, wheelPositions } = (scene.getObjectByName(name)?.userData ?? {}) as {
    wheelModel?: string
    wheelRadius?: number
    wheelPositions?: [number, number, number][]
  }
  const body = plain(getModel(scene, `${name}${suffix}`))
  // An auto's wheels are part of its body.
  if (!wheelModel || !wheelRadius || !wheelPositions) return body
  const sourceRadius = (scene.getObjectByName(`${wheelModel}-wheel`)?.userData as { wheelRadius: number }).wheelRadius
  const scale = wheelRadius / sourceRadius
  // Wheels on the left are the same wheel turned round, so their hub faces out.
  const wheels = wheelPositions.map((position) => {
    const wheel = plain(getModel(scene, `${wheelModel}-wheel${suffix}`)).scale(scale, scale, scale)
    if (position[0] < 0) wheel.rotateY(Math.PI)
    return wheel.translate(...position)
  })
  return merge([body, ...wheels])
}

/**
 * A two-wheeler with its rider far away: the bike's far version and a rider of a few simple
 * shapes, a jacket (which takes the copy's colour) and a dark helmet, under 1,000 triangles in all.
 * Measured to sit where the seated rider sits (Traffic.tsx's COMMUTER_SEAT).
 */
export function createFarBikeGeometry(scene: THREE.Group, name: string): THREE.BufferGeometry {
  const bike = createParkedCarGeometry(scene, name, true)
  const part = (geometry: THREE.BufferGeometry, color: string, paint: number) => {
    const shape = colored(geometry.toNonIndexed(), color)
    shape.setAttribute('_paint', new THREE.BufferAttribute(new Float32Array(shape.getAttribute('position').count).fill(paint), 1))
    return shape
  }
  const torso = new THREE.BoxGeometry(0.38, 0.55, 0.26).rotateX(0.38).translate(0, 1.18, -0.2)
  const thighs = new THREE.BoxGeometry(0.34, 0.16, 0.42).translate(0, 0.9, 0)
  const helmet = new THREE.IcosahedronGeometry(0.15, 1).translate(0, 1.55, -0.05)
  // Plain shapes have no limb weights or the like: match the bike's attributes so they merge.
  const rider = [part(torso, '#ffffff', 1), part(thighs, '#2b2f3a', 0), part(helmet, '#26282c', 0)]
  for (const shape of rider) {
    for (const name of Object.keys(bike.attributes)) {
      if (!shape.getAttribute(name)) {
        const size = bike.getAttribute(name).itemSize
        shape.setAttribute(name, new THREE.BufferAttribute(new Float32Array(shape.getAttribute('position').count * size), size))
      }
    }
    for (const name of Object.keys(shape.attributes)) if (!bike.getAttribute(name)) shape.deleteAttribute(name)
  }
  return merge([bike.index ? bike.toNonIndexed() : bike, ...rider])
}


/** A shape's corners with only what the traffic's paint needs (place, facing, colour and which parts are paint), each as plain numbers, so shapes from different files join. */
function bare(source: THREE.BufferGeometry, at: [number, number, number] = [0, 0, 0], turned = false): THREE.BufferGeometry {
  const flat = source.index ? source.toNonIndexed() : source
  const position = flat.getAttribute('position')
  const normal = flat.getAttribute('normal')
  const color = flat.getAttribute('color')
  const paint = flat.getAttribute('_paint')
  const count = position.count
  const out = { position: new Float32Array(count * 3), normal: new Float32Array(count * 3), color: new Float32Array(count * 3), _paint: new Float32Array(count) }
  const flip = turned ? -1 : 1
  for (let i = 0; i < count; i++) {
    out.position.set([position.getX(i) * flip + at[0], position.getY(i) + at[1], position.getZ(i) * flip + at[2]], i * 3)
    if (normal) out.normal.set([normal.getX(i) * flip, normal.getY(i), normal.getZ(i) * flip], i * 3)
    if (color) out.color.set([color.getX(i), color.getY(i), color.getZ(i)], i * 3)
    else out.color.set([1, 1, 1], i * 3)
    out._paint[i] = paint ? paint.getX(i) : 0
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(out.position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(out.normal, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(out.color, 3))
  geometry.setAttribute('_paint', new THREE.BufferAttribute(out._paint, 1))
  if (flat !== source) flat.dispose()
  return geometry
}

/**
 * One of the rider's own vehicles (fleet.glb: `minitruck`, `cycle`) as a single shape for traffic:
 * its body, what turns with the bars, and its wheels where its axles are. The wheels don't turn:
 * there are only a few of these on the road, and it saves a draw call each. `extra`: shapes to
 * join on (the cyclist).
 */
export function createFleetTrafficGeometry(fleet: THREE.Group, name: string, extra: THREE.BufferGeometry[] = []): THREE.BufferGeometry {
  const wheels = ((fleet.getObjectByName(name)?.userData as { wheels?: { at: [number, number, number] }[] } | undefined)?.wheels ?? []).map(({ at }, index) => bare(getModel(fleet, `${name}-wheel-${index}`), at))
  const parts = [bare(getModel(fleet, name)), ...wheels, ...extra.map((shape) => bare(shape))]
  if (fleet.getObjectByName(`${name}-front`)) parts.push(bare(getModel(fleet, `${name}-front`)))
  const merged = merge(parts)
  merged.computeBoundingSphere()
  return merged
}
