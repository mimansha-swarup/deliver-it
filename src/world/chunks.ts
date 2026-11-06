import * as THREE from 'three'
import { createNormals } from './roadGeometry'
import type { GroundPoint } from './worldUtils'

/** The map is cut into squares this wide, in metres, and each is drawn or skipped as a unit. */
export const CHUNK_SIZE = 160

/** A road piece longer than this is cut up, so that it can't stretch across many squares. */
const MAX_PIECE_LENGTH = CHUNK_SIZE / 2

/** One number naming the map square that a point falls in. */
export function chunkKey(x: number, z: number): number {
  return (Math.floor(x / CHUNK_SIZE) + 500) * 1000 + (Math.floor(z / CHUNK_SIZE) + 500)
}

/** Triangle corners waiting to become geometry, sorted by map square. */
export type ChunkedPositions = Map<number, number[]>

/** The list of triangle corners for the map square a point falls in. */
export function positionsFor(chunks: ChunkedPositions, [x, z]: GroundPoint): number[] {
  const key = chunkKey(x, z)
  let positions = chunks.get(key)
  if (!positions) {
    positions = []
    chunks.set(key, positions)
  }
  return positions
}

/** Cuts a straight line into pieces short enough to sit in about one map square. */
export function splitLongPiece(start: GroundPoint, end: GroundPoint): [GroundPoint, GroundPoint][] {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const count = Math.max(1, Math.ceil(length / MAX_PIECE_LENGTH))
  const pointAt = (part: number): GroundPoint => [
    start[0] + ((end[0] - start[0]) * part) / count,
    start[1] + ((end[1] - start[1]) * part) / count,
  ]

  return Array.from({ length: count }, (_, part) => [pointAt(part), pointAt(part + 1)])
}

/** Builds one flat geometry per map square. */
export function createFlatGeometries(chunks: ChunkedPositions): THREE.BufferGeometry[] {
  return [...chunks.values()].map((positions) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(createNormals(positions.length / 3), 3))
    geometry.computeBoundingSphere()
    return geometry
  })
}
