import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ShopFront } from './shopFrontPlacement'

const COLORS = ['#c8553d', '#2a7f8e', '#d9a441', '#6b8f3a', '#8c4a7d', '#3d5fa8'].map(
  (color) => new THREE.Color(color),
)

const AWNING_HEIGHT = 2.9

/** A sloped sheet one metre wide, stretched to fit each shop. Its back edge is at the wall. */
function createAwningGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 0.08, 1.5)
  geometry.translate(0, 0, 0.75)
  geometry.rotateX(0.3)
  geometry.translate(0, AWNING_HEIGHT, 0)
  return geometry
}

/** Coloured awnings. They're above head height, so the scooter rides under them. */
export function ShopFronts({ shopFronts }: { shopFronts: ShopFront[] }) {
  const geometry = useMemo(() => createAwningGeometry(), [])
  const mesh = useRef<THREE.InstancedMesh>(null)

  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    const instances = mesh.current
    if (!instances) return

    const transform = new THREE.Object3D()
    shopFronts.forEach(({ x, z, rotation, width, variation }, index) => {
      transform.position.set(x, 0, z)
      transform.rotation.y = rotation
      transform.scale.set(width, 1, 1)
      transform.updateMatrix()
      instances.setMatrixAt(index, transform.matrix)
      instances.setColorAt(index, COLORS[Math.floor(variation * COLORS.length * 0.999)])
    })

    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
    instances.computeBoundingSphere()
  }, [shopFronts])

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, shopFronts.length]} receiveShadow>
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  )
}
