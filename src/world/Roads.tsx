import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { LineFeature } from './mapData'
import { lonLatToWorld, PLAY_AREA_SIZE } from './worldUtils'

/** A position on the ground: [x, z]. */
type GroundPoint = [x: number, z: number]

const LANE_WIDTH = 3.5
const DEFAULT_ROAD_WIDTH = 5

/**
 * Road widths in metres. OSM has no width data here, so these were chosen by
 * measuring the gap between road centrelines and the nearest buildings.
 */
const ROAD_WIDTHS: Record<string, number> = {
  secondary: 9,
  tertiary: 7,
  residential: 5,
  service: 4,
  track: 3,
}

/** Just above the ground, so the two surfaces don't flicker against each other. */
const ROAD_HEIGHT = 0.05
const JOINT_SIDES = 12

function getRoadWidth({ properties }: LineFeature): number {
  const lanes = Number(properties.lanes)
  if (lanes > 0) return lanes * LANE_WIDTH
  return ROAD_WIDTHS[properties.highway ?? ''] ?? DEFAULT_ROAD_WIDTH
}

/**
 * Cuts a line segment down to the part inside the play area, or returns null if
 * none of it is inside. This is the Liang-Barsky clipping algorithm: `enter` and
 * `leave` track how far along the segment (from 0 to 1) it stays inside.
 */
function clipToPlayArea(start: GroundPoint, end: GroundPoint): [GroundPoint, GroundPoint] | null {
  const half = PLAY_AREA_SIZE / 2
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  let enter = 0
  let leave = 1

  const edges = [
    [-dx, start[0] + half],
    [dx, half - start[0]],
    [-dz, start[1] + half],
    [dz, half - start[1]],
  ]

  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return null
      continue
    }
    const crossing = distance / direction
    if (direction < 0) enter = Math.max(enter, crossing)
    else leave = Math.min(leave, crossing)
    if (enter > leave) return null
  }

  return [
    [start[0] + enter * dx, start[1] + enter * dz],
    [start[0] + leave * dx, start[1] + leave * dz],
  ]
}

/** Adds a triangle, swapping two corners if needed so that it faces upwards. */
function pushTriangle(positions: number[], a: GroundPoint, b: GroundPoint, c: GroundPoint) {
  const facesUp = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0
  for (const [x, z] of facesUp ? [a, b, c] : [a, c, b]) {
    positions.push(x, ROAD_HEIGHT, z)
  }
}

/** A flat rectangle covering one straight piece of road. */
function pushStrip(positions: number[], start: GroundPoint, end: GroundPoint, width: number) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (length === 0) return

  // Turning the road's direction by 90 degrees gives the sideways direction.
  const sideX = ((end[1] - start[1]) / length) * (width / 2)
  const sideZ = (-(end[0] - start[0]) / length) * (width / 2)

  const startLeft: GroundPoint = [start[0] + sideX, start[1] + sideZ]
  const startRight: GroundPoint = [start[0] - sideX, start[1] - sideZ]
  const endLeft: GroundPoint = [end[0] + sideX, end[1] + sideZ]
  const endRight: GroundPoint = [end[0] - sideX, end[1] - sideZ]

  pushTriangle(positions, startLeft, startRight, endRight)
  pushTriangle(positions, startLeft, endRight, endLeft)
}

/** A flat circle. These fill the gaps at bends and form the junctions. */
function pushJoint(positions: number[], [x, z]: GroundPoint, width: number) {
  const pointOnCircle = (step: number): GroundPoint => {
    const angle = (step / JOINT_SIDES) * Math.PI * 2
    return [x + (Math.cos(angle) * width) / 2, z + (Math.sin(angle) * width) / 2]
  }

  for (let step = 0; step < JOINT_SIDES; step++) {
    pushTriangle(positions, [x, z], pointOnCircle(step), pointOnCircle(step + 1))
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

      pushStrip(positions, clipped[0], clipped[1], width)
      addJoint(clipped[0], width)
      addJoint(clipped[1], width)
    }
  }

  joints.forEach(({ point, width }) => pushJoint(positions, point, width))

  // The road is flat, so every corner has the same normal: straight up.
  const vertexCount = positions.length / 3
  const normals = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    normals[i * 3 + 1] = 1
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))

  console.info(`[roads] built ${joints.size} joints, ${vertexCount / 3} triangles`)
  return geometry
}

export function Roads({ roads }: { roads: LineFeature[] }) {
  const geometry = useMemo(() => createRoadGeometry(roads), [roads])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color="#6a6b6f"
        roughness={0.95}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}
