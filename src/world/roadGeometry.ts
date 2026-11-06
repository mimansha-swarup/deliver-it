import { PLAY_AREA_SIZE, type GroundPoint } from './worldUtils'

/**
 * Cuts a line segment down to the part inside the play area, or returns null if
 * none of it is inside. This is the Liang-Barsky clipping algorithm: `enter` and
 * `leave` track how far along the segment (from 0 to 1) it stays inside.
 */
export function clipToPlayArea(
  start: GroundPoint,
  end: GroundPoint,
): [GroundPoint, GroundPoint] | null {
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
export function pushTriangle(
  positions: number[],
  height: number,
  a: GroundPoint,
  b: GroundPoint,
  c: GroundPoint,
) {
  const facesUp = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0
  for (const [x, z] of facesUp ? [a, b, c] : [a, c, b]) {
    positions.push(x, height, z)
  }
}

/** A flat rectangle covering one straight piece of road or marking. */
export function pushStrip(
  positions: number[],
  height: number,
  start: GroundPoint,
  end: GroundPoint,
  width: number,
) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (length === 0) return

  // Turning the road's direction by 90 degrees gives the sideways direction.
  const sideX = ((end[1] - start[1]) / length) * (width / 2)
  const sideZ = (-(end[0] - start[0]) / length) * (width / 2)

  const startLeft: GroundPoint = [start[0] + sideX, start[1] + sideZ]
  const startRight: GroundPoint = [start[0] - sideX, start[1] - sideZ]
  const endLeft: GroundPoint = [end[0] + sideX, end[1] + sideZ]
  const endRight: GroundPoint = [end[0] - sideX, end[1] - sideZ]

  pushTriangle(positions, height, startLeft, startRight, endRight)
  pushTriangle(positions, height, startLeft, endRight, endLeft)
}

/** Flat geometry whose every corner faces straight up. */
export function createNormals(vertexCount: number): Float32Array {
  const normals = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    normals[i * 3 + 1] = 1
  }
  return normals
}
