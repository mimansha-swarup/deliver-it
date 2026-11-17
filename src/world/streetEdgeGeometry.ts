import * as THREE from 'three'
import { chunkKey } from './chunks'
import type { Gate } from './houseKit'
import type { LineFeature } from './mapData'
import { createRandom, distanceToPiece, forEachRoadNear, nearestRoadEdge, nearestRoadPiece, type Prop, type RoadIndex, type RoadPiece } from './props'
import { DECAL_COLUMNS, DECAL_ROWS, FOOTPATH_TOP, KERB_TOP, STREET, usesNewGround } from './streetEdgeConfig'
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
  values.forEach((value, i) => arrays[i].push(...value))
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
}

type Arm = { dir: Vec; half: number; length: number; road: number }

/** Corners narrower or wider than these, in radians, aren't rounded. */
const MIN_CORNER = (45 * Math.PI) / 180
const MAX_CORNER = (150 * Math.PI) / 180

function arcPoint(corner: Corner, part: number): Vec {
  const angle = corner.startAngle + corner.sweep * part
  return [corner.centre[0] + Math.cos(angle) * corner.radius, corner.centre[1] + Math.sin(angle) * corner.radius]
}

function arcSteps(corner: Corner): number {
  return Math.max(4, Math.ceil((Math.abs(corner.sweep) * corner.radius) / 0.3))
}

function makeCorner(node: Vec, a: Arm, b: Arm, radius: number, roads: LineFeature[], index: RoadIndex): Corner | null {
  const sideA = left(a.dir)
  const sideB = right(b.dir)
  const footpath = STREET.footpath
  // The corner's centre sits `radius` beyond both road edges.
  const t = meet(add(node, sideA, a.half + radius), a.dir, add(node, sideB, b.half + radius), b.dir)
  const s = meet(add(node, sideB, b.half + radius), b.dir, add(node, sideA, a.half + radius), a.dir)
  if (t === null || s === null || t <= 0 || s <= 0 || t > a.length - 0.3 || s > b.length - 0.3) return null

  const centre = add(add(node, sideA, a.half + radius), a.dir, t)
  const tangentA = add(add(node, sideA, a.half), a.dir, t)
  const tangentB = add(add(node, sideB, b.half), b.dir, s)
  const pointT = meet(add(node, sideA, a.half), a.dir, add(node, sideB, b.half), b.dir)
  const outerT = meet(add(node, sideA, a.half + footpath), a.dir, add(node, sideB, b.half + footpath), b.dir)
  if (pointT === null || outerT === null) return null
  const point = add(add(node, sideA, a.half), a.dir, pointT)
  const outer = add(add(node, sideA, a.half + footpath), a.dir, outerT)
  const outerA = add(tangentA, sideA, footpath)
  const outerB = add(tangentB, sideB, footpath)

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
  }
  const steps = arcSteps(corner)
  corner.web = [point, ...Array.from({ length: steps + 1 }, (_, i) => arcPoint(corner, i / steps))]

  // The corner's footpath must be clear of every road. Where a dual carriageway splits,
  // or a third road runs close, the "corner" between two arms is someone else's road.
  const kerbBack = (part: number): Vec => {
    const p = arcPoint(corner, part)
    const toCentre = sub(centre, p)
    return add(p, toCentre, (STREET.kerbWidth + 0.1) / length(toCentre))
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

  /** Whether a kerb at this point, on a road running `dir` with the footpath to `out`, is in front of a gate. */
  isInFront(point: Vec, dir: Vec, out: Vec): boolean {
    const cx = Math.floor(point[0] / GateIndex.CELL)
    const cz = Math.floor(point[1] / GateIndex.CELL)
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let z = cz - 1; z <= cz + 1; z++) {
        for (const gate of this.cells.get(`${x},${z}`) ?? []) {
          const offset = sub([gate.x, gate.z], point)
          const along = offset[0] * dir[0] + offset[1] * dir[1]
          const outward = offset[0] * out[0] + offset[1] * out[1]
          if (Math.abs(along) < gate.width / 2 + 0.3 && outward > 0 && outward < STREET.footpath + 6) return true
        }
      }
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Colours

const KERB_PAINT = [new THREE.Color('#1f2023'), new THREE.Color('#e3b021')]
const EDGE_STONE = new THREE.Color('#a29d93')
const PIT_SOIL = new THREE.Color('#8a4a2c')
const DUST = new THREE.Color('#c0794a')
/** Dry leaves in the gutter: a drift every so often along a kerb. */
const LEAF_SPACING = 1.4
const LEAF_CHANCE = 0.45
const LEAF_COLORS = ['#8a5a2a', '#b07a32', '#c99a3a', '#6f6a2a', '#9a4a22', '#7a6a3a'].map((color) => new THREE.Color(color))

/** Each block's paint is worn in its own way, from a hash of where it is. */
function wornPaint(stripe: number, at: Vec): THREE.Color {
  const wear = 0.8 + ((Math.abs(Math.round(at[0] * 3.7 + at[1] * 5.3)) % 7) / 7) * 0.2
  return KERB_PAINT[stripe].clone().multiplyScalar(wear)
}

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
}

/** Kerbs, footpaths and the rest are checked along each road edge at points this far apart, in metres. */
const STEP = 0.5
/** A kerb needs at least this much room behind it before the next road, in metres, and a run at least this long. */
const KERB_ROOM = 0.6
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

  const kerbs = new Layer({ position: 3, normal: 3, color: 3 })
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

    for (const sideSign of [1, -1]) {
      const out: Vec = sideSign > 0 ? left(dir) : right(dir)
      const at = (s: number, outward: number): Vec => add(add(piece.start, dir, s), out, half + outward)
      // How far the footpath can run out here before it meets another road, or the forecourt of a bunk.
      const footpathReach = (s: number): number => {
        const edge = at(s, 0)
        let reach = STREET.footpath
        const near = nearestOtherRoad(index, edge, piece, STREET.footpath + 1)
        if (near !== null) reach = Math.min(reach, near - STREET.kerbWidth)
        if (keepLow(...at(s, STREET.footpath / 2))) reach = 0
        return reach
      }
      const kerbAt = (s: number) => {
        const middle = at(s, STREET.kerbWidth / 2)
        const near = nearestOtherRoad(index, at(s, 0), piece, 1)
        // A kerb needs room behind it: a sliver between two carriageways is just road.
        return (near === null || near > STREET.kerbWidth + KERB_ROOM) && !cornerIndex.zoneAt(middle) && !keepLow(...at(s, STREET.footpath / 2))
      }

      // Kerb runs, then blocks along them, painted alternately, lowered in front of gates.
      const sideRuns = findRuns(kerbAt, pieceLength).filter(([from, to]) => to - from >= MIN_KERB_RUN)
      kerbRuns.set(sideSign, sideRuns)
      for (const [from, to] of sideRuns) {
        for (let s = from; s < to - 0.05; s += STREET.kerbBlock) {
          const end = Math.min(to, s + STREET.kerbBlock)
          const middle = add(piece.start, dir, (s + end) / 2)
          const stripe = Math.abs(Math.floor((s + piece.start[0] + piece.start[1]) / STREET.kerbBlock)) % 2
          const dropped = gateIndex.isInFront(at((s + end) / 2, 0), dir, out)
          const nextDropped = end < to - 0.05 && gateIndex.isInFront(at(Math.min(to, end + STREET.kerbBlock / 2), 0), dir, out)
          const previousDropped = s > from + 0.05 && gateIndex.isInFront(at(Math.max(from, s - STREET.kerbBlock / 2), 0), dir, out)
          // Ends only where a run starts or stops, or the height changes: alternating paint marks the blocks.
          const caps: [boolean, boolean] = [s <= from + 0.01 || previousDropped !== dropped, end >= to - 0.01 || nextDropped !== dropped]
          pushKerbBlock(kerbs.at(middle), at(s, 0), at(end, 0), out, dropped ? STREET.droppedRise : STREET.kerbRise, wornPaint(stripe, middle), caps)
        }
        // Dry leaves blown into the gutter along the kerb, in drifts.
        const leafRandom = createRandom(Math.abs(Math.round(piece.start[0] * 37 + piece.start[1] * 53 + sideSign * 11)))
        for (let s = from + 0.5; s < to - 0.5; s += LEAF_SPACING) {
          if (leafRandom() > LEAF_CHANCE) continue
          const centre = at(s + leafRandom(), -0.12 - leafRandom() * 0.22)
          pushLeaves(dust.at(centre), centre, leafRandom, ROAD_HEIGHT + 0.006, 3 + Math.floor(leafRandom() * 6))
        }
      }

      // The footpath: a band from the kerb's back, out as far as it can reach, level with the kerb top.
      const inCornerAt = (s: number) => cornerIndex.zoneAt(at(s, STREET.footpath / 2)) !== null
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
          pushFootpathQuad(footpaths.at(at(b.s, 0)), at(a.s, STREET.kerbWidth), at(b.s, STREET.kerbWidth), at(b.s, b.reach), at(a.s, a.reach), a.reach, b.reach)
          // Beside the soil, an edge stone and a strip of dust.
          if (a.reach >= STREET.footpath - 0.01 && b.reach >= STREET.footpath - 0.01) {
            pushEdgeStone(edgeStones.at(at(b.s, 0)), at(a.s, STREET.footpath - STREET.edgeStone), at(b.s, STREET.footpath - STREET.edgeStone), out)
            pushDustStrip(dust.at(at(b.s, 0)), at(a.s, STREET.footpath), at(b.s, STREET.footpath), out)
          }
        }
        // An end that meets a rounded corner carries on into it. Any other end gets a face down to the ground.
        for (const end of [samples[0], samples[samples.length - 1]]) {
          const beyond = end === samples[0] ? end.s - 0.2 : end.s + 0.2
          if (beyond > 0 && beyond < pieceLength && inCornerAt(beyond)) continue
          pushSkirt(edgeStones.at(at(end.s, 0)), at(end.s, STREET.kerbWidth), at(end.s, end.reach))
        }
      }
    }

    pushUnderlay(footpaths.at(piece.start), piece.start, piece.end, half)

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
    // Kerb blocks along the arc, painted like the straight ones.
    const arcLength = Math.abs(c.sweep) * c.radius
    const blocks = Math.max(1, Math.round(arcLength / STREET.kerbBlock))
    for (let block = 0; block < blocks; block++) {
      const stripe = block % 2
      const segments = Math.max(2, Math.ceil(steps / blocks))
      for (let k = 0; k < segments; k++) {
        const p0 = arcPoint(c, (block + k / segments) / blocks)
        const p1 = arcPoint(c, (block + (k + 1) / segments) / blocks)
        pushKerbSlice(kerbs.at(p0), p0, p1, towardCentre(p0), towardCentre(p1), STREET.kerbRise, wornPaint(stripe, arcPoint(c, (block + 0.5) / blocks)))
      }
    }
    // The footpath in the corner: from the kerb's back along the arc, out to the far corner.
    const arrays = footpaths.at(c.centre)
    const kerbBack = (part: number): Vec => {
      const p = arcPoint(c, part)
      return add(p, towardCentre(p), STREET.kerbWidth)
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

  // ---- Forecourts: paving from the footpath to the shops, where they stand back from it ----
  // Shops are grouped by the road piece and side they face, and neighbours along it join up.
  // Each run is a rectangle in the road's own frame: from the footpath's far edge out to the
  // deepest shop's wall. Where a wall stands nearer, the paving runs on under the building.
  type Forecourt = { start: Vec; dir: Vec; out: Vec; from: number; to: number; near: number; far: number }
  const forecourts: Forecourt[] = []
  const groups = new Map<string, { piece: RoadPiece; side: number; s0: number; s1: number; gap: number }[]>()
  for (const front of fronts) {
    const near = nearestRoadPiece(index, front.x, front.z, STREET.footpath + FORECOURT_MAX + 1)
    if (!near || !usesNewGround(roads[near.piece.road])) continue
    const gap = near.edge - STREET.footpath
    if (gap < 0.3 || gap > FORECOURT_MAX) continue
    const { piece } = near
    const along = sub(piece.end, piece.start)
    const dir: Vec = [along[0] / length(along), along[1] / length(along)]
    const rel = sub([front.x, front.z], piece.start)
    const s = rel[0] * dir[0] + rel[1] * dir[1]
    const side = rel[0] * -dir[1] + rel[1] * dir[0] > 0 ? 1 : -1
    const key = `${pieces.indexOf(piece)}:${side}`
    const list = groups.get(key) ?? []
    groups.set(key, list)
    list.push({ piece, side, s0: s - front.width / 2, s1: s + front.width / 2, gap })
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.s0 - b.s0)
    let run: (typeof list)[number] | null = null
    const close = () => {
      if (!run) return
      const { piece, side, s0, s1, gap } = run
      const along = sub(piece.end, piece.start)
      const dir: Vec = [along[0] / length(along), along[1] / length(along)]
      const out: Vec = side > 0 ? left(dir) : right(dir)
      const half = piece.width / 2
      forecourts.push({ start: piece.start, dir, out, from: s0 - 0.3, to: s1 + 0.3, near: half + STREET.footpath - 0.02, far: half + STREET.footpath + gap + 0.25 })
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
  const isOnForecourt = ([x, z]: Vec) =>
    forecourts.some((f) => {
      const rel = sub([x, z], f.start)
      const s = rel[0] * f.dir[0] + rel[1] * f.dir[1]
      const o = rel[0] * f.out[0] + rel[1] * f.out[1]
      return s >= f.from && s <= f.to && o >= f.near && o <= f.far
    })

  // ---- Trees: a pit with a frame and damp soil on the footpath, or damp soil round them on the verge ----
  for (const tree of trees) {
    const near = nearestRoadPiece(index, tree.x, tree.z, STREET.footpath + 6)
    if (!near || !usesNewGround(roads[near.piece.road])) continue
    const along = sub(near.piece.end, near.piece.start)
    const dir: Vec = [along[0] / length(along), along[1] / length(along)]
    if (near.edge > STREET.kerbWidth + 0.3 && near.edge < STREET.footpath - 0.3) {
      pushTreePit(pits.at([tree.x, tree.z]), [tree.x, tree.z], dir)
    } else if (near.edge >= STREET.footpath) {
      pushDampPatch(dust.at([tree.x, tree.z]), [tree.x, tree.z], tree.variation)
    }
  }

  // ---- Marks on the asphalt: tar patches, cracks, manholes and newer patches, every few metres ----
  for (const piece of newPieces) {
    const along = sub(piece.end, piece.start)
    const pieceLength = length(along)
    const dir: Vec = [along[0] / pieceLength, along[1] / pieceLength]
    const side = left(dir)
    const random = createRandom(Math.abs(Math.round(piece.start[0] * 131 + piece.start[1] * 71)) + 7)
    const half = piece.width / 2
    for (let s = 3; s < pieceLength - 3; s += 4) {
      const roll = random()
      const small = [DECAL.drop, DECAL.spot, DECAL.drips]
      const kind =
        roll < 0.09 ? DECAL.tar
        : roll < 0.22 ? small[Math.floor(random() * small.length)]
        : roll < 0.44 ? DECAL.crack
        : roll < 0.48 && half > 3 ? DECAL.manhole
        : roll < 0.55 ? DECAL.patch
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
      return fromCentre <= c.radius && fromCentre > c.radius - STREET.kerbWidth ? KERB_TOP : FOOTPATH_TOP
    }
    const near = nearestRoadPiece(index, x, z, STREET.footpath + 0.2)
    if (!near || !usesNewGround(roads[near.piece.road])) return isOnForecourt(point) ? FOOTPATH_TOP : null
    if (near.edge <= 0) return 'road'
    if (keepLow(x, z)) return null
    if (near.edge < STREET.kerbWidth) return KERB_TOP
    if (near.edge < STREET.footpath - STREET.edgeStone) return FOOTPATH_TOP
    if (near.edge < STREET.footpath) return FOOTPATH_TOP + STREET.edgeStoneRise
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
function solidTriangle(arrays: number[][], corners: SolidCorner[], color: THREE.Color) {
  const [a, b, c] = corners.map(([[x, z], y]) => new THREE.Vector3(x, y, z))
  const facing = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a))
  const normal = new THREE.Vector3()
  for (const [, , n] of corners) normal.add(new THREE.Vector3().fromArray(n))
  const ordered = facing.dot(normal) >= 0 ? corners : [corners[0], corners[2], corners[1]]
  for (const [[x, z], y, n] of ordered) corner(arrays, [x, y, z], n, [color.r, color.g, color.b])
}

/** Four corners in order round a face, all with one normal. */
function solidQuad(arrays: number[][], points: [Vec, number][], normal: number[], color: THREE.Color) {
  const [a, b, c, d] = points.map(([p, y]): SolidCorner => [p, y, normal])
  solidTriangle(arrays, [a, b, c], color)
  solidTriangle(arrays, [a, c, d], color)
}

/**
 * A straight kerb block, from `start` to `end` along the road edge, standing
 * `rise` above the road with its top edge bevelled on the road side. The
 * profile, from the road outward: a face up, the bevel, then the flat top.
 */
function pushKerbBlock(arrays: number[][], start: Vec, end: Vec, out: Vec, rise: number, color: THREE.Color, [capStart, capEnd]: [boolean, boolean]) {
  const base = ROAD_HEIGHT - 0.02
  const top = ROAD_HEIGHT + rise
  const bevel = Math.min(STREET.kerbBevel, rise * 0.6)
  const outward = (p: Vec, distance: number) => add(p, out, distance)
  const outNormal = [-out[0], 0, -out[1]]
  const bevelNormal = new THREE.Vector3(-out[0], 1, -out[1]).normalize().toArray()
  // Facing the road.
  solidQuad(arrays, [[start, base], [end, base], [end, top - bevel], [start, top - bevel]], outNormal, color)
  // The bevel.
  solidQuad(arrays, [[start, top - bevel], [end, top - bevel], [outward(end, bevel), top], [outward(start, bevel), top]], bevelNormal, color)
  // The top.
  solidQuad(arrays, [[outward(start, bevel), top], [outward(end, bevel), top], [outward(end, STREET.kerbWidth), top], [outward(start, STREET.kerbWidth), top]], UP, color)
  // The ends, so the joints between blocks read.
  const along = sub(end, start)
  const l = length(along)
  const endNormal = [along[0] / l, 0, along[1] / l]
  const startNormal = [-endNormal[0], 0, -endNormal[2]]
  for (const [p, normal, wanted] of [
    [end, endNormal, capEnd],
    [start, startNormal, capStart],
  ] as [Vec, number[], boolean][]) {
    if (!wanted) continue
    const pts: [Vec, number][] = [[p, base], [outward(p, STREET.kerbWidth), base], [outward(p, STREET.kerbWidth), top], [outward(p, bevel), top]]
    solidQuad(arrays, pts, normal, color)
    solidTriangle(arrays, [[p, base, normal], [outward(p, bevel), top, normal], [p, top - bevel, normal]], color)
  }
}

/** A thin slice of kerb round a corner: like a block, but its sides can turn, so slices make an arc. */
function pushKerbSlice(arrays: number[][], p0: Vec, p1: Vec, in0: Vec, in1: Vec, rise: number, color: THREE.Color) {
  const base = ROAD_HEIGHT - 0.02
  const top = ROAD_HEIGHT + rise
  const bevel = STREET.kerbBevel
  const face = (inward: Vec) => [-inward[0], 0, -inward[1]]
  const bevelNormal = (inward: Vec) => new THREE.Vector3(-inward[0], 1, -inward[1]).normalize().toArray()
  const quad = (points: SolidCorner[]) => {
    const [a, b, c, d] = points
    solidTriangle(arrays, [a, b, c], color)
    solidTriangle(arrays, [a, c, d], color)
  }
  quad([[p0, base, face(in0)], [p1, base, face(in1)], [p1, top - bevel, face(in1)], [p0, top - bevel, face(in0)]])
  quad([[p0, top - bevel, bevelNormal(in0)], [p1, top - bevel, bevelNormal(in1)], [add(p1, in1, bevel), top, bevelNormal(in1)], [add(p0, in0, bevel), top, bevelNormal(in0)]])
  quad([[add(p0, in0, bevel), top, UP], [add(p1, in1, bevel), top, UP], [add(p1, in1, STREET.kerbWidth), top, UP], [add(p0, in0, STREET.kerbWidth), top, UP]])
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
function pushUnderlay(arrays: number[][], start: Vec, end: Vec, half: number) {
  const along = sub(end, start)
  const l = length(along)
  const side = left([along[0] / l, along[1] / l])
  const reach = half + STREET.footpath
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
function pushFootpathQuad(arrays: number[][], a: Vec, b: Vec, c: Vec, d: Vec, reachA: number, reachB: number) {
  const farA = reachA >= STREET.footpath - 0.01 ? 1 : 0
  const farB = reachB >= STREET.footpath - 0.01 ? 1 : 0
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
