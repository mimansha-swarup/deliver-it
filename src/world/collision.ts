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

function addFootprint(world: CollisionWorld, footprint: Footprint) {
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

export function createCollisionWorld(buildings: PolygonFeature[]): CollisionWorld {
  const world: CollisionWorld = new Map()

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) continue

    addFootprint(
      world,
      ring.slice(0, -1).map((position): GroundPoint => {
        const [x, , z] = lonLatToWorld(position)
        return [x, z]
      }),
    )
  }

  return world
}

/** A copy that later additions to the original don't change. The outlines themselves are shared, as they never change. */
export function copyCollisionWorld(world: CollisionWorld): CollisionWorld {
  return new Map([...world].map(([key, cell]) => [key, [...cell]]))
}

/** Adds a thin solid wall from one point to another, such as a compound wall. */
export function addWall(world: CollisionWorld, [startX, startZ]: GroundPoint, [endX, endZ]: GroundPoint, thickness: number) {
  const length = Math.hypot(endX - startX, endZ - startZ)
  if (length === 0) return
  const sideX = (-(endZ - startZ) / length) * (thickness / 2)
  const sideZ = ((endX - startX) / length) * (thickness / 2)
  addFootprint(world, [
    [startX + sideX, startZ + sideZ],
    [endX + sideX, endZ + sideZ],
    [endX - sideX, endZ - sideZ],
    [startX - sideX, startZ - sideZ],
  ])
}

/** Adds a small solid post, such as a tree trunk or a lamp post. */
export function addPost(world: CollisionWorld, x: number, z: number, radius: number) {
  const sides = 6
  const footprint: Footprint = []
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2
    footprint.push([x + Math.cos(angle) * radius, z + Math.sin(angle) * radius])
  }
  addFootprint(world, footprint)
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

/**
 * Where a wall is, and the direction pointing away from the building. `startX`,
 * `startZ` and `alongX`, `alongZ` give the wall's start and direction, and `offset`
 * is how far along it the nearest point is, so things can be kept within its ends.
 */
export type WallSpot = {
  x: number
  z: number
  normalX: number
  normalZ: number
  length: number
  startX: number
  startZ: number
  alongX: number
  alongZ: number
  offset: number
}

/** Finds the closest wall to a point, or null if none is within `reach`. */
export function findNearestWall(
  world: CollisionWorld,
  x: number,
  z: number,
  reach: number,
): WallSpot | null {
  let best: WallSpot | null = null
  let bestDistance = reach

  for (let cellX = toCell(x - reach); cellX <= toCell(x + reach); cellX++) {
    for (let cellZ = toCell(z - reach); cellZ <= toCell(z + reach); cellZ++) {
      for (const footprint of world.get(cellKey(cellX, cellZ)) ?? []) {
        const centreX = footprint.reduce((sum, point) => sum + point[0], 0) / footprint.length
        const centreZ = footprint.reduce((sum, point) => sum + point[1], 0) / footprint.length

        for (let i = 0, previous = footprint.length - 1; i < footprint.length; previous = i++) {
          const [ax, az] = footprint[previous]
          const [bx, bz] = footprint[i]
          const length = Math.hypot(bx - ax, bz - az)
          if (length === 0) continue

          const along = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (length * length)
          const clamped = Math.max(0, Math.min(1, along))
          const wallX = ax + (bx - ax) * clamped
          const wallZ = az + (bz - az) * clamped
          const distance = Math.hypot(x - wallX, z - wallZ)
          if (distance >= bestDistance) continue

          // Either side of a wall could be outside, so pick the one facing away from the middle.
          const sideX = (bz - az) / length
          const sideZ = -(bx - ax) / length
          const facesOut = (ax - centreX) * sideX + (az - centreZ) * sideZ > 0
          bestDistance = distance
          best = {
            x: wallX,
            z: wallZ,
            normalX: facesOut ? sideX : -sideX,
            normalZ: facesOut ? sideZ : -sideZ,
            length,
            startX: ax,
            startZ: az,
            alongX: (bx - ax) / length,
            alongZ: (bz - az) / length,
            offset: clamped * length,
          }
        }
      }
    }
  }

  return best
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

/** True when a circle could slide in a straight line from one point to another. */
export function hasClearLine(
  world: CollisionWorld,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
): boolean {
  const length = Math.hypot(toX - fromX, toZ - fromZ)
  const steps = Math.max(1, Math.ceil(length))

  for (let step = 1; step <= steps; step++) {
    const along = step / steps
    if (isNearBuilding(world, fromX + (toX - fromX) * along, fromZ + (toZ - fromZ) * along, radius)) {
      return false
    }
  }
  return true
}
