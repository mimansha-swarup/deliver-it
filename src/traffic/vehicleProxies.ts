import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * Far-away vehicles: a few boxes each, sized from the vehicle's own model. A
 * painted body, a dark cabin on top and four dark wheels: under 100 triangles,
 * against thousands for the model, and at that distance it reads the same.
 * Painted parts carry `_paint` 1, so each copy keeps its colour.
 */

function block(width: number, height: number, depth: number, x: number, y: number, z: number, color: string, painted: boolean) {
  const geometry = new THREE.BoxGeometry(width, height, depth).toNonIndexed()
  geometry.translate(x, y, z)
  geometry.deleteAttribute('uv')
  const count = geometry.getAttribute('position').count
  const { r, g, b } = new THREE.Color(color)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('_paint', new THREE.BufferAttribute(new Float32Array(count).fill(painted ? 1 : 0), 1))
  return geometry
}

/**
 * A stand-in for `model`, the same size, for drawing far away. `colors` fixes
 * the body and cabin colours, for vehicles whose colour isn't a tint, such as autos.
 */
export function createProxyGeometry(model: THREE.BufferGeometry, colors?: { body: string; cabin: string }): THREE.BufferGeometry {
  model.computeBoundingBox()
  const box = model.boundingBox ?? new THREE.Box3(new THREE.Vector3(-0.5, 0, -1), new THREE.Vector3(0.5, 1.5, 1))
  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  const length = box.max.z - box.min.z
  const middleZ = (box.max.z + box.min.z) / 2
  const narrow = width < 1
  const wheel = Math.min(0.35, height * 0.22)
  const parts = [
    // The body, lifted clear of the road by the wheels.
    block(width * 0.95, height * 0.42, length * 0.96, 0, wheel + height * 0.21, middleZ, colors?.body ?? '#ffffff', !colors),
    // The cabin: dark glass, or on a two-wheeler the rider's shape, set back from the nose.
    block(width * (narrow ? 0.6 : 0.84), height * 0.42, length * (narrow ? 0.3 : 0.52), 0, wheel + height * 0.62, middleZ - length * 0.06, colors?.cabin ?? '#24282e', false),
  ]
  const wheelZ = length * 0.32
  const wheelXs = narrow ? [0] : [-width * 0.42, width * 0.42]
  for (const x of wheelXs) {
    for (const z of [middleZ - wheelZ, middleZ + wheelZ]) parts.push(block(narrow ? 0.1 : 0.2, wheel * 2, wheel * 2, x, wheel, z, '#151618', false))
  }
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Could not build a vehicle stand-in')
  merged.computeBoundingSphere()
  return merged
}
