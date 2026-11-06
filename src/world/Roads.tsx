import { useMemo } from 'react'
import * as THREE from 'three'
import { ChunkedMesh } from './ChunkedMesh'
import { createFlatGeometries, positionsFor, splitLongPiece, type ChunkedPositions } from './chunks'
import type { LineFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { clipToPlayArea, pushStrip, pushTriangle } from './roadGeometry'
import { lonLatToWorld, type GroundPoint } from './worldUtils'

/** Just above the ground, so the two surfaces don't flicker against each other. */
const ROAD_HEIGHT = 0.05
const JOINT_SIDES = 12
/** A pavement runs under each road, showing this far past the edge on both sides. */
export const PAVEMENT_WIDTH = 1.8
const PAVEMENT_HEIGHT = 0.03

/** A flat circle. These fill the gaps at bends and form the junctions. */
function pushJoint(positions: number[], [x, z]: GroundPoint, width: number, height: number) {
  const pointOnCircle = (step: number): GroundPoint => {
    const angle = (step / JOINT_SIDES) * Math.PI * 2
    return [x + (Math.cos(angle) * width) / 2, z + (Math.sin(angle) * width) / 2]
  }

  for (let step = 0; step < JOINT_SIDES; step++) {
    pushTriangle(positions, height, [x, z], pointOnCircle(step), pointOnCircle(step + 1))
  }
}

function createRoadGeometry(
  roads: LineFeature[],
  height: number,
  extraWidth: number,
): THREE.BufferGeometry[] {
  const chunks: ChunkedPositions = new Map()

  // Roads share points at junctions. Keeping only the widest joint at each
  // point avoids stacking several circles in the same place.
  const joints = new Map<string, { point: GroundPoint; width: number }>()
  const addJoint = (point: GroundPoint, width: number) => {
    const key = `${point[0].toFixed(2)},${point[1].toFixed(2)}`
    if ((joints.get(key)?.width ?? 0) < width) joints.set(key, { point, width })
  }

  for (const road of roads) {
    const width = getRoadWidth(road) + extraWidth
    const points = road.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    for (let i = 0; i < points.length - 1; i++) {
      const clipped = clipToPlayArea(points[i], points[i + 1])
      if (!clipped) continue

      for (const [start, end] of splitLongPiece(clipped[0], clipped[1])) {
        pushStrip(positionsFor(chunks, start), height, start, end, width)
      }
      addJoint(clipped[0], width)
      addJoint(clipped[1], width)
    }
  }

  joints.forEach(({ point, width }) => {
    pushJoint(positionsFor(chunks, point), point, width, height)
  })

  return createFlatGeometries(chunks)
}

export function Roads({ roads }: { roads: LineFeature[] }) {
  const road = useMemo(() => createRoadGeometry(roads, ROAD_HEIGHT, 0), [roads])
  const pavement = useMemo(
    () => createRoadGeometry(roads, PAVEMENT_HEIGHT, PAVEMENT_WIDTH * 2),
    [roads],
  )

  const roadMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#66676b',
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  )
  const pavementMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#a8a498',
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  )

  return (
    <>
      <ChunkedMesh geometries={pavement} material={pavementMaterial} />
      <ChunkedMesh geometries={road} material={roadMaterial} />
    </>
  )
}
