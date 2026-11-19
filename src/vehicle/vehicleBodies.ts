import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintModel } from '../traffic/modelFiles'
import { createParkedCarGeometry } from '../traffic/vehicleShapes'
import type { VehicleSpec } from './vehicleCatalog'

/*
 * The bodies of the vehicles that aren't the scooter's own rig (vehicleCatalog.ts): a model from
 * the models' files, wheels and all, in the vehicle's paint; or the bicycle, built here.
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

/**
 * A city bicycle, its front to +z, wheels on the ground: a diamond frame in the vehicle's paint,
 * dark tyres, a saddle, handlebars, and a carrier with a crate on the back for the parcel.
 */
export function createBicycleGeometry(paint: string): THREE.BufferGeometry {
  const wheel = 0.34
  const rear: [number, number, number] = [0, wheel, -0.52]
  const front: [number, number, number] = [0, wheel, 0.55]
  const crank: [number, number, number] = [0, 0.3, -0.02]
  const seat: [number, number, number] = [0, 0.86, -0.22]
  const head: [number, number, number] = [0, 0.92, 0.38]
  const parts: THREE.BufferGeometry[] = []
  for (const at of [rear, front]) {
    parts.push(tint(new THREE.TorusGeometry(wheel - 0.03, 0.03, 6, 20).rotateY(Math.PI / 2).translate(...at), '#1c1c1e'))
    parts.push(tint(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6).rotateZ(Math.PI / 2).translate(...at), '#8f9499'))
    for (let spoke = 0; spoke < 4; spoke++) {
      const angle = (spoke / 4) * Math.PI
      parts.push(tube([0, at[1] - Math.cos(angle) * (wheel - 0.05), at[2] - Math.sin(angle) * (wheel - 0.05)], [0, at[1] + Math.cos(angle) * (wheel - 0.05), at[2] + Math.sin(angle) * (wheel - 0.05)], 0.006, '#b8bcc0'))
    }
  }
  parts.push(tube(crank, seat, 0.022, paint), tube(seat, head, 0.02, paint), tube(crank, head, 0.024, paint))
  parts.push(tube(rear, crank, 0.016, paint), tube(rear, seat, 0.014, paint), tube(head, front, 0.02, paint))
  parts.push(tube([0, 0.86, -0.22], [0, 0.98, -0.25], 0.016, '#8f9499'))
  parts.push(tint(new THREE.BoxGeometry(0.16, 0.05, 0.26).translate(0, 1.0, -0.26), '#2a211c'))
  parts.push(tube(head, [0, 1.06, 0.36], 0.016, '#8f9499'), tube([-0.27, 1.06, 0.34], [0.27, 1.06, 0.34], 0.014, '#8f9499'))
  parts.push(tint(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 10).rotateZ(Math.PI / 2).translate(0.05, 0.3, -0.02), '#8f9499'))
  // The carrier over the back wheel, and the crate on it.
  parts.push(tint(new THREE.BoxGeometry(0.2, 0.02, 0.42).translate(0, 0.74, -0.6), '#8f9499'))
  parts.push(tint(new THREE.BoxGeometry(0.34, 0.26, 0.36).translate(0, 0.88, -0.62), '#f2b82a'))
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Could not build the bicycle')
  return merged
}

/** A model's body, wheels and all, painted and scaled: for the motorbike, three-wheeler, van and car. */
export function createModelBody(scene: THREE.Group, body: Extract<VehicleSpec['body'], { rig: 'model' }>, paint: string): THREE.BufferGeometry {
  const whole = createParkedCarGeometry(scene, body.model)
  const painted = paintModel(whole, paint)
  whole.dispose()
  painted.scale(body.scale, body.scale, body.scale)
  return painted
}
