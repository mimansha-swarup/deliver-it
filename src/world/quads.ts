import * as THREE from 'three'
import { chunkKey } from './chunks'

/** Collects flat faces with texture coordinates, sorted by map square. */
export class QuadBuilder {
  private squares = new Map<number, { positions: number[]; normals: number[]; uvs: number[] }>()

  /** Corners go bottom-left, bottom-right, top-right, top-left, as seen from the front. */
  quad(corners: THREE.Vector3[], normal: THREE.Vector3, [u0, v0, u1, v1]: number[]) {
    const key = chunkKey(corners[0].x, corners[0].z)
    let square = this.squares.get(key)
    if (!square) {
      square = { positions: [], normals: [], uvs: [] }
      this.squares.set(key, square)
    }
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]
    for (const index of [0, 1, 2, 0, 2, 3]) {
      square.positions.push(corners[index].x, corners[index].y, corners[index].z)
      square.normals.push(normal.x, normal.y, normal.z)
      square.uvs.push(uvs[index][0], uvs[index][1])
    }
  }

  toGeometries(): THREE.BufferGeometry[] {
    return [...this.squares.values()].map(({ positions, normals, uvs }) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geometry.computeBoundingSphere()
      return geometry
    })
  }
}
