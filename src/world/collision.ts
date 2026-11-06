import type { PolygonFeature } from './mapData'
import { isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

/** A building outline in world coordinates. The last point joins back to the first. */
type Footprint = GroundPoint[]

/** Buildings sorted into grid cells, so a check only looks at those nearby. */
export type CollisionWorld = Map<number, Footprint[]>

const CELL_SIZE = 20

/** Largest radius a check may use. Footprints are stored in every cell this close. */
const MAX_CHECK_RADIUS = 2

/** Enough for a tight corner between two buildings, where one push causes another. */
const PUSH_PASSES = 3

function toCell(position: number): number {
  return Math.floor(position / CELL_SIZE)
}

/** One number for a pair of cells. The offset keeps negative cells unique. */
function cellKey(cellX: number, cellZ: number): number {
  return (cellX + 5000) * 10000 + (cellZ + 5000)
}

export function createCollisionWorld(buildings: PolygonFeature[]): CollisionWorld {
  const world: CollisionWorld = new Map()

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) continue

    const footprint = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    const xs = footprint.map(([x]) => x)
    const zs = footprint.map(([, z]) => z)
    const firstX = toCell(Math.min(...xs) - MAX_CHECK_RADIUS)
    const lastX = toCell(Math.max(...xs) + MAX_CHECK_RADIUS)
    const firstZ = toCell(Math.min(...zs) - MAX_CHECK_RADIUS)
    const lastZ = toCell(Math.max(...zs) + MAX_CHECK_RADIUS)

    for (let cellX = firstX; cellX <= lastX; cellX++) {
      for (let cellZ = firstZ; cellZ <= lastZ; cellZ++) {
        const key = cellKey(cellX, cellZ)
        const cell = world.get(key)
        if (cell) cell.push(footprint)
        else world.set(key, [footprint])
      }
    }
  }

  return world
}

/**
 * Finds the nearest point on a footprint's outline, and whether (x, z) is inside.
 * "Inside" uses the ray test: walk in one direction and count the walls you
 * cross. An odd number means you started inside.
 */
function measureFootprint(footprint: Footprint, x: number, z: number) {
  let nearestX = 0
  let nearestZ = 0
  let nearestSquared = Infinity
  let inside = false

  for (let i = 0, previous = footprint.length - 1; i < footprint.length; previous = i++) {
    const [ax, az] = footprint[previous]
    const [bx, bz] = footprint[i]
    const edgeX = bx - ax
    const edgeZ = bz - az

    const lengthSquared = edgeX * edgeX + edgeZ * edgeZ
    const along = lengthSquared === 0 ? 0 : ((x - ax) * edgeX + (z - az) * edgeZ) / lengthSquared
    const clamped = Math.max(0, Math.min(1, along))
    const pointX = ax + edgeX * clamped
    const pointZ = az + edgeZ * clamped

    const squared = (x - pointX) ** 2 + (z - pointZ) ** 2
    if (squared < nearestSquared) {
      nearestSquared = squared
      nearestX = pointX
      nearestZ = pointZ
    }

    if (az > z !== bz > z && x < ax + ((z - az) / edgeZ) * edgeX) inside = !inside
  }

  return { nearestX, nearestZ, distance: Math.sqrt(nearestSquared), inside }
}

/** Moves a circle out of any buildings it overlaps. Updates `point` in place. */
export function pushOutOfBuildings(
  world: CollisionWorld,
  point: { x: number; z: number },
  radius: number,
) {
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    const nearby = world.get(cellKey(toCell(point.x), toCell(point.z)))
    if (!nearby) return

    let moved = false
    for (const footprint of nearby) {
      const { nearestX, nearestZ, distance, inside } = measureFootprint(footprint, point.x, point.z)
      if (!inside && distance >= radius) continue
      if (distance === 0) continue

      // Outside: move away from the wall. Inside: move through it and out.
      const direction = inside ? 1 : -1
      const push = inside ? distance + radius : radius - distance
      point.x += (((nearestX - point.x) / distance) * push * direction)
      point.z += (((nearestZ - point.z) / distance) * push * direction)
      moved = true
    }
    if (!moved) return
  }
}

/** True when a point is inside a building or within `radius` of one. */
export function isNearBuilding(world: CollisionWorld, x: number, z: number, radius: number): boolean {
  const nearby = world.get(cellKey(toCell(x), toCell(z)))
  if (!nearby) return false

  return nearby.some((footprint) => {
    const { distance, inside } = measureFootprint(footprint, x, z)
    return inside || distance < radius
  })
}
