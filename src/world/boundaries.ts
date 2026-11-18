import { addWall, isNearBuilding, type CollisionWorld } from './collision'
import { PANEL, type FenceKind, type FenceRun } from './fencing'
import type { LineFeature } from './mapData'
import { forEachRoadNear, indexRoadPieces, nearestRoadEdge, nearestRoadPiece, PointGrid, toRoadPieces, type RoadIndex } from './props'
import { Surface, worldSurface } from './surfaceMap'
import { isInsideBounds, lonLatToWorld, type GroundPoint } from './worldUtils'

/*
 * Boundaries round parks, compounds, school grounds, temples, walled plots and the back of
 * petrol bunks, as closed loops that stop at the footpath's edge:
 *
 * - The outline is cut into panels, and each panel's corner is moved in, square to its side
 *   (along the bisector at a corner, so neighbouring sides still meet), until it's off the
 *   road, median and footpath on the surface map. A corner that would have to move further
 *   than `MAX_SHIFT` is where a road runs into the compound: the loop opens there.
 * - Where a road or a path crosses the line, the loop opens in a gate with a pillar each side.
 *   Every loop gets at least one gate, on the side nearest a road.
 * - A panel that runs into a building is left out: the building's own wall closes the loop.
 *
 * OSM's own mapped walls and fences are often in pieces. Pieces whose ends meet (within
 * `JOIN`) are joined into one line, a line whose ends nearly meet is closed, and every panel
 * is kept off the road, median and footpath. A mapped line that runs along a loop already
 * built is left out, so there's never a double wall.
 */

/** A corner moves in at most this far to get behind the footpath, in metres. */
const MAX_SHIFT = 8
/** Moved in by this much at a time, and this far past the footpath's edge. */
const SHIFT_STEP = 0.4
const CLEARANCE = 0.3
/** A gate's opening, and its pillars. */
const GATE_WIDTH = 3.2
const PILLAR = 0.4
/** Paths (footways) as thick as this cross a boundary. */
const PATH_WIDTH = 2
/** Mapped barrier pieces whose ends are this close are one line; a line whose ends are this close (and that's long enough to be a loop) is closed. */
const JOIN = 1.5
const CLOSE_GAP = 12
const CLOSE_MIN_LENGTH = 40
/** A mapped panel this close to a loop's panel is the same boundary. */
const SAME_BOUNDARY = 2.5

const THICKNESS: Partial<Record<FenceKind, number>> = { wall: 0.25, templeWall: 0.25, parkRailing: 0.26, chainLink: 0.14, steelRailing: 0.08, retaining: 0.4 }
const thickness = (kind: FenceKind) => THICKNESS[kind] ?? 0.15

export type BoundaryLoop = {
  outline: GroundPoint[]
  kind: FenceKind
  variation: number
  /**
   * Leave out panels this close to a road's edge: the open front of a petrol bunk. Such a loop's
   * corners also stay where they are (moving them in would put the wall across the forecourt).
   */
  openWithin?: number
}

export type BoundaryReport = {
  loops: number
  panels: number
  gates: number
  roadOpenings: number
  pathOpenings: number
  movedBehindFootpath: number
  againstBuildings: number
  mappedPieces: number
  mappedLines: number
  mappedGapsClosed: number
  mappedMovedBehindFootpath: number
  mappedPanelsOnRoad: number
  mappedOutsidePlayArea: number
  mappedDuplicates: number
}

type Panel = [GroundPoint, GroundPoint]

/** Off the road, median and footpath, by `CLEARANCE` all round. */
function isClear(x: number, z: number): boolean {
  const map = worldSurface.map
  if (!map) return true
  for (const [dx, dz] of [[0, 0], [CLEARANCE, 0], [-CLEARANCE, 0], [0, CLEARANCE], [0, -CLEARANCE]]) {
    const ground = map.at(x + dx, z + dz)
    if (ground === Surface.Road || ground === Surface.Median || ground === Surface.Footpath) return false
  }
  return true
}

function crosses(a: GroundPoint, b: GroundPoint, c: GroundPoint, d: GroundPoint): boolean {
  const side = (p: GroundPoint, q: GroundPoint, r: GroundPoint) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function signedArea(outline: GroundPoint[]): number {
  let doubled = 0
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]
    const [bx, bz] = outline[(i + 1) % outline.length]
    doubled += ax * bz - bx * az
  }
  return doubled / 2
}

/** Joins panels that follow on from each other into runs, and makes them solid. */
/** Whether a run carried on to `to` stays straight: within about 3° of its own direction. */
function isStraightOn(run: FenceRun, to: GroundPoint): boolean {
  const ax = run.to[0] - run.from[0]
  const az = run.to[1] - run.from[1]
  const bx = to[0] - run.to[0]
  const bz = to[1] - run.to[1]
  const lengths = Math.hypot(ax, az) * Math.hypot(bx, bz)
  return lengths > 0 && (ax * bx + az * bz) / lengths > 0.9986
}

function joinPanels(panels: Panel[], kind: FenceKind, variation: number, collisions: CollisionWorld): FenceRun[] {
  const runs: FenceRun[] = []
  let current: FenceRun | null = null
  for (const [from, to] of panels) {
    // Joined only where the panels run on in the same direction: joined round a corner, the run
    // would be drawn (and made solid) straight from its start to its end, across the corner.
    if (current && current.to[0] === from[0] && current.to[1] === from[1] && isStraightOn(current, to)) {
      current.to = to
      continue
    }
    current = { from, to, kind, variation }
    runs.push(current)
  }
  for (const run of runs) addWall(collisions, run.from, run.to, thickness(kind))
  return runs
}

/** A gate pillar: a stub of wall standing at the edge of an opening, along the line. */
function pillar(at: GroundPoint, toward: GroundPoint, variation: number): FenceRun {
  const length = Math.hypot(toward[0] - at[0], toward[1] - at[1]) || 1
  const dx = ((toward[0] - at[0]) / length) * PILLAR
  const dz = ((toward[1] - at[1]) / length) * PILLAR
  return { from: [at[0] - dx / 2, at[1] - dz / 2], to: [at[0] + dx / 2, at[1] + dz / 2], kind: 'wall', variation }
}

export class BoundaryPlanner {
  readonly report: BoundaryReport = {
    loops: 0,
    panels: 0,
    gates: 0,
    roadOpenings: 0,
    pathOpenings: 0,
    movedBehindFootpath: 0,
    againstBuildings: 0,
    mappedPieces: 0,
    mappedLines: 0,
    mappedGapsClosed: 0,
    mappedMovedBehindFootpath: 0,
    mappedPanelsOnRoad: 0,
    mappedOutsidePlayArea: 0,
    mappedDuplicates: 0,
  }
  private readonly paths: RoadIndex
  /** Middles of every loop panel, so mapped lines along them are left out. */
  private readonly built = new PointGrid(8)

  private readonly roads: RoadIndex
  private readonly collisions: CollisionWorld

  constructor(footways: LineFeature[], roads: RoadIndex, collisions: CollisionWorld) {
    this.roads = roads
    this.collisions = collisions
    this.paths = indexRoadPieces(toRoadPieces(footways).map((piece) => ({ ...piece, width: PATH_WIDTH })))
  }

  /** Whether a road or path runs across a panel. */
  private crossing(from: GroundPoint, to: GroundPoint): 'road' | 'path' | null {
    const middleX = (from[0] + to[0]) / 2
    const middleZ = (from[1] + to[1]) / 2
    const reach = Math.hypot(to[0] - from[0], to[1] - from[1]) / 2 + 1
    let found: 'road' | 'path' | null = null
    forEachRoadNear(this.roads, middleX, middleZ, reach, (piece) => {
      if (!found && crosses(from, to, piece.start, piece.end)) found = 'road'
    })
    if (found) return found
    forEachRoadNear(this.paths, middleX, middleZ, reach, (piece) => {
      if (!found && crosses(from, to, piece.start, piece.end)) found = 'path'
    })
    return found
  }

  /** One closed loop round an outline. */
  loop({ outline, kind, variation, openWithin = 0 }: BoundaryLoop): FenceRun[] {
    if (outline.length < 3) return []
    const [cx, cz] = outline[0]
    if (!isInsideBounds(cx, cz, 2)) return []
    this.report.loops++
    const inward = signedArea(outline) > 0 ? 1 : -1
    const size = PANEL[kind]

    // Each panel corner, and the direction "in" there: square to its side, or the bisector at a corner.
    const corners: { point: GroundPoint; inX: number; inZ: number }[] = []
    const normal = (i: number): [number, number] => {
      const [ax, az] = outline[i % outline.length]
      const [bx, bz] = outline[(i + 1) % outline.length]
      const length = Math.hypot(bx - ax, bz - az) || 1
      return [(-(bz - az) / length) * inward, ((bx - ax) / length) * inward]
    }
    for (let i = 0; i < outline.length; i++) {
      const [ax, az] = outline[i]
      const [bx, bz] = outline[(i + 1) % outline.length]
      const length = Math.hypot(bx - ax, bz - az)
      if (length < 0.3) continue
      const [nx, nz] = normal(i)
      const [px, pz] = normal(i + outline.length - 1)
      // At the corner: the bisector, long enough that both sides move in by the same amount.
      const bisX = nx + px
      const bisZ = nz + pz
      const bisLength = Math.hypot(bisX, bisZ)
      const cos = bisLength / 2
      if (bisLength > 0.2 && cos > 0.35) corners.push({ point: [ax, az], inX: bisX / bisLength / cos, inZ: bisZ / bisLength / cos })
      else corners.push({ point: [ax, az], inX: nx, inZ: nz })
      const count = Math.max(1, Math.round(length / size))
      for (let part = 1; part < count; part++) {
        corners.push({ point: [ax + ((bx - ax) * part) / count, az + ((bz - az) * part) / count], inX: nx, inZ: nz })
      }
    }

    // Moves each corner in until it's clear of the road and footpath, or gives up (null).
    const maxShift = openWithin > 0 ? 0 : MAX_SHIFT
    const settled = corners.map(({ point: [x, z], inX, inZ }): GroundPoint | null => {
      for (let shift = 0; shift <= maxShift; shift += SHIFT_STEP) {
        const px = x + inX * shift
        const pz = z + inZ * shift
        if (isClear(px, pz)) {
          if (shift > 0) this.report.movedBehindFootpath++
          return [px, pz]
        }
      }
      return null
    })

    // Walks the loop: a panel between each pair of settled corners, unless something crosses it.
    const panels: Panel[] = []
    const openings: Panel[] = []
    const ends: Panel[] = []
    let openFront = false
    let nearestPanel = -1
    let nearestEdge = Infinity
    for (let i = 0; i < settled.length; i++) {
      const from = settled[i]
      const to = settled[(i + 1) % settled.length]
      if (!from || !to) {
        // The loop stops where a road runs in: a pillar at the end that stands.
        if ((from || to) && openWithin === 0) {
          this.report.roadOpenings++
          const end = (from ?? to)!
          const other = corners[(from ? i + 1 : i) % corners.length].point
          ends.push([end, other])
        }
        continue
      }
      const middle: GroundPoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
      if (!isClear(middle[0], middle[1])) {
        this.report.roadOpenings++
        continue
      }
      const edge = nearestRoadEdge(this.roads, middle[0], middle[1], 60)
      if (edge < openWithin) {
        // The open front: it counts as the way in, so the loop gets no extra gate.
        openFront = true
        continue
      }
      const crossing = this.crossing(from, to)
      if (crossing) {
        this.report[crossing === 'road' ? 'roadOpenings' : 'pathOpenings']++
        openings.push([from, to])
        continue
      }
      if (isNearBuilding(this.collisions, middle[0], middle[1], thickness(kind) / 2 + 0.05)) {
        this.report.againstBuildings++
        continue
      }
      if (edge < nearestEdge) {
        nearestEdge = edge
        nearestPanel = panels.length
      }
      panels.push([from, to])
    }

    // A loop with no opening at all gets a gate on the side nearest a road: the panel nearest
    // it and, if the panels are short, its neighbours, to make the gate's width.
    if (openings.length === 0 && !openFront && nearestPanel >= 0 && panels.length > 3) {
      const [from, to] = panels[nearestPanel]
      const panelLength = Math.hypot(to[0] - from[0], to[1] - from[1])
      const take = Math.max(1, Math.round(GATE_WIDTH / Math.max(panelLength, 0.5)))
      const start = Math.max(0, nearestPanel - Math.floor((take - 1) / 2))
      const gate = panels.splice(start, Math.min(take, panels.length - 3))
      openings.push([gate[0][0], gate[gate.length - 1][1]])
    }

    const runs = joinPanels(panels, kind, variation, this.collisions)
    for (const [from, to] of panels) this.built.add((from[0] + to[0]) / 2, (from[1] + to[1]) / 2)
    this.report.panels += panels.length
    // Pillars either side of each gate, and where the loop stops at a road, on walls and fences alike.
    const pillars: FenceRun[] = []
    for (const [from, to] of openings) pillars.push(pillar(from, to, variation), pillar(to, from, variation))
    for (const [end, toward] of ends) pillars.push(pillar(end, toward, variation))
    this.report.gates += openings.length
    for (const run of pillars) addWall(this.collisions, run.from, run.to, PILLAR)
    return [...runs, ...pillars]
  }

  /** A point moved straight away from the nearest road until it's behind the footpath, or null. */
  private awayFromRoad([x, z]: GroundPoint): GroundPoint | null {
    if (isClear(x, z)) return [x, z]
    const near = nearestRoadPiece(this.roads, x, z, 15)
    if (!near) return null
    const { start, end } = near.piece
    const ex = end[0] - start[0]
    const ez = end[1] - start[1]
    const lengthSquared = ex * ex + ez * ez || 1
    const along = Math.max(0, Math.min(1, ((x - start[0]) * ex + (z - start[1]) * ez) / lengthSquared))
    let ax = x - (start[0] + ex * along)
    let az = z - (start[1] + ez * along)
    const length = Math.hypot(ax, az)
    if (length < 0.05) return null
    ax /= length
    az /= length
    for (let shift = SHIFT_STEP; shift <= MAX_SHIFT; shift += SHIFT_STEP) {
      if (isClear(x + ax * shift, z + az * shift)) {
        this.report.mappedMovedBehindFootpath++
        return [x + ax * shift, z + az * shift]
      }
    }
    return null
  }

  /**
   * OSM's mapped walls and fences of one kind: pieces joined, gaps closed, kept off the road
   * and footpath, and left out where a loop already runs.
   */
  mapped(lines: GroundPoint[][], kind: FenceKind, variation: number, onRoadEdge: boolean): FenceRun[] {
    this.report.mappedPieces += lines.length
    const joined = onRoadEdge ? lines : joinPieces(lines)
    this.report.mappedLines += joined.length
    const runs: FenceRun[] = []
    for (const points of joined) {
      let line = points
      const [sx, sz] = line[0]
      const [ex, ez] = line[line.length - 1]
      const gap = Math.hypot(ex - sx, ez - sz)
      if (!onRoadEdge && gap > 0.1 && gap < CLOSE_GAP && lineLength(line) > CLOSE_MIN_LENGTH) {
        line = [...line, line[0]]
        this.report.mappedGapsClosed++
      }
      const fits = ([x, z]: GroundPoint) =>
        !isInsideBounds(x, z, 2) ? false : onRoadEdge ? nearestRoadEdge(this.roads, x, z, 1) > -0.2 : isClear(x, z)
      // Boundary walls on the footpath move back behind it, away from the road, so the line stays whole.
      const placed = onRoadEdge ? line : line.flatMap((point, i) => (i + 1 < line.length ? cutIntoPanels([point, line[i + 1]], PANEL[kind]).map(([from]) => from) : [point]))
      const moved = onRoadEdge ? placed : placed.map((point) => this.awayFromRoad(point))
      const panels: Panel[] = []
      for (const [from, to] of onRoadEdge ? cutIntoPanels(line, PANEL[kind]) : pairs(moved)) {
        if (!from || !to) {
          this.report.mappedPanelsOnRoad++
          continue
        }
        if (!isInsideBounds(from[0], from[1], 2) || !isInsideBounds(to[0], to[1], 2)) {
          this.report.mappedOutsidePlayArea++
          continue
        }
        const middle: GroundPoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
        if (!onRoadEdge && this.built.hasWithin(middle[0], middle[1], SAME_BOUNDARY)) {
          this.report.mappedDuplicates++
          continue
        }
        if (!fits(from) || !fits(middle) || !fits(to)) {
          if (!onRoadEdge) this.report.mappedPanelsOnRoad++
          continue
        }
        if (!onRoadEdge && isNearBuilding(this.collisions, middle[0], middle[1], thickness(kind) / 2 + 0.05)) {
          this.report.againstBuildings++
          continue
        }
        panels.push([from, to])
      }
      runs.push(...joinPanels(panels, kind, variation, this.collisions))
    }
    return runs
  }
}

/** Each point and the next. */
function pairs<T>(points: T[]): [T, T][] {
  return points.slice(1).map((point, i) => [points[i], point])
}

function lineLength(points: GroundPoint[]): number {
  let total = 0
  for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
  return total
}

/** Cuts a line into panels about `size` long. */
function cutIntoPanels(points: GroundPoint[], size: number): Panel[] {
  const panels: Panel[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [startX, startZ] = points[i]
    const [endX, endZ] = points[i + 1]
    const length = Math.hypot(endX - startX, endZ - startZ)
    if (length < 0.3) continue
    const count = Math.max(1, Math.round(length / size))
    const at = (part: number): GroundPoint => [startX + ((endX - startX) * part) / count, startZ + ((endZ - startZ) * part) / count]
    for (let part = 0; part < count; part++) panels.push([at(part), at(part + 1)])
  }
  return panels
}

/** Joins line pieces whose ends meet into longer lines, either way round. */
function joinPieces(lines: GroundPoint[][]): GroundPoint[][] {
  const near = (a: GroundPoint, b: GroundPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]) < JOIN
  const left = lines.filter((line) => line.length >= 2).map((line) => [...line])
  const out: GroundPoint[][] = []
  while (left.length) {
    let line = left.pop()!
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        const other = left[i]
        const end = line[line.length - 1]
        const start = line[0]
        if (near(end, other[0])) line = [...line, ...other.slice(1)]
        else if (near(end, other[other.length - 1])) line = [...line, ...[...other].reverse().slice(1)]
        else if (near(start, other[other.length - 1])) line = [...other, ...line.slice(1)]
        else if (near(start, other[0])) line = [...[...other].reverse(), ...line.slice(1)]
        else continue
        left.splice(i, 1)
        grew = true
        break
      }
    }
    out.push(line)
  }
  return out
}

/** A mapped barrier's line in world coordinates. */
export const barrierLine = (barrier: LineFeature): GroundPoint[] =>
  barrier.geometry.coordinates.map((position): GroundPoint => {
    const [x, , z] = lonLatToWorld(position)
    return [x, z]
  })
