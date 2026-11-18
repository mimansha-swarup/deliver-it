import { addPost, addWall, isNearBuilding, type CollisionWorld } from './collision'
import type { MapData } from './mapData'
import { nearestRoadPiece, PointGrid, type Prop, type RoadIndex } from './props'
import { streetPresetOf } from './streetPresets'
import { Surface, SurfaceMap } from './surfaceMap'
import { isInsideBounds, lonLatToWorld, PLAY_AREA, type GroundPoint } from './worldUtils'

/*
 * Landmarks to steer by, a couple of blocks apart (ART_DIRECTION.md: HSR as a rider knows it):
 *
 * - Agara Lake: OSM has the lake's park, a kilometre across, but not its water. The water fills
 *   the park more than `LAKE_SHORE` in from its edge, leaving a ring of park, the walking path,
 *   round it. It goes on the surface map as water, where nothing is placed.
 * - The metro viaduct along Hosur Road, on pillars down the median between its carriageways.
 * - Bus shelters on main roads' footpaths, every few hundred metres, every third one a big one.
 * - The BDA Complex's name board, facing the road from its compound.
 *
 * Temples and petrol bunks are landmarks already (worship.ts, fuelStationData.ts); the
 * roadside shrines and bunks on long gaps come a little more often now (infillPlots.ts).
 */

export type Landmarks = {
  /** The lake's water, as rows of cells on the surface map: [z row, first column, last column]. */
  lake: [number, number, number][]
  pillars: Prop[]
  /** Viaduct spans between neighbouring pillars. */
  spans: { from: GroundPoint; to: GroundPoint }[]
  shelters: Prop[]
  bigShelters: Prop[]
  /** A big name board: where it stands, which way it faces, and what it says. */
  boards: { x: number; z: number; rotation: number; lines: string[] }[]
  report: Record<string, number>
}

const LAKE_PARK = 'Agara Lake Park'
const LAKE_SHORE = 30
const METRO_ROAD = 'Hosur Road'
const PILLAR_EVERY = 32
/** The viaduct joins pillars no further apart than this, in metres. */
const SPAN_MAX = 46
const SHELTER_EVERY = 520
const SHELTER_LENGTH = 6
const BIG_SHELTER_LENGTH = 12
const BDA_AREA = 'HSR Layout BDA Complex'

const toGround = (position: [number, number]): GroundPoint => {
  const [x, , z] = lonLatToWorld(position)
  return [x, z]
}

/** The lake: park cells further than LAKE_SHORE from the park's edge, by a two-pass distance on the grid. */
function planLake(data: MapData, surface: SurfaceMap): [number, number, number][] {
  const park = data.parks.find((feature) => feature.properties.name === LAKE_PARK)
  if (!park) return []
  const outline = park.geometry.coordinates[0].map(toGround)
  const xs = outline.map(([x]) => x)
  const zs = outline.map(([, z]) => z)
  const left = Math.max(0, Math.floor(Math.min(...xs) - PLAY_AREA.minX) - 2)
  const right = Math.min(surface.width - 1, Math.ceil(Math.max(...xs) - PLAY_AREA.minX) + 2)
  const top = Math.max(0, Math.floor(Math.min(...zs) - PLAY_AREA.minZ) - 2)
  const bottom = Math.min(surface.depth - 1, Math.ceil(Math.max(...zs) - PLAY_AREA.minZ) + 2)
  const width = right - left + 1
  const depth = bottom - top + 1
  // Inside the park outline: a scratch map of just this park.
  const scratch = new SurfaceMap()
  scratch.fillPolygon(outline, Surface.Park)
  const distance = new Float32Array(width * depth)
  const inside = (column: number, row: number) => scratch.cells[(row + top) * surface.width + column + left] === Surface.Park
  for (let row = 0; row < depth; row++) for (let column = 0; column < width; column++) distance[row * width + column] = inside(column, row) ? 1e6 : 0
  const pass = (rows: number[], columns: number[], steps: [number, number, number][]) => {
    for (const row of rows) {
      for (const column of columns) {
        const at = row * width + column
        if (distance[at] === 0) continue
        for (const [dr, dc, cost] of steps) {
          const r = row + dr
          const c = column + dc
          if (r < 0 || c < 0 || r >= depth || c >= width) continue
          distance[at] = Math.min(distance[at], distance[r * width + c] + cost)
        }
      }
    }
  }
  const range = (n: number) => Array.from({ length: n }, (_, i) => i)
  pass(range(depth), range(width), [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [-1, 1, 1.414]])
  pass(range(depth).reverse(), range(width).reverse(), [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [1, -1, 1.414]])

  // Water where it's deep inside the park and the ground is still park (not a road or a building).
  const rows: [number, number, number][] = []
  for (let row = 0; row < depth; row++) {
    let start = -1
    for (let column = 0; column <= width; column++) {
      const index = (row + top) * surface.width + column + left
      const water = column < width && distance[row * width + column] > LAKE_SHORE && surface.cells[index] === Surface.Park
      if (water) {
        surface.cells[index] = Surface.Water
        if (start < 0) start = column
      } else if (start >= 0) {
        rows.push([row + top, start + left, column - 1 + left])
        start = -1
      }
    }
  }
  return rows
}

export function placeLandmarks({ data, surface, roads, collisions }: { data: MapData; surface: SurfaceMap; roads: RoadIndex; collisions: CollisionWorld }): Landmarks {
  const landmarks: Landmarks = { lake: planLake(data, surface), pillars: [], spans: [], shelters: [], bigShelters: [], boards: [], report: {} }
  landmarks.report.lakeCells = landmarks.lake.reduce((sum, [, from, to]) => sum + to - from + 1, 0)

  // ---- The metro viaduct: pillars in the median between Hosur Road's two carriageways ----
  const pillarGrid = new PointGrid(16)
  for (const piece of roads.pieces) {
    if (data.roads[piece.road].properties.name !== METRO_ROAD) continue
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length < 1) continue
    const alongX = (piece.end[0] - piece.start[0]) / length
    const alongZ = (piece.end[1] - piece.start[1]) / length
    for (let along = PILLAR_EVERY / 2; along < length; along += PILLAR_EVERY) {
      for (const side of [1, -1]) {
        // Out from this carriageway's edge: the median's cells, and its middle.
        let first = -1
        let last = -1
        for (let out = piece.width / 2 + 0.5; out < piece.width / 2 + 14; out += 0.5) {
          const x = piece.start[0] + alongX * along + alongZ * out * side
          const z = piece.start[1] + alongZ * along - alongX * out * side
          const ground = surface.at(x, z)
          if (ground === Surface.Median) {
            if (first < 0) first = out
            last = out
          } else if (first >= 0) break
        }
        if (first < 0 || last - first < 1.2) continue
        const middle = (first + last) / 2
        const x = piece.start[0] + alongX * along + alongZ * middle * side
        const z = piece.start[1] + alongZ * along - alongX * middle * side
        if (!isInsideBounds(x, z, 10) || pillarGrid.hasWithin(x, z, PILLAR_EVERY * 0.6)) continue
        pillarGrid.add(x, z)
        landmarks.pillars.push({ x, z, rotation: Math.atan2(alongX, alongZ), variation: 0 })
        addPost(collisions, x, z, 0.9)
      }
    }
  }
  // Spans: each pillar to its nearest neighbours ahead, at most two, none crossing back.
  const seen = new Set<string>()
  landmarks.pillars.forEach((pillar, i) => {
    const near = landmarks.pillars
      .map((other, j) => ({ j, distance: Math.hypot(other.x - pillar.x, other.z - pillar.z) }))
      .filter(({ j, distance }) => j !== i && distance < SPAN_MAX)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key)
      landmarks.spans.push({ from: [pillar.x, pillar.z], to: [landmarks.pillars[j].x, landmarks.pillars[j].z] })
    }
  })
  landmarks.report.metroPillars = landmarks.pillars.length
  landmarks.report.metroSpans = landmarks.spans.length

  // ---- Bus shelters on main roads' footpaths ----
  const shelterGrid = new PointGrid(64)
  let due = SHELTER_EVERY / 2
  let count = 0
  for (const piece of roads.pieces) {
    const preset = streetPresetOf(data.roads[piece.road])
    if (preset?.name !== 'main' || preset.footpath < 2.6) continue
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length < 16) continue
    const alongX = (piece.end[0] - piece.start[0]) / length
    const alongZ = (piece.end[1] - piece.start[1]) / length
    for (let along = 8; along < length - 8; along += 4) {
      due -= 4
      if (due > 0) continue
      const big = count % 3 === 2
      const half = (big ? BIG_SHELTER_LENGTH : SHELTER_LENGTH) / 2
      const side = count % 2 === 0 ? 1 : -1
      const out = piece.width / 2 + preset.footpath * 0.62
      const at = (s: number): GroundPoint => [piece.start[0] + alongX * (along + s) + alongZ * out * side, piece.start[1] + alongZ * (along + s) - alongX * out * side]
      const [x, z] = at(0)
      const clear =
        [-half, -half / 2, 0, half / 2, half].every((s) => {
          const [px, pz] = at(s)
          return surface.at(px, pz) === Surface.Footpath && !isNearBuilding(collisions, px, pz, 0.4)
        }) && !shelterGrid.hasWithin(x, z, SHELTER_EVERY * 0.5)
      if (!clear) continue
      shelterGrid.add(x, z)
      // Its open front faces the road.
      const rotation = Math.atan2(-alongZ * side, alongX * side)
      ;(big ? landmarks.bigShelters : landmarks.shelters).push({ x, z, rotation, variation: (count % 7) / 7 })
      // Solid along its back panel and its front posts, so trees and lamps keep out of it.
      const [ax, az] = at(-half)
      const [bx, bz] = at(half)
      for (const depth of [-0.8, 0.65]) {
        const dx = Math.sin(rotation) * depth
        const dz = Math.cos(rotation) * depth
        addWall(collisions, [ax + dx, az + dz], [bx + dx, bz + dz], 0.15)
      }
      count++
      due = SHELTER_EVERY
    }
  }
  landmarks.report.busShelters = landmarks.shelters.length
  landmarks.report.bigBusShelters = landmarks.bigShelters.length

  // ---- The BDA Complex's name board, at the compound's edge nearest a road ----
  const bda = data.areas.find((area) => area.properties.name === BDA_AREA)
  if (bda) {
    const outline = bda.geometry.coordinates[0].map(toGround)
    let best: { x: number; z: number; edge: number; rotation: number } | null = null
    for (const [x, z] of outline) {
      const near = nearestRoadPiece(roads, x, z, 60)
      if (!near || (best && near.edge >= best.edge)) continue
      const { start, end } = near.piece
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
      const t = Math.max(0, Math.min(length, ((x - start[0]) * (end[0] - start[0]) + (z - start[1]) * (end[1] - start[1])) / length))
      const roadX = start[0] + ((end[0] - start[0]) * t) / length
      const roadZ = start[1] + ((end[1] - start[1]) * t) / length
      best = { x, z, edge: near.edge, rotation: Math.atan2(roadX - x, roadZ - z) }
    }
    if (best) {
      // A little inside the compound from that corner, facing the road.
      const inX = -Math.sin(best.rotation) * 2.5
      const inZ = -Math.cos(best.rotation) * 2.5
      landmarks.boards.push({ x: best.x + inX, z: best.z + inZ, rotation: best.rotation, lines: ['ಬಿಡಿಎ ಸಂಕೀರ್ಣ', 'BDA COMPLEX', 'HSR Layout'] })
      addPost(collisions, best.x + inX, best.z + inZ, 0.5)
    }
  }
  landmarks.report.boards = landmarks.boards.length
  return landmarks
}
