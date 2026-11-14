import * as THREE from 'three'
import { chunkKey } from './chunks'
import { addWall, isNearBuilding, type CollisionWorld } from './collision'
import type { MapData } from './mapData'
import { createRandom, indexRoadPieces, isClearOfRoads, toRoadPieces } from './props'
import { PAVEMENT_WIDTH } from './surface'
import { isInsideBounds, isInsideOutline, lonLatToWorld, type GroundPoint } from './worldUtils'

/**
 * Buildings going up on open plots, as HSR always has a few: a bare concrete
 * frame of columns and slabs, rebar sticking out of the top, brick walls going
 * in on the lower floors, bamboo scaffolding and green shade net on the front,
 * and sand, bricks and a tarp in the yard.
 */

/** A site: its middle, which way its front faces (towards the road), and its size. */
export type ConstructionSite = {
  x: number
  z: number
  /** The way out of the front, towards the road, in radians around Y. */
  rotation: number
  /** Along the road, and back from it, in metres. */
  width: number
  depth: number
  floors: number
  seed: number
}

const PLOT = { width: 9.5, depth: 13 }
/** Plots found beside roads are this far apart at least, in metres, and tried this often along a road. */
const SITE_SPACING = 300
const TRY_EVERY = 22
const TRY_CHANCE = 0.25
/** Room left between a plot and the road's pavement, and around it, in metres. */
const SETBACK = 1.2
const CLEARANCE = 1.2
/** Only on these roads: building plots are on side streets, not on main roads. */
const PLOT_ROADS = new Set(['residential'])
/** Solid walls round each site, standing in for the hoarding and the frame. */
const SITE_WALL = 0.4

/** Where the plot's corners are, given its middle, the way out of its front, and its size. */
function plotCorners({ x, z, rotation, width, depth }: Omit<ConstructionSite, 'floors' | 'seed'>): GroundPoint[] {
  const outX = Math.sin(rotation)
  const outZ = Math.cos(rotation)
  // Along the front: a quarter turn from out.
  const alongX = outZ
  const alongZ = -outX
  const corner = (along: number, out: number): GroundPoint => [
    x + alongX * along * (width / 2) + outX * out * (depth / 2),
    z + alongZ * along * (width / 2) + outZ * out * (depth / 2),
  ]
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
}

/**
 * Finds plots for building sites: in the areas the map marks as construction,
 * and now and then on empty ground beside a residential road. A plot must be
 * clear of buildings, walls, roads, parks and military land. The sites are
 * made solid as they're chosen, so it runs before trees and lamps go in.
 */
export function findConstructionSites(data: MapData, collisions: CollisionWorld): ConstructionSite[] {
  const random = createRandom(20261114)
  const pieces = toRoadPieces(data.roads)
  const roadIndex = indexRoadPieces(pieces)
  const toOutline = (ring: [number, number][]) =>
    ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
  // Each with its box, so most can be ruled out at a glance.
  const keepOut = [...data.parks, ...data.restricted].map((area) => {
    const outline = toOutline(area.geometry.coordinates[0])
    const xs = outline.map(([x]) => x)
    const zs = outline.map(([, z]) => z)
    return { outline, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] }
  })
  const isKeptOut = (x: number, z: number) =>
    keepOut.some(({ outline, box: [minX, maxX, minZ, maxZ] }) => x >= minX && x <= maxX && z >= minZ && z <= maxZ && isInsideOutline(outline, x, z))
  const sites: ConstructionSite[] = []

  const fits = (site: Omit<ConstructionSite, 'floors' | 'seed'>) => {
    // The quick check first: most tries are too near a site already chosen.
    if (sites.some((other) => Math.hypot(other.x - site.x, other.z - site.z) < SITE_SPACING)) return false
    const outX = Math.sin(site.rotation)
    const outZ = Math.cos(site.rotation)
    for (const across of [-0.5, 0, 0.5]) {
      for (const back of [-0.5, -0.17, 0.17, 0.5]) {
        const x = site.x + outZ * across * site.width + outX * back * site.depth
        const z = site.z - outX * across * site.width + outZ * back * site.depth
        if (!isInsideBounds(x, z, 10)) return false
        if (isNearBuilding(collisions, x, z, CLEARANCE)) return false
        if (!isClearOfRoads(roadIndex, x, z, PAVEMENT_WIDTH + 0.3)) return false
        if (isKeptOut(x, z)) return false
      }
    }
    return true
  }

  const add = (site: Omit<ConstructionSite, 'floors' | 'seed'>) => {
    const seed = Math.floor(random() * 1e9)
    sites.push({ ...site, floors: 2 + (seed % 3), seed })
    const corners = plotCorners(site)
    corners.forEach((corner, index) => addWall(collisions, corner, corners[(index + 1) % 4], SITE_WALL))
  }

  // ---- The map's own construction areas ----
  for (const area of data.areas) {
    if (area.properties.landuse !== 'construction') continue
    const outline = toOutline(area.geometry.coordinates[0])
    const x = outline.reduce((sum, [px]) => sum + px, 0) / outline.length
    const z = outline.reduce((sum, [, pz]) => sum + pz, 0) / outline.length
    // Square to the outline's longest side.
    let longest = 0
    let rotation = 0
    outline.forEach(([ax, az], index) => {
      const [bx, bz] = outline[(index + 1) % outline.length]
      const length = Math.hypot(bx - ax, bz - az)
      if (length > longest) {
        longest = length
        rotation = Math.atan2(-(bz - az), bx - ax)
      }
    })
    const site = { x, z, rotation, ...PLOT }
    if (isInsideOutline(outline, x, z) && fits(site)) add(site)
  }

  // ---- Empty plots beside residential roads ----
  for (const piece of pieces) {
    if (!PLOT_ROADS.has(data.roads[piece.road].properties.highway ?? '')) continue
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    const alongX = (piece.end[0] - piece.start[0]) / length
    const alongZ = (piece.end[1] - piece.start[1]) / length
    for (let along = TRY_EVERY / 2; along < length - TRY_EVERY / 2; along += TRY_EVERY) {
      if (random() > TRY_CHANCE) continue
      const side = random() < 0.5 ? 1 : -1
      const outX = alongZ * side
      const outZ = -alongX * side
      const back = piece.width / 2 + PAVEMENT_WIDTH + SETBACK + PLOT.depth / 2
      const x = piece.start[0] + alongX * along + outX * back
      const z = piece.start[1] + alongZ * along + outZ * back
      // The front faces back towards the road.
      const site = { x, z, rotation: Math.atan2(-outX, -outZ), ...PLOT }
      if (fits(site)) add(site)
    }
  }

  return sites
}

// ---------------------------------------------------------------- Shapes

const COLORS = {
  concrete: new THREE.Color('#a39f97'),
  slabEdge: new THREE.Color('#8e8a82'),
  brick: new THREE.Color('#a4573a'),
  rebar: new THREE.Color('#5a3a2a'),
  bamboo: new THREE.Color('#9b7c4c'),
  sand: new THREE.Color('#c8a46e'),
  tarp: new THREE.Color('#2c63b8'),
  board: new THREE.Color('#e9e3d2'),
  boardPost: new THREE.Color('#3b3d40'),
  cement: new THREE.Color('#d7d2c4'),
}
const FLOOR_HEIGHT = 3.1
const SLAB = 0.18
const COLUMN = 0.32
const COLUMN_SPACING = 3.6
const REBAR = { length: 0.9, size: 0.03 }
const NET_COLOR = '#2f6a3c'

type Shapes = { positions: number[]; normals: number[]; colors: number[] }

/** A box in a site's own frame: `along` across the front, `back` into the plot, `up` from the ground. */
function pushBox(
  shapes: Shapes,
  site: ConstructionSite,
  [alongFrom, alongTo]: [number, number],
  [backFrom, backTo]: [number, number],
  [low, high]: [number, number],
  color: THREE.Color,
  shade = 1,
) {
  const outX = Math.sin(site.rotation)
  const outZ = Math.cos(site.rotation)
  const alongX = outZ
  const alongZ = -outX
  // Back is into the plot, away from the road.
  const point = (along: number, back: number, y: number) =>
    new THREE.Vector3(site.x + alongX * along - outX * back, y, site.z + alongZ * along - outZ * back)
  const face = (corners: THREE.Vector3[], normal: THREE.Vector3, tone: number) => {
    const [a, b, c, d] = corners
    const facing = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).dot(normal)
    for (const p of facing >= 0 ? [a, b, c, a, c, d] : [a, d, c, a, c, b]) {
      shapes.positions.push(p.x, p.y, p.z)
      shapes.normals.push(normal.x, normal.y, normal.z)
      shapes.colors.push(color.r * tone * shade, color.g * tone * shade, color.b * tone * shade)
    }
  }
  const p = (a: 0 | 1, b: 0 | 1, h: 0 | 1) =>
    point(a ? alongTo : alongFrom, b ? backTo : backFrom, h ? high : low)
  const front = new THREE.Vector3(outX, 0, outZ)
  const side = new THREE.Vector3(alongX, 0, alongZ)
  const up = new THREE.Vector3(0, 1, 0)
  face([p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], front, 0.9)
  face([p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1)], front.clone().negate(), 0.8)
  face([p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)], side, 0.85)
  face([p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], side.clone().negate(), 0.85)
  face([p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)], up, 1)
  if (low > 0.01) face([p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0)], up.clone().negate(), 0.7)
}

/** A flat panel facing the road, for the shade net, from `along` to `along`, `back` metres in. */
function pushPanel(
  positions: number[],
  normals: number[],
  site: ConstructionSite,
  [alongFrom, alongTo]: [number, number],
  back: number,
  [low, high]: [number, number],
) {
  const outX = Math.sin(site.rotation)
  const outZ = Math.cos(site.rotation)
  const point = (along: number, y: number) => [site.x + outZ * along - outX * back, y, site.z - outX * along - outZ * back]
  const corners = [point(alongFrom, low), point(alongTo, low), point(alongTo, high), point(alongFrom, high)]
  for (const index of [0, 1, 2, 0, 2, 3]) {
    positions.push(...corners[index])
    normals.push(outX, 0, outZ)
  }
}

function buildSite(shapes: Shapes, nets: { positions: number[]; normals: number[] }, site: ConstructionSite) {
  const random = createRandom(site.seed)
  const halfWidth = site.width / 2 - 0.6
  const frontBack = 1.2
  const rearBack = site.depth - 1
  const box = (along: [number, number], back: [number, number], height: [number, number], color: THREE.Color, shade = 1) =>
    pushBox(shapes, site, along, [back[0] - site.depth / 2, back[1] - site.depth / 2], height, color, shade)

  const columnsAlong: number[] = []
  const across = Math.max(1, Math.round((halfWidth * 2) / COLUMN_SPACING))
  for (let i = 0; i <= across; i++) columnsAlong.push(-halfWidth + (i / across) * halfWidth * 2)
  const columnsBack: number[] = []
  const deep = Math.max(1, Math.round((rearBack - frontBack) / COLUMN_SPACING))
  for (let i = 0; i <= deep; i++) columnsBack.push(frontBack + (i / deep) * (rearBack - frontBack))

  const top = site.floors * FLOOR_HEIGHT
  // The top floor's columns are cast, but its slab isn't, so their rebar shows.
  for (const along of columnsAlong) {
    for (const back of columnsBack) {
      box([along - COLUMN / 2, along + COLUMN / 2], [back - COLUMN / 2, back + COLUMN / 2], [0, top], COLORS.concrete)
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const rx = along + dx * 0.09
        const rz = back + dz * 0.09
        box([rx - REBAR.size, rx + REBAR.size], [rz - REBAR.size, rz + REBAR.size], [top, top + REBAR.length], COLORS.rebar)
      }
    }
  }

  const slabFrom: [number, number] = [-halfWidth - 0.35, halfWidth + 0.35]
  const slabBack: [number, number] = [frontBack - 0.35, rearBack + 0.35]
  for (let floor = 1; floor < site.floors; floor++) {
    const level = floor * FLOOR_HEIGHT
    box(slabFrom, slabBack, [level - SLAB, level], COLORS.slabEdge)
  }

  // Brick walls going in on the lower floors: the back and sides, and part of the front.
  const bricked = Math.max(1, site.floors - 2)
  for (let floor = 0; floor < bricked; floor++) {
    const low = floor * FLOOR_HEIGHT
    const high = (floor + 1) * FLOOR_HEIGHT - SLAB
    const wall = 0.2
    box([-halfWidth, halfWidth], [rearBack - wall / 2, rearBack + wall / 2], [low, high], COLORS.brick)
    box([-halfWidth - wall / 2, -halfWidth + wall / 2], [frontBack, rearBack], [low, high], COLORS.brick)
    box([halfWidth - wall / 2, halfWidth + wall / 2], [frontBack, rearBack], [low, high], COLORS.brick)
    if (floor > 0) box([-halfWidth, -halfWidth / 3], [frontBack - wall / 2, frontBack + wall / 2], [low, low + 1], COLORS.brick)
  }

  // Bamboo scaffolding across the front, poles and ledgers, lashed a little out from the frame.
  const scaffold = frontBack - 0.9
  const pole = 0.05
  for (let at = -halfWidth - 0.4; at <= halfWidth + 0.45; at += 1.6) {
    box([at - pole, at + pole], [scaffold - pole, scaffold + pole], [0, top + 0.8], COLORS.bamboo, 0.9 + random() * 0.2)
  }
  for (let level = 1.6; level < top + 0.6; level += 1.6) {
    box([-halfWidth - 0.45, halfWidth + 0.45], [scaffold - pole, scaffold + pole], [level - pole, level + pole], COLORS.bamboo)
  }

  // Green shade net hung on the scaffolding, over the upper floors.
  const netFrom = random() < 0.5 ? -halfWidth - 0.4 : 0
  pushPanel(nets.positions, nets.normals, site, [netFrom, netFrom + halfWidth + 0.4], scaffold - 0.1 - site.depth / 2, [FLOOR_HEIGHT, top + 0.6])

  // The yard: sand, a stack of bricks, cement bags under a blue tarp, and the builder's board.
  const yard = (frontBack - 0.4) / 2
  const sandAt = halfWidth * (random() < 0.5 ? -0.55 : 0.55)
  box([sandAt - 0.9, sandAt + 0.9], [yard - 0.25, yard + 0.25], [0, 0.45], COLORS.sand)
  box([sandAt - 0.6, sandAt + 0.6], [yard - 0.15, yard + 0.15], [0.45, 0.75], COLORS.sand, 1.05)
  const bricksAt = -sandAt * 0.6
  box([bricksAt - 0.6, bricksAt + 0.6], [yard - 0.2, yard + 0.2], [0, 0.7], COLORS.brick, 0.95)
  box([bricksAt + 0.9, bricksAt + 1.6], [yard - 0.25, yard + 0.25], [0, 0.35], COLORS.cement)
  box([bricksAt + 0.85, bricksAt + 1.65], [yard - 0.3, yard + 0.3], [0.35, 0.4], COLORS.tarp)
  // A painted board on two posts at the front corner: who's building, which the eye reads as a sign.
  const boardAt = halfWidth - 0.4
  box([boardAt - 0.05, boardAt + 0.05], [-0.1, 0], [0, 2.4], COLORS.boardPost)
  box([boardAt - 1.65, boardAt - 1.55], [-0.1, 0], [0, 2.4], COLORS.boardPost)
  box([boardAt - 1.7, boardAt + 0.1], [-0.08, -0.02], [1.4, 2.35], COLORS.board)
}

export type SiteShapes = { solid: THREE.BufferGeometry[]; nets: THREE.BufferGeometry[] }

/** Every site's shapes, one geometry per map square, with the shade nets apart as they're see-through. */
export function createSiteShapes(sites: ConstructionSite[]): SiteShapes {
  const solid = new Map<number, Shapes>()
  const nets = new Map<number, { positions: number[]; normals: number[] }>()
  for (const site of sites) {
    const key = chunkKey(site.x, site.z)
    if (!solid.has(key)) solid.set(key, { positions: [], normals: [], colors: [] })
    if (!nets.has(key)) nets.set(key, { positions: [], normals: [] })
    buildSite(solid.get(key) as Shapes, nets.get(key) as { positions: number[]; normals: number[] }, site)
  }
  const toGeometry = (attributes: Partial<Shapes>) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(attributes.positions ?? [], 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(attributes.normals ?? [], 3))
    if (attributes.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(attributes.colors, 3))
    geometry.computeBoundingSphere()
    return geometry
  }
  return { solid: [...solid.values()].map(toGeometry), nets: [...nets.values()].map(toGeometry) }
}

export const SHADE_NET_COLOR = NET_COLOR
