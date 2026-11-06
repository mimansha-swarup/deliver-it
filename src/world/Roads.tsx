import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { LineFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { clipToPlayArea, createNormals, pushStrip, pushTriangle } from './roadGeometry'
import { lonLatToWorld, type GroundPoint } from './worldUtils'

/** Just above the ground, so the two surfaces don't flicker against each other. */
const ROAD_HEIGHT = 0.05
const JOINT_SIDES = 12

/** A flat circle. These fill the gaps at bends and form the junctions. */
function pushJoint(positions: number[], [x, z]: GroundPoint, width: number) {
  const pointOnCircle = (step: number): GroundPoint => {
    const angle = (step / JOINT_SIDES) * Math.PI * 2
    return [x + (Math.cos(angle) * width) / 2, z + (Math.sin(angle) * width) / 2]
  }

  for (let step = 0; step < JOINT_SIDES; step++) {
    pushTriangle(positions, ROAD_HEIGHT, [x, z], pointOnCircle(step), pointOnCircle(step + 1))
  }
}

function createRoadGeometry(roads: LineFeature[]): THREE.BufferGeometry {
  const positions: number[] = []

  // Roads share points at junctions. Keeping only the widest joint at each
  // point avoids stacking several circles in the same place.
  const joints = new Map<string, { point: GroundPoint; width: number }>()
  const addJoint = (point: GroundPoint, width: number) => {
    const key = `${point[0].toFixed(2)},${point[1].toFixed(2)}`
    if ((joints.get(key)?.width ?? 0) < width) joints.set(key, { point, width })
  }

  for (const road of roads) {
    const width = getRoadWidth(road)
    const points = road.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    for (let i = 0; i < points.length - 1; i++) {
      const clipped = clipToPlayArea(points[i], points[i + 1])
      if (!clipped) continue

      pushStrip(positions, ROAD_HEIGHT, clipped[0], clipped[1], width)
      addJoint(clipped[0], width)
      addJoint(clipped[1], width)
    }
  }

  joints.forEach(({ point, width }) => pushJoint(positions, point, width))

  const vertexCount = positions.length / 3
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(createNormals(vertexCount), 3))

  console.info(`[roads] built ${joints.size} joints, ${vertexCount / 3} triangles`)
  return geometry
}

export function Roads({ roads }: { roads: LineFeature[] }) {
  const geometry = useMemo(() => createRoadGeometry(roads), [roads])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color="#66676b"
        roughness={0.95}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}
