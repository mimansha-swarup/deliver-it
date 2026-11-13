import * as THREE from 'three'
import { chunkKey } from './chunks'

/**
 * Long boxes laid along a line, such as kerbs and walls, collected into one
 * geometry per map square with a colour at every corner.
 */

const up = new THREE.Vector3(0, 1, 0)

/** Triangles for one map square, with a colour and a normal at every corner. */
export type Square = { positions: number[]; normals: number[]; colors: number[] }

export function squareFor(squares: Map<number, Square>, x: number, z: number): Square {
  const key = chunkKey(x, z)
  let square = squares.get(key)
  if (!square) {
    square = { positions: [], normals: [], colors: [] }
    squares.set(key, square)
  }
  return square
}

/**
 * A kerb block from `from` to `to` metres along a road edge. `alongX, alongZ`
 * is the way the road runs, `outX, outZ` points away from the road, and the
 * block reaches from `inner` to `outer` metres out. Only the faces you can see
 * are made: the top, the face towards the road and the face away from it.
 */
export function pushBlock(
  square: Square,
  [startX, startZ]: [number, number],
  alongX: number,
  alongZ: number,
  outX: number,
  outZ: number,
  [from, to]: [number, number],
  [inner, outer]: [number, number],
  height: number,
  color: THREE.Color,
  /** Also make the two end faces, for a block that stands on its own, such as a pillar. */
  ends = false,
  /** Where the block starts, above the ground. */
  base = 0,
) {
  const corner = (along: number, out: number, y: number) =>
    new THREE.Vector3(startX + alongX * along + outX * out, y, startZ + alongZ * along + outZ * out)
  const face = (points: THREE.Vector3[], normal: THREE.Vector3, shade: number) => {
    const [a, b, c, d] = points
    // Turn the corners round if they'd make the face point the wrong way (see Lesson 174).
    const facing = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).dot(normal)
    for (const point of facing >= 0 ? [a, b, c, a, c, d] : [a, d, c, a, c, b]) {
      square.positions.push(point.x, point.y, point.z)
      square.normals.push(normal.x, normal.y, normal.z)
      square.colors.push(color.r * shade, color.g * shade, color.b * shade)
    }
  }
  const outward = new THREE.Vector3(outX, 0, outZ)
  const inward = outward.clone().negate()

  face([corner(from, inner, height), corner(to, inner, height), corner(to, outer, height), corner(from, outer, height)], up, 1)
  // The sides are a little darker, as the edge of a real kerb is in its own shadow.
  face([corner(from, inner, base), corner(to, inner, base), corner(to, inner, height), corner(from, inner, height)], inward, 0.86)
  face([corner(from, outer, base), corner(to, outer, base), corner(to, outer, height), corner(from, outer, height)], outward, 0.86)
  if (!ends) return
  const backward = new THREE.Vector3(-alongX, 0, -alongZ)
  const forward = backward.clone().negate()
  face([corner(from, inner, base), corner(from, outer, base), corner(from, outer, height), corner(from, inner, height)], backward, 0.8)
  face([corner(to, inner, base), corner(to, outer, base), corner(to, outer, height), corner(to, inner, height)], forward, 0.8)
}


/** Turns the collected squares into geometries, with normals and colours a byte each. */
export function toBlockGeometries(squares: Map<number, Square>): THREE.BufferGeometry[] {
  return [...squares.values()].map(({ positions, normals, colors }) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(Int8Array.from(normals, (value) => Math.round(value * 127)), 3, true))
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(Uint8Array.from(colors, (value) => Math.round(Math.min(1, value) * 255)), 3, true),
    )
    geometry.computeBoundingSphere()
    return geometry
  })
}
