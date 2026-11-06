import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { LineFeature } from './mapData'
import { clipToPlayArea, createNormals, pushStrip } from './roadGeometry'
import { lonLatToWorld, type GroundPoint } from './worldUtils'

const DASH_LENGTH = 2
const GAP_LENGTH = 3.5
const DASH_WIDTH = 0.14
const MARKING_HEIGHT = 0.07

/** Markings stop this far from a junction, in metres. */
const JUNCTION_CLEARANCE = 6

/** Any point used by two or more roads, or by more than one piece of a road's end, is a junction. */
function findJunctions(roads: LineFeature[]): GroundPoint[] {
  const uses = new Map<string, { point: GroundPoint; count: number }>()

  for (const road of roads) {
    for (const position of road.geometry.coordinates) {
      const key = position.join()
      const entry = uses.get(key)
      if (entry) {
        entry.count++
      } else {
        const [x, , z] = lonLatToWorld(position)
        uses.set(key, { point: [x, z], count: 1 })
      }
    }
  }

  return [...uses.values()].filter(({ count }) => count > 1).map(({ point }) => point)
}

function createMarkingGeometry(roads: LineFeature[]): THREE.BufferGeometry {
  const junctions = findJunctions(roads)
  const isNearJunction = ([x, z]: GroundPoint) =>
    junctions.some(([jx, jz]) => Math.hypot(jx - x, jz - z) < JUNCTION_CLEARANCE)

  const positions: number[] = []

  for (const road of roads) {
    const points = road.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    for (let i = 0; i < points.length - 1; i++) {
      const clipped = clipToPlayArea(points[i], points[i + 1])
      if (!clipped) continue

      const [start, end] = clipped
      const length = Math.hypot(end[0] - start[0], end[1] - start[1])
      const directionX = (end[0] - start[0]) / length
      const directionZ = (end[1] - start[1]) / length

      for (let along = 0; along + DASH_LENGTH <= length; along += DASH_LENGTH + GAP_LENGTH) {
        const dashStart: GroundPoint = [
          start[0] + directionX * along,
          start[1] + directionZ * along,
        ]
        const dashEnd: GroundPoint = [
          dashStart[0] + directionX * DASH_LENGTH,
          dashStart[1] + directionZ * DASH_LENGTH,
        ]
        if (isNearJunction(dashStart) || isNearJunction(dashEnd)) continue

        pushStrip(positions, MARKING_HEIGHT, dashStart, dashEnd, DASH_WIDTH)
      }
    }
  }

  const vertexCount = positions.length / 3
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(createNormals(vertexCount), 3))
  return geometry
}

export function RoadMarkings({ roads }: { roads: LineFeature[] }) {
  const geometry = useMemo(() => createMarkingGeometry(roads), [roads])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color="#e8e5da"
        roughness={0.8}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}
