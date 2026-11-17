import * as THREE from 'three'
import { chunkKey } from './chunks'
import type { Gate } from './houseKit'
import type { LineFeature } from './mapData'
import { createRandom, distanceToPiece, forEachRoadNear, nearestRoadEdge, nearestRoadPiece, type Prop, type RoadIndex, type RoadPiece } from './props'
import { DECAL_COLUMNS, DECAL_ROWS, FOOTPATH_TOP, KERB_TOP, STREET, usesNewGround } from './streetEdgeConfig'
import { STREET_PRESETS, streetPresetOf, streetRandom, WIDEST_FOOTPATH, type StreetPreset } from './streetPresets'
import { ROAD_HEIGHT } from './surface'
import type { GroundPoint } from './worldUtils'

/*
 * The edges of the street, built from the OSM road lines: kerbs, junction
 * corners, raised footpaths, edge stones, dust on the soil, tree pits and marks
 * on the asphalt. See ART_DIRECTION.md. Everything is collected per map square,
 * one geometry per layer per square, so a square is drawn or skipped as a unit.
 */

type Vec = [number, number]

const add = (a: Vec, b: Vec, scale = 1): Vec => [a[0] + b[0] * scale, a[1] + b[1] * scale]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]]
const length = (a: Vec) => Math.hypot(a[0], a[1])
/** A quarter turn anticlockwise, seen from above with x east and z south... as angles are measured here. */
const left = (a: Vec): Vec => [-a[1], a[0]]
const right = (a: Vec): Vec => [a[1], -a[0]]

/** Where `origin1 + t·dir1` meets `origin2 + s·dir2`, as t, or null if they're parallel. */
function meet(origin1: Vec, dir1: Vec, origin2: Vec, dir2: Vec): number | null {
  const determinant = dir1[0] * -dir2[1] - -dir2[0] * dir1[1]
  if (Math.abs(determinant) < 1e-6) return null
  const [rx, rz] = sub(origin2, origin1)
  return (rx * -dir2[1] - -dir2[0] * rz) / determinant
}

function isInside(polygon: Vec[], [x, z]: Vec): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]
    const [xj, zj] = polygon[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// ---------------------------------------------------------------------------
// Geometry collected per map square, with any attributes a layer needs.

class Layer {
  private readonly squares = new Map<number, number[][]>()
  private readonly names: string[]
  private readonly sizes: number[]

  constructor(attributes: Record<string, number>) {
    this.names = Object.keys(attributes)
    this.sizes = Object.values(attributes)
  }

  /** The arrays, one per attribute, for the map square a point is in. */
  at([x, z]: Vec): number[][] {
    const key = chunkKey(x, z)
    let arrays = this.squares.get(key)
    if (!arrays) {
      arrays = this.names.map(() => [])
      this.squares.set(key, arrays)
    }
    return arrays
  }

  toGeometries(): THREE.BufferGeometry[] {
    return [...this.squares.values()].map((arrays) => {
      const geometry = new THREE.BufferGeometry()
      this.names.forEach((name, i) => geometry.setAttribute(name, new THREE.Float32BufferAttribute(arrays[i], this.sizes[i])))
      geometry.computeBoundingSphere()
      return geometry
    })
  }
}

/** Adds one corner: each argument is that attribute's values, in the layer's order. */
function corner(arrays: number[][], ...values: number[][]) {
  for (let i = 0; i < values.length; i++) {
    const target = arrays[i]
    for (const value of values[i]) target.push(value)
  }
}

const UP = [0, 1, 0]

// ---------------------------------------------------------------------------
// Junction corners

/**
 * A rounded junction corner between two roads, `a` and the next road `b`
 * anticlockwise from it. The road edges are joined by an arc of the corner
 * radius around `centre`, from `tangentA` to `tangentB`. The asphalt fills the
 * web between the arc and the edges' corner `point`, and the footpath fills the
 * rest of the corner, out to `outer`, where the two footpaths' far edges meet.
 */
export type Corner = {
  centre: Vec
  radius: number
  tangentA: Vec
  tangentB: Vec
  /** Where the two road edges would meet, without the rounding. */
  point: Vec
  /** The far corner of the footpath, and the footpaths' far ends either side. */
  outer: Vec
  outerA: Vec
  outerB: Vec
  /** The arc, as angles around `centre`. */
  startAngle: number
  sweep: number
  /** Straight kerbs and footpaths stop where they reach this. */
  zone: Vec[]
  /** The web of asphalt between the arc and `point`. */
  web: Vec[]
  /** Whether each side's road has the new ground; an old road's footpath needs a step down. */
  newA: boolean
  newB: boolean
  /** The kerb round the corner: the wider of the two roads' kerbs, painted if either is. */
  kerbWidth: number
  painted: boolean
}

type Arm = { dir: Vec; half: number; length: number; road: number }

/** A road's preset, or the residential one for a road without (which only meets the new ground at a corner). */
function presetFor(road: LineFeature): StreetPreset {
  return streetPresetOf(road) ?? STREET_PRESETS.residential
}

/** Corners narrower or wider than these, in radians, aren't rounded. */
const MIN_CORNER = (45 * Math.PI) / 180
const MAX_CORNER = (150 * Math.PI) / 180

function arcPoint(corner: Corner, part: number): Vec {
  const angle = corner.startAngle + corner.sweep * part
  return [corner.centre[0] + Math.cos(angle) * corner.radius, corner.centre[1] + Math.sin(angle) * corner.radius]
}

function arcSteps(corner: Corner): number {
  return Math.max(4, Math.ceil((Math.abs(corner.sweep) * corner.radius) / 0.6))
}

function makeCorner(node: Vec, a: Arm, b: Arm, radius: number, roads: LineFeature[], index: RoadIndex): Corner | null {
  const sideA = left(a.dir)
  const sideB = right(b.dir)
  const presetA = presetFor(roads[a.road])
  const presetB = presetFor(roads[b.road])
  const footA = presetA.footpath
  const footB = presetB.footpath
  const kerbWidth = Math.max(presetA.kerb.width, presetB.kerb.width)
  // The corner's centre sits `radius` beyond both road edges.
  const t = meet(add(node, sideA, a.half + radius), a.dir, add(node, sideB, b.half + radius), b.dir)
  const s = meet(add(node, sideB, b.half + radius), b.dir, add(node, sideA, a.half + radius), a.dir)
  if (t === null || s === null || t <= 0 || s <= 0 || t > a.length - 0.3 || s > b.length - 0.3) return null

  const centre = add(add(node, sideA, a.half + radius), a.dir, t)
  const tangentA = add(add(node, sideA, a.half), a.dir, t)
  const tangentB = add(add(node, sideB, b.half), b.dir, s)
  const pointT = meet(add(node, sideA, a.half), a.dir, add(node, sideB, b.half), b.dir)
  const outerT = meet(add(node, sideA, a.half + footA), a.dir, add(node, sideB, b.half + footB), b.dir)
  if (pointT === null || outerT === null) return null
  const point = add(add(node, sideA, a.half), a.dir, pointT)
  const outer = add(add(node, sideA, a.half + footA), a.dir, outerT)
  const outerA = add(tangentA, sideA, footA)
  const outerB = add(tangentB, sideB, footB)

  const startAngle = Math.atan2(tangentA[1] - centre[1], tangentA[0] - centre[0])
  let sweep = Math.atan2(tangentB[1] - centre[1], tangentB[0] - centre[0]) - startAngle
  if (sweep > Math.PI) sweep -= Math.PI * 2
  if (sweep < -Math.PI) sweep += Math.PI * 2

  const corner: Corner = {
    centre,
    radius,
    tangentA,
    tangentB,
    point,
    outer,
    outerA,
    outerB,
    startAngle,
    sweep,
    zone: [point, tangentA, outerA, outer, outerB, tangentB],
    web: [],
    newA: usesNewGround(roads[a.road]),
    newB: usesNewGround(roads[b.road]),
    kerbWidth,
    painted: presetA.kerb.painted || presetB.kerb.painted,
  }
  const steps = arcSteps(corner)
  corner.web = [point, ...Array.from({ length: steps + 1 }, (_, i) => arcPoint(corner, i / steps))]

  // The corner's footpath must be clear of every road. Where a dual carriageway splits,
  // or a third road runs close, the "corner" between two arms is someone else's road.
  const kerbBack = (part: number): Vec => {
    const p = arcPoint(corner, part)
    const toCentre = sub(centre, p)
    return add(p, toCentre, (kerbWidth + 0.1) / length(toCentre))
  }
  const fill: Vec[] = [centre, outer, outerA, outerB, kerbBack(0.25), kerbBack(0.5), kerbBack(0.75), add(centre, sub(tangentA, centre), 0.5), add(centre, sub(tangentB, centre), 0.5)]
  if (fill.some(([x, z]) => nearestRoadEdge(index, x, z, 2) < 0.05)) return null
  return corner
}

/**
 * Finds every junction that touches a road with the new ground, and rounds the
 * corners between neighbouring roads there.
 */
function findCorners(pieces: RoadPiece[], roads: LineFeature[], index: RoadIndex): Corner[] {
  const keyOf = ([x, z]: Vec) => `${x.toFixed(2)},${z.toFixed(2)}`
  const touched = new Set<string>()
  for (const piece of pieces) {
    if (!usesNewGround(roads[piece.road])) continue
    touched.add(keyOf(piece.start))
    touched.add(keyOf(piece.end))
  }

  const nodes = new Map<string, { at: Vec; arms: Arm[] }>()
  for (const piece of pieces) {
    const along = sub(piece.end, piece.start)
    const pieceLength = length(along)
    if (pieceLength < 0.3) continue
    const dir: Vec = [along[0] / pieceLength, along[1] / pieceLength]
    for (const [at, armDir] of [
      [piece.start, dir],
      [piece.end, [-dir[0], -dir[1]]],
    ] as [Vec, Vec][]) {
      const key = keyOf(at)
      if (!touched.has(key)) continue
      let node = nodes.get(key)
      if (!node) {
        node = { at, arms: [] }
        nodes.set(key, node)
      }
      node.arms.push({ dir: armDir, half: piece.width / 2, length: pieceLength, road: piece.road })
    }
  }

  const corners: Corner[] = []
  for (const { at, arms } of nodes.values()) {
    if (arms.length < 2) continue
    arms.sort((p, q) => Math.atan2(p.dir[1], p.dir[0]) - Math.atan2(q.dir[1], q.dir[0]))
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i]
      const b = arms[(i + 1) % arms.length]
      let gap = Math.atan2(b.dir[1], b.dir[0]) - Math.atan2(a.dir[1], a.dir[0])
      if (gap <= 0) gap += Math.PI * 2
      if (gap < MIN_CORNER || gap > MAX_CORNER) continue
      if (!usesNewGround(roads[a.road]) && !usesNewGround(roads[b.road])) continue
      // A tight corner between short pieces gets a smaller radius, or none.
      const corner =
        makeCorner(at, a, b, STREET.cornerRadius, roads, index) ?? makeCorner(at, a, b, STREET.cornerRadius / 2, roads, index)
      if (corner) corners.push(corner)
    }
  }
  return corners
}

/** Corners sorted into a grid, for asking quickly whether a point is in one. */
class CornerIndex {
  private readonly cells = new Map<string, Corner[]>()
  private static readonly CELL = 24

  constructor(corners: Corner[]) {
    for (const corner of corners) {
      const xs = corner.zone.map((p) => p[0])
      const zs = corner.zone.map((p) => p[1])
      for (let cx = Math.floor(Math.min(...xs) / CornerIndex.CELL); cx <= Math.floor(Math.max(...xs) / CornerIndex.CELL); cx++) {
        for (let cz = Math.floor(Math.min(...zs) / CornerIndex.CELL); cz <= Math.floor(Math.max(...zs) / CornerIndex.CELL); cz++) {
          const key = `${cx},${cz}`
          const list = this.cells.get(key)
          if (list) list.push(corner)
          else this.cells.set(key, [corner])
        }
      }
    }
  }

  near([x, z]: Vec): Corner[] {
    return this.cells.get(`${Math.floor(x / CornerIndex.CELL)},${Math.floor(z / CornerIndex.CELL)}`) ?? []
  }

  /** The corner whose zone holds this point, if any. Straight kerbs and footpaths stop here. */
  zoneAt(point: Vec): Corner | null {
    return this.near(point).find((corner) => isInside(corner.zone, point)) ?? null
  }
}

// ---------------------------------------------------------------------------
// Gates

class GateIndex {
  private readonly cells = new Map<string, Gate[]>()
  private static readonly CELL = 16

  constructor(gates: Gate[]) {
    for (const gate of gates) {
      const key = `${Math.floor(gate.x / GateIndex.CELL)},${Math.floor(gate.z / GateIndex.CELL)}`
      const list = this.cells.get(key)
      if (list) list.push(gate)
      else this.cells.set(key, [gate])
    }
  }

  /**
   * The stretches of a kerb, from `start` running `dir` for `edgeLength` metres
   * with the footpath to `out`, that are lowered in front of a gate, as
   * [from, to] metres along it, in order. Worked out from the gates near it,
   * rather than by testing point after point along every kerb in the map.
   */
  droppedSpans(start: Vec, dir: Vec, out: Vec, edgeLength: number): [number, number][] {
    const spans: [number, number][] = []
    const end = add(start, dir, edgeLength)
    const reach = WIDEST_FOOTPATH + 6
    const [minX, maxX] = [Math.min(start[0], end[0]) - reach, Math.max(start[0], end[0]) + reach]
    const [minZ, maxZ] = [Math.min(start[1], end[1]) - reach, Math.max(start[1], end[1]) + reach]
    for (let x = Math.floor(minX / GateIndex.CELL); x <= Math.floor(maxX / GateIndex.CELL); x++) {
      for (let z = Math.floor(minZ / GateIndex.CELL); z <= Math.floor(maxZ / GateIndex.CELL); z++) {
        for (const gate of this.cells.get(`${x},${z}`) ?? []) {
          const offset = sub([gate.x, gate.z], start)
          const along = offset[0] * dir[0] + offset[1] * dir[1]
          const outward = offset[0] * out[0] + offset[1] * out[1]
          if (outward <= 0 || outward >= reach) continue
          const from = Math.max(0, along - gate.width / 2 - 0.3)
          const to = Math.min(edgeLength, along + gate.width / 2 + 0.3)
          if (to > from) spans.push([from, to])
        }
      }
    }
    spans.sort((a, b) => a[0] - b[0])
    // Overlapping spans join into one.
    const joined: [number, number][] = []
    for (const span of spans) {
      const last = joined[joined.length - 1]
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
      else joined.push([...span])
    }
    return joined
  }
}

// ---------------------------------------------------------------------------
// Colours

/**
 * Where a painted kerb's blocks start counting, from where its road piece
 * starts, so neighbouring kerbs don't all start on the same colour. Always
 * positive, as a negative stripe value means a bare kerb to the shader.
 */
function stripeOrigin([x, z]: Vec): number {
  return (((x + z) % 1000) + 1000) % 1000
}

/** A painted kerb's colour before its shader paints the blocks on: white, so the paint shows true. */
const PAINTED_BASE = new THREE.Color('#ffffff')
/** Bare concrete kerbs, a little different from one stretch to the next. */
const PLAIN_KERBS = [new THREE.Color('#928e86'), new THREE.Color('#87837b'), new THREE.Color('#9b978e')]
function plainKerb(at: Vec): THREE.Color {
  return PLAIN_KERBS[Math.abs(Math.round(at[0] * 0.37 + at[1] * 0.53)) % PLAIN_KERBS.length]
}
const EDGE_STONE = new THREE.Color('#a29d93')
const PIT_SOIL = new THREE.Color('#8a4a2c')
const DUST = new THREE.Color('#c0794a')
/** Dry leaves in the gutter: a drift may lie every this many metres along a kerb (the preset says how often). */
const LEAF_SPACING = 1.4
const LEAF_COLORS = ['#8a5a2a', '#b07a32', '#c99a3a', '#6f6a2a', '#9a4a22', '#7a6a3a'].map((color) => new THREE.Color(color))


// ---------------------------------------------------------------------------
// The builder

export type StreetEdges = {
  kerbs: THREE.BufferGeometry[]
  footpaths: THREE.BufferGeometry[]
  edgeStones: THREE.BufferGeometry[]
  asphalt: THREE.BufferGeometry[]
  dust: THREE.BufferGeometry[]
  pits: THREE.BufferGeometry[]
  decals: THREE.BufferGeometry[]
  corners: Corner[]
  /** Whether a point is in a rounded junction corner, where the old kerbs must stop too. */
  isInCorner: (x: number, z: number) => boolean
  /**
   * The street's height at a point where the new ground sets it: 'road' on its
   * asphalt (including the rounded corners), a number on its kerbs and
   * footpaths, or null where the old rules apply.
   */
  heightAt: (x: number, z: number) => number | 'road' | null
  /** How far something standing here must be lifted, to stand on a raised footpath. */
  liftAt: (x: number, z: number) => number
  /** Paved ground away from the road, such as shops' forecourts, as outlines: no grass grows there. */
  paved: GroundPoint[][]
  /**
   * The medians down the middle of wide two-way main roads, as lines with a
   * width. They're made solid only after traffic's lanes are laid out, as a lane
   * beside one would otherwise count as blocked.
   */
  medians: { start: GroundPoint; end: GroundPoint; width: number }[]
}

/**
 * Kerbs, footpaths and the rest are checked along each road edge at points this
 * far apart, in metres. Where something starts or stops between two checks, the
 * spot is then narrowed down (`findRuns`), so this only sets how short a gap can be missed.
 */
const STEP = 1
/** A kerb needs at least this much room behind it before the next road, in metres, and a run at least this long. */
const KERB_ROOM = 0.6
/** On a main road, a gap this wide or more to the next carriageway gets kerbs that meet as a median. */
const MEDIAN_KERB_GAP = 0.4
const MIN_KERB_RUN = 1.2

type Input = {
  roads: LineFeature[]
  pieces: RoadPiece[]
  index: RoadIndex
  gates: Gate[]
  trees: Prop[]
  /** Places where the footpath isn't raised, such as a petrol bunk's forecourt. */
  keepLow: (x: number, z: number) => boolean
  /** Shop fronts: where they stand back from the footpath, the ground in front of them is paved. */
  fronts?: { x: number; z: number; width: number }[]
}

/** A shop standing back further than this from the footpath gets no forecourt: it's a yard, not a forecourt. */
const FORECOURT_MAX = 8
/** Forecourts of shops this close together, along the street, join into one. */
const FORECOURT_JOIN = 4
/** Each end of a forecourt is dusty for this far in. */
const FORECOURT_DUSTY_END = 0.8

export function buildStreetEdges({ roads, pieces, index, gates, trees, keepLow, fronts = [] }: Input): StreetEdges {
  const corners = findCorners(pieces, roads, index)
  const cornerIndex = new CornerIndex(corners)
  const gateIndex = new GateIndex(gates)

  const kerbs = new Layer({ position: 3, normal: 3, color: 3, aStripe: 1 })
  const footpaths = new Layer({ position: 3, normal: 3, uv: 2, aEdge: 1 })
  const edgeStones = new Layer({ position: 3, normal: 3, color: 3 })
  const asphalt = new Layer({ position: 3, normal: 3, uv: 2, aAcross: 1, aHalf: 1, aKerb: 2 })
  const dust = new Layer({ position: 3, normal: 3, color: 4 })
  const pits = new Layer({ position: 3, normal: 3, color: 3 })
  const decals = new Layer({ position: 3, normal: 3, uv: 2 })

  const newPieces = pieces.filter((piece) => usesNewGround(roads[piece.road]) && length(sub(piece.end, piece.start)) > 0.3)

  // ---- The asphalt: each piece, discs at its ends, and the rounded corners' webs ----
  // `across` is how far across the road a corner is, `half` the road's half width, and `kerb`
  // whether a kerb runs on the left and right there: the gutter and dust only show by a kerb.
  type AsphaltCorner = { across: number; half: number; kerb: [number, number] }
  const asphaltVertex = (arrays: number[][], [x, z]: Vec, { across, half, kerb }: AsphaltCorner) =>
    corner(arrays, [x, ROAD_HEIGHT, z], UP, [x, z], [across], [half], kerb)
  const joints = new Map<string, { at: Vec; dir: Vec; half: number; junction: boolean }>()
  for (const piece of newPieces) {
    const along = sub(piece.end, piece.start)
    const dir: Vec = [along[0] / length(along), along[1] / length(along)]
    const half = piece.width / 2
    for (const at of [piece.start, piece.end]) {
      const key = `${at[0].toFixed(2)},${at[1].toFixed(2)}`
      const existing = joints.get(key)
      if (existing) {
        existing.junction ||= Math.abs(existing.dir[0] * dir[0] + existing.dir[1] * dir[1]) < 0.9
        existing.half = Math.max(existing.half, half)
      } else joints.set(key, { at, dir, half, junction: false })
    }
  }
  // A disc at each joint fills the gaps at bends. Its "across" follows the road, so the
  // edge shading runs on smoothly. At a junction it has no edges to shade.
  for (const { at, dir, half, junction } of joints.values()) {
    const arrays = asphalt.at(at)
    const side = left(dir)
    const sides = 16
    for (let i = 0; i < sides; i++) {
      const p = (k: number): Vec => {
        const angle = (k / sides) * Math.PI * 2
        return [at[0] + Math.cos(angle) * half, at[1] + Math.sin(angle) * half]
      }
      const across = (point: Vec) => (junction ? 0 : (point[0] - at[0]) * side[0] + (point[1] - at[1]) * side[1])
      const halfFor = junction ? 99 : half
      pushFlatTriangle(arrays, at, p(i), p(i + 1), (point, isFirst) => ({ across: isFirst ? 0 : across(point), half: halfFor, kerb: [1, 1] }))
    }
  }
  for (const c of corners) {
    const arrays = asphalt.at(c.point)
    // The web's edge is the kerb; its far corner is mid-road.
    const toEdge = length(sub(c.point, arcPoint(c, 0.5)))
    for (let i = 1; i < c.web.length - 1; i++) {
      pushFlatTriangle(arrays, c.web[0], c.web[i], c.web[i + 1], (_point, isPoint) => ({ across: isPoint ? 0 : toEdge, half: toEdge, kerb: [1, 1] }))
    }
  }

  function pushFlatTriangle(arrays: number[][], p0: Vec, p1: Vec, p2: Vec, extra: (point: Vec, isFirst: boolean) => AsphaltCorner) {
    const facesUp = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]) > 0
    const order: [Vec, boolean][] = facesUp ? [[p0, true], [p1, false], [p2, false]] : [[p0, true], [p2, false], [p1, false]]
    for (const [point, first] of order) asphaltVertex(arrays, point, extra(point, first))
  }

  // ---- Kerbs, footpaths, edge stones and dust along each side of each piece ----
  for (const piece of newPieces) {
    const along = sub(piece.end, piece.start)
    const pieceLength = length(along)
    const dir: Vec = [along[0] / pieceLength, along[1] / pieceLength]
    const half = piece.width / 2
    const kerbRuns = new Map<number, [number, number][]>()
    const preset = presetFor(roads[piece.road])
    const foot = preset.footpath
    const kerbWidth = preset.kerb.width

    for (const sideSign of [1, -1]) {
      const out: Vec = sideSign > 0 ? left(dir) : right(dir)
      const at = (s: number, outward: number): Vec => add(add(piece.start, dir, s), out, half + outward)
      // How far the footpath can run out here before it meets another road, or the forecourt of a bunk.
      const footpathReach = (s: number): number => {
        const edge = at(s, 0)
        let reach = foot
        const near = nearestOtherRoad(index, edge, piece, foot + 1)
        if (near !== null) reach = Math.min(reach, near - kerbWidth)
        if (keepLow(...at(s, foot / 2))) reach = 0
        return reach
      }
      const kerbAt = (s: number) => {
        const middle = at(s, kerbWidth / 2)
        const near = nearestOtherRoad(index, at(s, 0), piece, 1)
        // A kerb needs room behind it: a sliver between two carriageways is just road.
        // A main road's kerb also stands in a narrow gap to the next carriageway: the two kerbs, each
        // fitted to half the gap, meet as a painted median.
        const roomy = near === null || near > kerbWidth + KERB_ROOM || (preset.median !== null && near > MEDIAN_KERB_GAP)
        return roomy && !cornerIndex.zoneAt(middle) && !keepLow(...at(s, foot / 2))
      }

      // Kerb runs, then blocks along them, painted alternately, lowered in front of gates.
      const sideRuns = findRuns(kerbAt, pieceLength).filter(([from, to]) => to - from >= MIN_KERB_RUN)
      kerbRuns.set(sideSign, sideRuns)
      // Each run is drawn as a few long kerbs, broken only where it drops in front of a gate. The
      // black and yellow blocks of a painted kerb are painted on by its shader, from how far along it is.
      const stripeStart = stripeOrigin(piece.start)
      const dropped = gateIndex.droppedSpans(at(0, 0), dir, out, pieceLength)
      const isDropped = (s: number) => dropped.some(([from, to]) => s >= from && s <= to)
      for (const [from, to] of sideRuns) {
        // Cut the run where a lowered stretch starts or ends.
        const cuts = [from, ...dropped.flatMap((span) => span).filter((s) => s > from + 0.05 && s < to - 0.05), to]
        for (let i = 0; i < cuts.length - 1; i++) {
          const [s0, s1] = [cuts[i], cuts[i + 1]]
          const middle = add(piece.start, dir, (s0 + s1) / 2)
          const low = isDropped((s0 + s1) / 2)
          const color = preset.kerb.painted ? PAINTED_BASE : plainKerb(middle)
          const stripe: [number, number] = preset.kerb.painted ? [stripeStart + s0, stripeStart + s1] : [-1, -1]
          // Narrower where another carriageway is close behind it: half the gap, so the two meet.
          const gaps = [s0, (s0 + s1) / 2, s1].map((s) => nearestOtherRoad(index, at(s, 0), piece, kerbWidth * 2 + KERB_ROOM))
          const room = Math.min(...gaps.map((gap) => (gap === null ? Infinity : gap / 2 - 0.01)))
          const width = Math.max(0.1, Math.min(kerbWidth, room))
          pushKerbBlock(kerbs.at(middle), at(s0, 0), at(s1, 0), out, low ? STREET.droppedRise : STREET.kerbRise, width, color, [true, true], stripe)
        }
        // Dry leaves blown into the gutter along the kerb, in drifts.
        const leafRandom = createRandom(Math.abs(Math.round(piece.start[0] * 37 + piece.start[1] * 53 + sideSign * 11)))
        for (let s = from + 0.5; s < to - 0.5; s += LEAF_SPACING) {
          if (leafRandom() > preset.leaves) continue
          const centre = at(s + leafRandom(), -0.12 - leafRandom() * 0.22)
          pushLeaves(dust.at(centre), centre, leafRandom, ROAD_HEIGHT + 0.006, 2 + Math.floor(leafRandom() * 4))
        }
      }

      // The footpath: a band from the kerb's back, out as far as it can reach, level with the kerb top.
      const inCornerAt = (s: number) => cornerIndex.zoneAt(at(s, foot / 2)) !== null
      const footpathOn = (s: number) => !inCornerAt(s) && footpathReach(s) > 0.3
      for (const [from, to] of findRuns(footpathOn, pieceLength)) {
        const count = Math.max(1, Math.ceil((to - from) / STEP))
        const all = Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count).map((s) => ({ s, reach: footpathReach(s) }))
        // Along a straight stretch of full width, one long piece will do: keep only the
        // samples where the width changes, and the ends.
        const samples = all.filter(
          (sample, i) =>
            i === 0 ||
            i === all.length - 1 ||
            Math.abs(sample.reach - all[i - 1].reach) > 0.01 ||
            Math.abs(sample.reach - all[i + 1].reach) > 0.01,
        )
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1]
          const b = samples[i]
          pushFootpathQuad(footpaths.at(at(b.s, 0)), at(a.s, kerbWidth), at(b.s, kerbWidth), at(b.s, b.reach), at(a.s, a.reach), a.reach, b.reach, foot)
          // Beside the soil, an edge stone and a strip of dust.
          if (a.reach >= foot - 0.01 && b.reach >= foot - 0.01) {
            pushEdgeStone(edgeStones.at(at(b.s, 0)), at(a.s, foot - STREET.edgeStone), at(b.s, foot - STREET.edgeStone), out)
            pushDustStrip(dust.at(at(b.s, 0)), at(a.s, foot), at(b.s, foot), out)
          }
        }
        // An end that meets a rounded corner carries on into it. Any other end gets a face down to the ground.
        for (const end of [samples[0], samples[samples.length - 1]]) {
          const beyond = end === samples[0] ? end.s - 0.2 : end.s + 0.2
          if (beyond > 0 && beyond < pieceLength && inCornerAt(beyond)) continue
          pushSkirt(edgeStones.at(at(end.s, 0)), at(end.s, kerbWidth), at(end.s, end.reach))
        }
      }
    }

    pushUnderlay(footpaths.at(piece.start), piece.start, piece.end, half, foot)

    // The asphalt, in lengths of about 2 m, each knowing where a kerb runs beside it.
    const hasKerb = (sideSign: number, s: number) => ((kerbRuns.get(sideSign) ?? []).some(([from, to]) => s >= from - 0.3 && s <= to + 0.3) ? 1 : 0)
    const lengths = Math.max(1, Math.ceil(pieceLength / 2))
    const side = left(dir)
    for (let i = 0; i < lengths; i++) {
      const s0 = (i / lengths) * pieceLength
      const s1 = ((i + 1) / lengths) * pieceLength
      const a = add(add(piece.start, dir, s0), side, half)
      const b = add(add(piece.start, dir, s0), side, -half)
      const c = add(add(piece.start, dir, s1), side, -half)
      const d = add(add(piece.start, dir, s1), side, half)
      const sOf = (point: Vec) => (point === a || point === b ? s0 : s1)
      const extra = (point: Vec): AsphaltCorner => ({
        across: point === a || point === d ? half : -half,
        half,
        kerb: [hasKerb(1, sOf(point)), hasKerb(-1, sOf(point))],
      })
      const arrays = asphalt.at(a)
      pushFlatTriangle(arrays, a, b, c, extra)
      pushFlatTriangle(arrays, a, c, d, extra)
    }
  }

  // ---- The rounded corners: kerb along the arc, footpath filling the corner ----
  for (const c of corners) {
    const steps = arcSteps(c)
    const towardCentre = (point: Vec): Vec => {
      const v = sub(c.centre, point)
      const l = length(v)
      return [v[0] / l, v[1] / l]
    }
    // The kerb along the arc, in thin slices, painted like the straight ones.
    const arcLength = Math.abs(c.sweep) * c.radius
    const color = c.painted ? PAINTED_BASE : plainKerb(c.centre)
    for (let k = 0; k < steps; k++) {
      const p0 = arcPoint(c, k / steps)
      const p1 = arcPoint(c, (k + 1) / steps)
      const stripe: [number, number] = c.painted ? [(arcLength * k) / steps, (arcLength * (k + 1)) / steps] : [-1, -1]
      pushKerbSlice(kerbs.at(p0), p0, p1, towardCentre(p0), towardCentre(p1), STREET.kerbRise, c.kerbWidth, color, stripe)
    }
    // The footpath in the corner: from the kerb's back along the arc, out to the far corner.
    const arrays = footpaths.at(c.centre)
    const kerbBack = (part: number): Vec => {
      const p = arcPoint(c, part)
      return add(p, towardCentre(p), c.kerbWidth)
    }
    const ring: Vec[] = [c.outerA, ...Array.from({ length: steps + 1 }, (_, i) => kerbBack(i / steps)), c.outerB]
    // Fanned from the far corner, which can see the whole of it.
    const fanCentre = c.outer
    // No drifted dust in a corner: it meets the soil only at its far point, and dust
    // shaded from there spreads across the whole corner as orange wedges.
    const edgeFor = () => 0
    for (let i = 0; i < ring.length - 1; i++) {
      pushFootpathTriangle(arrays, fanCentre, ring[i], ring[i + 1], edgeFor)
    }
    // Where an old road's lower footpath meets the corner, a face down to it.
    if (!c.newA) pushSkirt(edgeStones.at(c.tangentA), kerbBack(0), c.outerA)
    if (!c.newB) pushSkirt(edgeStones.at(c.tangentB), kerbBack(1), c.outerB)
  }

  // ---- Medians: a raised, painted strip down the middle of a wide two-way main road, broken at junctions ----
  const medians: { start: GroundPoint; end: GroundPoint; width: number }[] = []
  /** How far short of a junction a median stops, so traffic can turn across. */
  const MEDIAN_GAP = 9
  for (const piece of newPieces) {
    const road = roads[piece.road]
    const median = presetFor(road).median
    if (!median || piece.width < median.minRoadWidth || road.properties.oneway === 'yes') continue
    const along = sub(piece.end, piece.start)
    const pieceLength = length(along)
    const dir: Vec = [along[0] / pieceLength, along[1] / pieceLength]
    const side = left(dir)
    const gapAt = (at: Vec) => (joints.get(`${at[0].toFixed(2)},${at[1].toFixed(2)}`)?.junction ? MEDIAN_GAP : 0.4)
    const from = gapAt(piece.start)
    const to = pieceLength - gapAt(piece.end)
    if (to - from < 3) continue
    const half = median.width / 2
    const a = add(piece.start, dir, from)
    const b = add(piece.start, dir, to)
    const stripe: [number, number] = [stripeOrigin(piece.start) + from, stripeOrigin(piece.start) + to]
    // Two halves, each a kerb facing its own side of the road, meeting along the middle.
    pushKerbBlock(kerbs.at(a), add(a, side, half), add(b, side, half), [-side[0], -side[1]], median.rise, half, PAINTED_BASE, [true, true], stripe)
    pushKerbBlock(kerbs.at(a), add(a, side, -half), add(b, side, -half), side, median.rise, half, PAINTED_BASE, [true, true], stripe)
    medians.push({ start: a, end: b, width: median.width })
  }
  // ---- Forecourts: paving from the footpath to the shops, where they stand back from it ----
  // Shops are grouped by the road piece and side they face, and neighbours along it join up.
  // Each run is a rectangle in the road's own frame: from the footpath's far edge out to the
  // deepest shop's wall. Where a wall stands nearer, the paving runs on under the building.
  type Forecourt = { start: Vec; dir: Vec; out: Vec; from: number; to: number; near: number; far: number }
  const forecourts: Forecourt[] = []
  const groups = new Map<string, { piece: RoadPiece; side: number; s0: number; s1: number; gap: number; foot: number }[]>()
  const pieceNumber = new Map(pieces.map((piece, i) => [piece, i]))
  for (const front of fronts) {
    const near = nearestRoadPiece(index, front.x, front.z, WIDEST_FOOTPATH + FORECOURT_MAX + 1)
    const nearPreset = near ? streetPresetOf(roads[near.piece.road]) : null
    if (!near || !nearPreset?.forecourts) continue
    const foot = nearPreset.footpath
    const gap = near.edge - foot
    if (gap < 0.3 || gap > FORECOURT_MAX) continue
    const { piece } = near
    const along = sub(piece.end, piece.start)
    const dir: Vec = [along[0] / length(along), along[1] / length(along)]
    const rel = sub([front.x, front.z], piece.start)
    const s = rel[0] * dir[0] + rel[1] * dir[1]
    const side = rel[0] * -dir[1] + rel[1] * dir[0] > 0 ? 1 : -1
    const key = `${pieceNumber.get(piece)}:${side}`
    const list = groups.get(key) ?? []
    groups.set(key, list)
    list.push({ piece, side, s0: s - front.width / 2, s1: s + front.width / 2, gap, foot })
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.s0 - b.s0)
    let run: (typeof list)[number] | null = null
    const close = () => {
      if (!run) return
      const { piece, side, s0, s1, gap, foot } = run
      const along = sub(piece.end, piece.start)
      const dir: Vec = [along[0] / length(along), along[1] / length(along)]
      const out: Vec = side > 0 ? left(dir) : right(dir)
      const half = piece.width / 2
      forecourts.push({ start: piece.start, dir, out, from: s0 - 0.3, to: s1 + 0.3, near: half + foot - 0.02, far: half + foot + gap + 0.25 })
    }
    for (const shop of list) {
      if (run && shop.s0 - run.s1 < FORECOURT_JOIN) {
        run.s1 = Math.max(run.s1, shop.s1)
        run.gap = Math.max(run.gap, shop.gap)
      } else {
        close()
        run = { ...shop }
      }
    }
    close()
  }
  const forecourtPoint = (f: Forecourt, s: number, outward: number): Vec => add(add(f.start, f.dir, s), f.out, outward)
  for (const f of forecourts) {
    const arrays = footpaths.at(forecourtPoint(f, (f.from + f.to) / 2, f.near))
    // Three strips along the street: dusty at each end, clean in the middle.
    const cuts = [f.from, f.from + FORECOURT_DUSTY_END, f.to - FORECOURT_DUSTY_END, f.to]
    if (cuts[1] >= cuts[2]) cuts.splice(1, 2, (f.from + f.to) / 2)
    const dustAt = (s: number) => (s <= f.from + 0.01 || s >= f.to - 0.01 ? 1 : 0)
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = forecourtPoint(f, cuts[i], f.near)
      const b = forecourtPoint(f, cuts[i + 1], f.near)
      const c = forecourtPoint(f, cuts[i + 1], f.far)
      const d = forecourtPoint(f, cuts[i], f.far)
      const edge = new Map<Vec, number>([[a, dustAt(cuts[i])], [b, dustAt(cuts[i + 1])], [c, Math.max(0.6, dustAt(cuts[i + 1]))], [d, Math.max(0.6, dustAt(cuts[i]))]])
      pushFootpathTriangle(arrays, a, b, c, (p) => edge.get(p) ?? 0)
      pushFootpathTriangle(arrays, a, c, d, (p) => edge.get(p) ?? 0)
    }
    // Each end: a face down to the soil, and dust blown out onto it.
    for (const [s, away] of [[f.from, -1], [f.to, 1]] as const) {
      const inner = forecourtPoint(f, s, f.near)
      const outer = forecourtPoint(f, s, f.far)
      pushSkirt(edgeStones.at(inner), inner, outer)
      const awayDir: Vec = [f.dir[0] * away, f.dir[1] * away]
      pushDustStrip(dust.at(inner), inner, outer, awayDir)
    }
  }
  // Forecourts sorted into squares by their corners' box, as heights are asked for every frame.
  const FORECOURT_CELL = 16
  const forecourtCells = new Map<string, Forecourt[]>()
  for (const f of forecourts) {
    const points = [forecourtPoint(f, f.from, f.near), forecourtPoint(f, f.to, f.near), forecourtPoint(f, f.to, f.far), forecourtPoint(f, f.from, f.far)]
    const xs = points.map((p) => p[0])
    const zs = points.map((p) => p[1])
    for (let cx = Math.floor(Math.min(...xs) / FORECOURT_CELL); cx <= Math.floor(Math.max(...xs) / FORECOURT_CELL); cx++) {
      for (let cz = Math.floor(Math.min(...zs) / FORECOURT_CELL); cz <= Math.floor(Math.max(...zs) / FORECOURT_CELL); cz++) {
        const key = `${cx},${cz}`
        const list = forecourtCells.get(key)
        if (list) list.push(f)
        else forecourtCells.set(key, [f])
      }
    }
  }
  const isOnForecourt = ([x, z]: Vec) =>
    (forecourtCells.get(`${Math.floor(x / FORECOURT_CELL)},${Math.floor(z / FORECOURT_CELL)}`) ?? []).some((f) => {
      const rel = sub([x, z], f.start)
      const s = rel[0] * f.dir[0] + rel[1] * f.dir[1]
      const o = rel[0] * f.out[0] + rel[1] * f.out[1]
      return s >= f.from && s <= f.to && o >= f.near && o <= f.far
    })

  // ---- Trees: a pit with a frame and damp soil on the footpath, or damp soil round them on the verge ----
  for (const tree of trees) {
    const near = nearestRoadPiece(index, tree.x, tree.z, WIDEST_FOOTPATH + 6)
    if (!near || !usesNewGround(roads[near.piece.road])) continue
    const { footpath: foot, kerb } = presetFor(roads[near.piece.road])
    const along = sub(near.piece.end, near.piece.start)
    const dir: Vec = [along[0] / length(along), along[1] / length(along)]
    if (near.edge > kerb.width + 0.3 && near.edge < foot - 0.3) {
      pushTreePit(pits.at([tree.x, tree.z]), [tree.x, tree.z], dir)
    } else if (near.edge >= foot) {
      pushDampPatch(dust.at([tree.x, tree.z]), [tree.x, tree.z], tree.variation)
    }
  }

  // ---- Marks on the asphalt: tar patches, cracks, manholes and newer patches, every few metres ----
  for (const piece of newPieces) {
    const along = sub(piece.end, piece.start)
    const pieceLength = length(along)
    const dir: Vec = [along[0] / pieceLength, along[1] / pieceLength]
    const side = left(dir)
    // Seeded by the street and the spot, so a street's marks are the same on every visit.
    const random = streetRandom(roads[piece.road], Math.abs(Math.round(piece.start[0] * 131 + piece.start[1] * 71)))
    const half = piece.width / 2
    const { every, share } = presetFor(roads[piece.road]).marks
    for (let s = 3; s < pieceLength - 3; s += every) {
      // The share of tries that get a mark, split between the kinds as on 27th Main.
      const roll = random() / share
      const small = [DECAL.drop, DECAL.spot, DECAL.drips]
      const kind =
        roll < 0.16 ? DECAL.tar
        : roll < 0.4 ? small[Math.floor(random() * small.length)]
        : roll < 0.8 ? DECAL.crack
        : roll < 0.87 && half > 3 ? DECAL.manhole
        : roll < 1 ? DECAL.patch
        : null
      if (!kind) continue
      const size = kind.size[0] + random() * (kind.size[1] - kind.size[0])
      const room = Math.max(0, half - size / 2 - 0.4)
      const across = (random() * 2 - 1) * room
      const centre = add(add(piece.start, dir, s + random() * 3), side, across)
      const turn = kind.turns ? random() * Math.PI * 2 : random() < 0.5 ? 0 : Math.PI
      pushDecal(decals.at(centre), centre, dir, turn, kind, size)
    }
  }

  const isInCorner = (x: number, z: number) => cornerIndex.zoneAt([x, z]) !== null

  const heightAt = (x: number, z: number): number | 'road' | null => {
    const point: Vec = [x, z]
    for (const c of cornerIndex.near(point)) {
      if (!isInside(c.zone, point)) continue
      if (isInside(c.web, point)) return 'road'
      const fromCentre = length(sub(point, c.centre))
      return fromCentre <= c.radius && fromCentre > c.radius - c.kerbWidth ? KERB_TOP : FOOTPATH_TOP
    }
    const near = nearestRoadPiece(index, x, z, WIDEST_FOOTPATH + 0.2)
    const nearPreset = near ? streetPresetOf(roads[near.piece.road]) : null
    if (!near || !nearPreset) return isOnForecourt(point) ? FOOTPATH_TOP : null
    const foot = nearPreset.footpath
    if (near.edge <= 0) return 'road'
    if (keepLow(x, z)) return null
    if (near.edge < nearPreset.kerb.width) return KERB_TOP
    if (near.edge < foot - STREET.edgeStone) return FOOTPATH_TOP
    if (near.edge < foot) return FOOTPATH_TOP + STREET.edgeStoneRise
    return isOnForecourt(point) ? FOOTPATH_TOP : null
  }

  const liftAt = (x: number, z: number) => {
    const height = heightAt(x, z)
    return typeof height === 'number' ? height : 0
  }

  return {
    kerbs: kerbs.toGeometries(),
    footpaths: footpaths.toGeometries(),
    edgeStones: edgeStones.toGeometries(),
    asphalt: asphalt.toGeometries(),
    dust: dust.toGeometries(),
    pits: pits.toGeometries(),
    decals: decals.toGeometries(),
    corners,
    isInCorner,
    heightAt,
    liftAt,
    medians,
    paved: forecourts.map((f) => [forecourtPoint(f, f.from, f.near), forecourtPoint(f, f.to, f.near), forecourtPoint(f, f.to, f.far), forecourtPoint(f, f.from, f.far)]),
  }
}

/**
 * The stretches of a road edge, from 0 to `edgeLength` metres along it, where
 * `test` holds. It's checked every STEP metres, and each end is then narrowed
 * down to a few millimetres, so a kerb or footpath stops right at a corner.
 */
function findRuns(test: (s: number) => boolean, edgeLength: number): [number, number][] {
  const steps = Math.max(1, Math.round(edgeLength / STEP))
  const sAt = (i: number) => (i / steps) * edgeLength
  const boundary = (inside: number, outside: number) => {
    for (let k = 0; k < 8; k++) {
      const middle = (inside + outside) / 2
      if (test(middle)) inside = middle
      else outside = middle
    }
    return inside
  }
  const runs: [number, number][] = []
  let start: number | null = test(0) ? 0 : null
  for (let i = 1; i <= steps; i++) {
    const on = test(sAt(i))
    if (on && start === null) start = boundary(sAt(i), sAt(i - 1))
    else if (!on && start !== null) {
      const end = boundary(sAt(i - 1), sAt(i))
      if (end - start > 0.3) runs.push([start, end])
      start = null
    }
  }
  if (start !== null && edgeLength - start > 0.3) runs.push([start, edgeLength])
  return runs
}

/** How far a point is from the edge of the nearest road other than `piece`, or null if none is within `reach`. */
function nearestOtherRoad(index: RoadIndex, [x, z]: Vec, piece: RoadPiece, reach: number): number | null {
  let nearest: number | null = null
  // A nearby piece of the same road, carrying on round a bend, doesn't count.
  const near = nearestOtherPieces(index, x, z, reach, piece)
  for (const other of near) {
    const edge = distanceToPiece(x, z, other) - other.width / 2
    if (nearest === null || edge < nearest) nearest = edge
  }
  return nearest
}

function nearestOtherPieces(index: RoadIndex, x: number, z: number, reach: number, piece: RoadPiece): RoadPiece[] {
  const found: RoadPiece[] = []
  forEachRoadNear(index, x, z, reach, (other) => {
    if (other === piece) return
    if (other.road === piece.road && sharesEnd(other, piece)) return
    if (distanceToPiece(x, z, other) - other.width / 2 < reach) found.push(other)
  })
  return found
}

function sharesEnd(a: RoadPiece, b: RoadPiece): boolean {
  const same = (p: GroundPoint, q: GroundPoint) => Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01
  return same(a.start, b.start) || same(a.start, b.end) || same(a.end, b.start) || same(a.end, b.end)
}

// ---------------------------------------------------------------------------
// Shapes

/** One corner of a coloured solid: where it is, its height, and its normal. */
type SolidCorner = [Vec, number, number[]]

/** A coloured triangle, its corners put in the order that makes it face the way its normals point. */
function solidTriangle(arrays: number[][], corners: SolidCorner[], color: THREE.Color, extra?: (point: Vec) => number[]) {
  // Which way the triangle faces, against the way its normals point, without making vectors:
  // there are a great many of these across the map.
  const [[[ax, az], ay, na], [[bx, bz], by, nb], [[cx, cz], cy, nc]] = corners
  const [ux, uy, uz] = [bx - ax, by - ay, bz - az]
  const [vx, vy, vz] = [cx - ax, cy - ay, cz - az]
  const facing = (uy * vz - uz * vy) * (na[0] + nb[0] + nc[0]) + (uz * vx - ux * vz) * (na[1] + nb[1] + nc[1]) + (ux * vy - uy * vx) * (na[2] + nb[2] + nc[2])
  const ordered = facing >= 0 ? corners : [corners[0], corners[2], corners[1]]
  const rgb = [color.r, color.g, color.b]
  for (const [[x, z], y, n] of ordered) {
    if (extra) corner(arrays, [x, y, z], n, rgb, extra([x, z]))
    else corner(arrays, [x, y, z], n, rgb)
  }
}

/** Four corners in order round a face, all with one normal. */
function solidQuad(arrays: number[][], points: [Vec, number][], normal: number[], color: THREE.Color, extra?: (point: Vec) => number[]) {
  const [a, b, c, d] = points.map(([p, y]): SolidCorner => [p, y, normal])
  solidTriangle(arrays, [a, b, c], color, extra)
  solidTriangle(arrays, [a, c, d], color, extra)
}

/**
 * The stripe coordinate of a kerb corner, for the kerb shader: how far along the
 * kerb it is, in metres, from `from` at p0 to `to` at p1, or -1 for a bare kerb.
 */
function stripeAlong(p0: Vec, p1: Vec, [from, to]: [number, number]): (point: Vec) => number[] {
  if (from < 0) return () => [-1]
  const along = sub(p1, p0)
  const lengthSquared = along[0] * along[0] + along[1] * along[1] || 1
  return (point) => {
    const t = Math.max(0, Math.min(1, ((point[0] - p0[0]) * along[0] + (point[1] - p0[1]) * along[1]) / lengthSquared))
    return [from + (to - from) * t]
  }
}

/**
 * A straight kerb, from `start` to `end` along the road edge, standing `rise`
 * above the road with its top edge bevelled on the road side. The profile, from
 * the road outward: a face up, the bevel, then the flat top. A painted kerb's
 * blocks are painted on by its shader, from `stripe`; see StreetEdges.tsx.
 */
function pushKerbBlock(
  arrays: number[][],
  start: Vec,
  end: Vec,
  out: Vec,
  rise: number,
  kerbWidth: number,
  color: THREE.Color,
  [capStart, capEnd]: [boolean, boolean],
  stripe: [number, number],
) {
  const extra = stripeAlong(start, end, stripe)
  const base = ROAD_HEIGHT - 0.02
  const top = ROAD_HEIGHT + rise
  const bevel = Math.min(STREET.kerbBevel, rise * 0.6)
  const outward = (p: Vec, distance: number) => add(p, out, distance)
  const outNormal = [-out[0], 0, -out[1]]
  const bevelNormal = new THREE.Vector3(-out[0], 1, -out[1]).normalize().toArray()
  // Facing the road.
  solidQuad(arrays, [[start, base], [end, base], [end, top - bevel], [start, top - bevel]], outNormal, color, extra)
  // The bevel.
  solidQuad(arrays, [[start, top - bevel], [end, top - bevel], [outward(end, bevel), top], [outward(start, bevel), top]], bevelNormal, color, extra)
  // The top.
  solidQuad(arrays, [[outward(start, bevel), top], [outward(end, bevel), top], [outward(end, kerbWidth), top], [outward(start, kerbWidth), top]], UP, color, extra)
  // The ends.
  const along = sub(end, start)
  const l = length(along)
  const endNormal = [along[0] / l, 0, along[1] / l]
  const startNormal = [-endNormal[0], 0, -endNormal[2]]
  for (const [p, normal, wanted] of [
    [end, endNormal, capEnd],
    [start, startNormal, capStart],
  ] as [Vec, number[], boolean][]) {
    if (!wanted) continue
    const pts: [Vec, number][] = [[p, base], [outward(p, kerbWidth), base], [outward(p, kerbWidth), top], [outward(p, bevel), top]]
    solidQuad(arrays, pts, normal, color, extra)
    solidTriangle(arrays, [[p, base, normal], [outward(p, bevel), top, normal], [p, top - bevel, normal]], color, extra)
  }
}

/** A thin slice of kerb round a corner: like a straight one, but its sides can turn, so slices make an arc. */
function pushKerbSlice(arrays: number[][], p0: Vec, p1: Vec, in0: Vec, in1: Vec, rise: number, kerbWidth: number, color: THREE.Color, stripe: [number, number]) {
  const extra = stripeAlong(p0, p1, stripe)
  const base = ROAD_HEIGHT - 0.02
  const top = ROAD_HEIGHT + rise
  const bevel = STREET.kerbBevel
  const face = (inward: Vec) => [-inward[0], 0, -inward[1]]
  const bevelNormal = (inward: Vec) => new THREE.Vector3(-inward[0], 1, -inward[1]).normalize().toArray()
  const quad = (points: SolidCorner[]) => {
    const [a, b, c, d] = points
    solidTriangle(arrays, [a, b, c], color, extra)
    solidTriangle(arrays, [a, c, d], color, extra)
  }
  quad([[p0, base, face(in0)], [p1, base, face(in1)], [p1, top - bevel, face(in1)], [p0, top - bevel, face(in0)]])
  quad([[p0, top - bevel, bevelNormal(in0)], [p1, top - bevel, bevelNormal(in1)], [add(p1, in1, bevel), top, bevelNormal(in1)], [add(p0, in0, bevel), top, bevelNormal(in0)]])
  quad([[add(p0, in0, bevel), top, UP], [add(p1, in1, bevel), top, UP], [add(p1, in1, kerbWidth), top, UP], [add(p0, in0, kerbWidth), top, UP]])
}

function footpathVertex(arrays: number[][], [x, z]: Vec, edge: number, height = FOOTPATH_TOP) {
  corner(arrays, [x, height, z], UP, [x, z], [edge])
}

/** The old pavement's height: the low paving laid under the raised footpaths. */
const UNDERLAY_HEIGHT = 0.03

/**
 * Low paving under a road and its footpaths, out to the footpaths' far edges,
 * as the old ground laid it. Wherever the raised footpath stops short, near a
 * junction or between pieces, this shows instead of bare soil.
 */
function pushUnderlay(arrays: number[][], start: Vec, end: Vec, half: number, foot: number) {
  const along = sub(end, start)
  const l = length(along)
  const side = left([along[0] / l, along[1] / l])
  const reach = half + foot
  const a = add(start, side, reach)
  const b = add(start, side, -reach)
  const c = add(end, side, -reach)
  const d = add(end, side, reach)
  for (const [p, q, r] of [[a, b, c], [a, c, d]] as [Vec, Vec, Vec][]) {
    const facesUp = (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]) > 0
    for (const point of facesUp ? [p, q, r] : [p, r, q]) footpathVertex(arrays, point, 0, UNDERLAY_HEIGHT)
  }
}

/** A piece of footpath: `edge` is 0 by the kerb and 1 at the far side, for the dust there. */
function pushFootpathQuad(arrays: number[][], a: Vec, b: Vec, c: Vec, d: Vec, reachA: number, reachB: number, foot: number) {
  const farA = reachA >= foot - 0.01 ? 1 : 0
  const farB = reachB >= foot - 0.01 ? 1 : 0
  pushFootpathTriangle(arrays, a, b, c, (p) => (p === c ? farB : 0))
  pushFootpathTriangle(arrays, a, c, d, (p) => (p === c ? farB : p === d ? farA : 0))
}

function pushFootpathTriangle(arrays: number[][], a: Vec, b: Vec, c: Vec, edgeFor: (point: Vec) => number) {
  const facesUp = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0
  for (const p of facesUp ? [a, b, c] : [a, c, b]) footpathVertex(arrays, p, edgeFor(p))
}

/** The edge stone along the footpath's far side: a little proud of it, with a face down to the soil. */
function pushEdgeStone(arrays: number[][], start: Vec, end: Vec, out: Vec) {
  const top = FOOTPATH_TOP + STREET.edgeStoneRise
  const outer = (p: Vec) => add(p, out, STREET.edgeStone)
  solidQuad(arrays, [[start, top], [end, top], [outer(end), top], [outer(start), top]], UP, EDGE_STONE)
  solidQuad(arrays, [[outer(start), top], [outer(end), top], [outer(end), -0.02], [outer(start), -0.02]], [out[0], 0, out[1]], EDGE_STONE.clone().multiplyScalar(0.85))
  solidQuad(arrays, [[end, FOOTPATH_TOP], [start, FOOTPATH_TOP], [start, top], [end, top]], [-out[0], 0, -out[1]], EDGE_STONE)
}

/** A face from the footpath down to the ground, where it ends against something lower. */
function pushSkirt(arrays: number[][], from: Vec, to: Vec) {
  const along = sub(to, from)
  const l = length(along) || 1
  const normal = [along[1] / l, 0, -along[0] / l]
  solidQuad(arrays, [[from, -0.02], [to, -0.02], [to, FOOTPATH_TOP], [from, FOOTPATH_TOP]], normal, EDGE_STONE.clone().multiplyScalar(0.8))
  // Both ways, as which side shows depends on where the road is.
  solidQuad(arrays, [[to, -0.02], [from, -0.02], [from, FOOTPATH_TOP], [to, FOOTPATH_TOP]], [-normal[0], 0, -normal[2]], EDGE_STONE.clone().multiplyScalar(0.8))
}

/** Dust blown off the footpath onto the soil: strong at the edge, fading out. */
function pushDustStrip(arrays: number[][], start: Vec, end: Vec, out: Vec) {
  const lift = 0.008
  const inner = (p: Vec) => add(p, out, STREET.edgeStone)
  const outer = (p: Vec) => add(p, out, STREET.edgeStone + STREET.dustWidth)
  const strong = [DUST.r, DUST.g, DUST.b, 0.55]
  const none = [DUST.r, DUST.g, DUST.b, 0]
  const points: [Vec, number[]][] = [[inner(start), strong], [inner(end), strong], [outer(end), none], [inner(start), strong], [outer(end), none], [outer(start), none]]
  const facesUp = (() => {
    const [a, b, c] = points.map((p) => p[0])
    return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0
  })()
  const ordered = facesUp ? points : [points[0], points[2], points[1], points[3], points[5], points[4]]
  for (const [[x, z], color] of ordered) corner(arrays, [x, lift, z], UP, color)
}

/** Darker, damp soil round a tree on the verge, from the water it's given. */
function pushDampPatch(arrays: number[][], [x, z]: Vec, variation: number) {
  const radius = 0.8 + variation * 0.4
  const sides = 12
  const damp = [PIT_SOIL.r, PIT_SOIL.g, PIT_SOIL.b]
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    const b = ((i + 1) / sides) * Math.PI * 2
    corner(arrays, [x, 0.009, z], UP, [...damp, 0.7])
    corner(arrays, [x + Math.cos(b) * radius, 0.009, z + Math.sin(b) * radius], UP, [...damp, 0])
    corner(arrays, [x + Math.cos(a) * radius, 0.009, z + Math.sin(a) * radius], UP, [...damp, 0])
  }
}

/** A square pit in the footpath round a tree: damp soil inside a frame of edge stone. */
function pushTreePit(arrays: number[][], centre: Vec, dir: Vec) {
  const side = left(dir)
  const half = STREET.treePit / 2
  const p = (u: number, v: number): Vec => add(add(centre, dir, u), side, v)
  const soilTop = FOOTPATH_TOP + 0.003
  const frameTop = FOOTPATH_TOP + 0.015
  solidQuad(arrays, [[p(-half, -half), soilTop], [p(half, -half), soilTop], [p(half, half), soilTop], [p(-half, half), soilTop]], UP, PIT_SOIL)
  const f = STREET.pitFrame
  for (const [u0, u1, v0, v1] of [
    [-half, half, -half, -half + f],
    [-half, half, half - f, half],
    [-half, -half + f, -half, half],
    [half - f, half, -half, half],
  ]) {
    solidQuad(arrays, [[p(u0, v0), frameTop], [p(u1, v0), frameTop], [p(u1, v1), frameTop], [p(u0, v1), frameTop]], UP, EDGE_STONE)
    }
}

// ---------------------------------------------------------------------------
// Decals: the marks share one picture, DECAL_COLUMNS across and DECAL_ROWS down (see groundTextures.ts).

type DecalKind = { cell: [number, number]; size: [number, number]; aspect: number; turns: boolean; lift: number }

export const DECAL = {
  tar: { cell: [0, 0], size: [0.8, 2.2], aspect: 1, turns: true, lift: 0.004 },
  /** Smaller oil stains, and a trail of drips that runs along the lane. */
  drop: { cell: [2, 0], size: [0.3, 0.75], aspect: 1, turns: true, lift: 0.0042 },
  spot: { cell: [3, 0], size: [0.35, 0.9], aspect: 1, turns: true, lift: 0.0044 },
  drips: { cell: [2, 1], size: [1.1, 2], aspect: 0.3, turns: false, lift: 0.0046 },
  crack: { cell: [1, 0], size: [1.2, 3], aspect: 1, turns: true, lift: 0.0035 },
  manhole: { cell: [0, 1], size: [0.75, 0.75], aspect: 1, turns: true, lift: 0.006 },
  patch: { cell: [1, 1], size: [2, 4.5], aspect: 0.55, turns: false, lift: 0.003 },
} satisfies Record<string, DecalKind>

function pushDecal(arrays: number[][], centre: Vec, dir: Vec, turn: number, kind: DecalKind, size: number) {
  const angle = Math.atan2(dir[1], dir[0]) + turn
  const u: Vec = [Math.cos(angle), Math.sin(angle)]
  const v = left(u)
  const halfU = size / 2
  const halfV = (size * kind.aspect) / 2
  const y = ROAD_HEIGHT + kind.lift
  const [cu, cv] = kind.cell
  const uv = (a: number, b: number) => [(cu + a) / DECAL_COLUMNS, 1 - (cv + 1 - b) / DECAL_ROWS]
  const p = (a: number, b: number): Vec => add(add(centre, u, (a * 2 - 1) * halfU), v, (b * 2 - 1) * halfV)
  const quad: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
  const facesUp = (() => {
    const [a, b, c] = [p(0, 0), p(1, 0), p(1, 1)]
    return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0
  })()
  const ordered = facesUp ? quad : [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]
  for (const [a, b] of ordered) {
    const [x, z] = p(a, b)
    corner(arrays, [x, y, z], UP, uv(a, b))
  }
}

/** A drift of a few dry leaves, each a small diamond, lying flat at `height`. */
function pushLeaves(arrays: number[][], [x, z]: Vec, random: () => number, height: number, count: number) {
  for (let i = 0; i < count; i++) {
    const cx = x + (random() - 0.5) * 0.35
    const cz = z + (random() - 0.5) * 0.35
    const angle = random() * Math.PI * 2
    const long = 0.05 + random() * 0.05
    const wide = long * 0.45
    const u: Vec = [Math.cos(angle), Math.sin(angle)]
    const v = left(u)
    const color = LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)]
    const rgba = [color.r, color.g, color.b, 0.95]
    const tip = (sign: number): Vec => [cx + u[0] * long * sign, cz + u[1] * long * sign]
    const side = (sign: number): Vec => [cx + v[0] * wide * sign, cz + v[1] * wide * sign]
    for (const [a, b, c] of [[tip(1), side(1), tip(-1)], [tip(-1), side(-1), tip(1)]] as [Vec, Vec, Vec][]) {
      const facesUp = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0
      for (const [px, pz] of facesUp ? [a, b, c] : [a, c, b]) corner(arrays, [px, height, pz], UP, rgba)
    }
  }
}
