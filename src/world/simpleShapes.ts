import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Paints a shape one flat colour. White parts take on each copy's own colour. */
export function colored(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  geometry.deleteAttribute('uv')

  const { r, g, b } = new THREE.Color(color)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

export function box(
  size: [number, number, number],
  position: [number, number, number],
  color: string,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(...size).toNonIndexed()
  geometry.translate(...position)
  return colored(geometry, color)
}

/** Joins parts into one geometry, and frees the parts. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)
  if (!merged) throw new Error('Could not merge shapes')
  parts.forEach((part) => part.dispose())
  return merged
}
