import { useEffect, useRef } from 'react'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { useGameStore } from '../game/gameStore'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { livePlayer, liveView } from '../game/livePlayer'

type ChunkedMeshProps = {
  /** One geometry per map square. Each needs its bounding sphere computed. */
  geometries: THREE.BufferGeometry[]
  material: THREE.Material
  castShadow?: boolean
  /** Draws thin lines instead of solid triangles. */
  lines?: boolean
  /** A shorter draw distance for this layer, in metres. */
  maxDistance?: number
}

/**
 * Draws one layer of the world as separate map squares, and hides those beyond
 * the draw distance. The sphere's radius is taken off, so a square is kept until
 * its nearest edge is out of range. Three.js also skips any visible square that
 * isn't in front of the camera, which only works now that they're separate.
 */
export function ChunkedMesh({
  geometries,
  material,
  castShadow = false,
  lines = false,
  maxDistance = Infinity,
}: ChunkedMeshProps) {
  const group = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!group.current) return

    const reach = Math.min(liveView.drawDistance, maxDistance)
    const shadowRange = QUALITY_PRESETS[useGameStore.getState().quality].shadowRange
    for (const mesh of group.current.children as THREE.Mesh[]) {
      const sphere = mesh.geometry.boundingSphere
      if (!sphere) continue

      const distance = Math.hypot(sphere.center.x - livePlayer.x, sphere.center.z - livePlayer.z) - sphere.radius
      mesh.visible = distance < reach
      // Only squares within the sun's shadow range cast: the rest fall outside its shadow map.
      mesh.castShadow = castShadow && distance < shadowRange
    }
  })

  // We created these by hand, so R3F won't free their GPU memory for us.
  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose())
    },
    [geometries],
  )
  useEffect(() => () => material.dispose(), [material])

  return (
    <group ref={group}>
      {geometries.map((geometry) =>
        lines ? (
          <lineSegments key={geometry.uuid} geometry={geometry} material={material} />
        ) : (
          <mesh
            key={geometry.uuid}
            geometry={geometry}
            material={material}
            castShadow={castShadow}
            receiveShadow
          />
        ),
      )}
    </group>
  )
}
