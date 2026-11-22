import * as THREE from 'three'

/**
 * Cuts one big shape into the map squares its triangles lie in (by each triangle's middle), `size`
 * metres across, each with its bounding sphere: for ChunkedMesh, which then draws only the squares
 * within sight and in front of the camera. A flyover or a metro line merged into one shape was
 * drawn whole, and again into the shadow map, wherever on the map the rider was.
 * The original is disposed of.
 */
export function splitIntoSquares(geometry: THREE.BufferGeometry, size = 150): THREE.BufferGeometry[] {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  if (flat !== geometry) geometry.dispose()
  const position = flat.getAttribute('position')
  const squares = new Map<string, number[]>()
  for (let first = 0; first < position.count; first += 3) {
    const x = (position.getX(first) + position.getX(first + 1) + position.getX(first + 2)) / 3
    const z = (position.getZ(first) + position.getZ(first + 1) + position.getZ(first + 2)) / 3
    const key = `${Math.floor(x / size)},${Math.floor(z / size)}`
    const list = squares.get(key)
    if (list) list.push(first)
    else squares.set(key, [first])
  }
  const names = Object.keys(flat.attributes)
  const pieces = [...squares.values()].map((firsts) => {
    const piece = new THREE.BufferGeometry()
    for (const name of names) {
      const attribute = flat.getAttribute(name) as THREE.BufferAttribute
      const { itemSize } = attribute
      const source = attribute.array as Float32Array
      const values = new (source.constructor as Float32ArrayConstructor)(firsts.length * 3 * itemSize)
      firsts.forEach((first, index) => values.set(source.subarray(first * itemSize, (first + 3) * itemSize), index * 3 * itemSize))
      piece.setAttribute(name, new THREE.BufferAttribute(values, itemSize, attribute.normalized))
    }
    piece.computeBoundingSphere()
    return piece
  })
  flat.dispose()
  return pieces
}
