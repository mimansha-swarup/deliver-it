import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * A city bus for the main roads (streetPresets.ts), built in code with real
 * proportions and simplified parts (ART_DIRECTION.md): 11.2 m long, 2.5 m wide,
 * 3.05 m tall, doors on the left as Indian buses have them. The livery is made
 * up: a painted lower body (`_paint` 1, so each bus takes a colour from its
 * palette) under a cream band, with no operator's name, logo or route board text.
 * Facing +Z, like all traffic. The wheels are part of the shape: a bus's wheels
 * are big and slow, and nobody watches them turn.
 */

type Vec = [number, number, number]

const HALF_LENGTH = 5.6
const HALF_WIDTH = 1.25
const ROOF = 3.05
const GLASS = '#1d2329'
const CREAM = '#e6dcc4'
const DARK = '#25262a'
const GRIME = '#3d3a35'
const TYRE = '#151618'
const RIM = '#8d9095'
const LAMP = '#f2efe2'
const TAIL = '#a8231b'
const BOARD = '#121314'
const BOARD_GLOW = '#d98a1c'
/** The painted part is white in the shape, and takes each bus's colour. */
const PAINT = '#ffffff'

function finish(geometry: THREE.BufferGeometry, color: string, painted: boolean): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.deleteAttribute('uv')
  const count = flat.getAttribute('position').count
  const { r, g, b } = new THREE.Color(color)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  flat.setAttribute('_paint', new THREE.BufferAttribute(new Float32Array(count).fill(painted ? 1 : 0), 1))
  return flat
}

/** A box from `min` to `max`. */
function slab(min: Vec, max: Vec, color: string, painted = false): THREE.BufferGeometry {
  const size: Vec = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const centre: Vec = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2]
  return finish(new THREE.BoxGeometry(...size).translate(...centre), color, painted)
}

function wheel(x: number, z: number, radius: number, width: number): THREE.BufferGeometry[] {
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 14).rotateZ(Math.PI / 2).translate(x, radius, z)
  const rim = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 10).rotateZ(Math.PI / 2).translate(x, radius, z)
  return [finish(tyre, TYRE, false), finish(rim, RIM, false)]
}

/**
 * The bus from its model (models/fleet.glb, made by scripts/prepare_traffic_models.mjs at this
 * bus's length, its livery band marked `_paint`), with the wheels the model doesn't have put in its
 * arches. The same attributes as the built bus below, which it stands in for.
 */
export function createBusFromModel(model: THREE.BufferGeometry, arches: { z: number }[]): THREE.BufferGeometry {
  const flat = model.index ? model.toNonIndexed() : model.clone()
  const body = repaintBus(flat)
  flat.dispose()
  const L = HALF_LENGTH
  const W = HALF_WIDTH
  const parts = [
    body,
    // Set just proud of the model's own ends, which the livery leaves plain: the screen, the
    // destination board, bumpers, lamps and the engine grille, each a clean flat panel.
    slab([-W + 0.16, 1.38, L - 0.05], [W - 0.16, 2.42, L + 0.035], GLASS),
    slab([-W + 0.3, 2.52, L - 0.05], [W - 0.3, 2.84, L + 0.04], BOARD),
    slab([-W + 0.45, 2.6, L], [W - 0.95, 2.76, L + 0.05], BOARD_GLOW),
    slab([-W + 0.04, 0.36, L - 0.12], [W - 0.04, 0.62, L + 0.07], DARK),
    slab([-W + 0.14, 0.72, L - 0.05], [-W + 0.46, 0.9, L + 0.045], LAMP),
    slab([W - 0.46, 0.72, L - 0.05], [W - 0.14, 0.9, L + 0.045], LAMP),
    slab([-W + 0.04, 0.36, -L - 0.07], [W - 0.04, 0.62, -L + 0.12], DARK),
    slab([-W + 0.14, 0.72, -L - 0.045], [-W + 0.34, 0.9, -L + 0.05], TAIL),
    slab([W - 0.34, 0.72, -L - 0.045], [W - 0.14, 0.9, -L + 0.05], TAIL),
    slab([-0.62, 0.7, -L - 0.035], [0.62, 1.18, -L + 0.05], DARK),
    slab([-W + 0.3, 1.5, -L - 0.035], [W - 0.3, 2.3, -L + 0.05], GLASS),
  ]
  // The side windows: a row of panes down each side, with the pillars between them, and the two
  // doors on the left (the kerb side). The model's own windows were a few dark smears.
  const side = (flat.boundingBox ?? new THREE.Box3().setFromBufferAttribute(flat.getAttribute('position') as THREE.BufferAttribute)).max.x
  const doors = [L - 1.85, -0.95]
  for (let z = -L + 0.55; z < L - 0.75; z += 1.12) {
    for (const x of [-1, 1]) {
      if (x < 0 && doors.some((door) => z + 0.98 > door && z < door + 1.05)) continue
      parts.push(slab(x < 0 ? [-side - 0.02, 1.52, z] : [side - 0.03, 1.52, z], x < 0 ? [-side + 0.03, 2.32, z + 0.98] : [side + 0.02, 2.32, z + 0.98], GLASS))
    }
  }
  for (const door of doors) {
    parts.push(slab([-side - 0.025, 0.66, door], [-side + 0.03, 2.36, door + 1.05], DARK))
    for (const leaf of [0.06, 0.56]) parts.push(slab([-side - 0.035, 1.2, door + leaf], [-side + 0.03, 2.28, door + leaf + 0.43], GLASS))
  }
  for (const part of parts.slice(1)) part.computeVertexNormals()
  for (const x of [-HALF_WIDTH + 0.2, HALF_WIDTH - 0.2]) for (const { z } of arches) parts.push(...wheel(x, z, 0.5, 0.36))
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('The bus could not be put together')
  merged.computeBoundingSphere()
  return merged
}

/** The livery's lines, in metres up: grime below `sill`, paint to `belt`, a cream stripe to `stripe`, cream above. */
const LIVERY = { sill: 0.62, belt: 1.3, stripe: 1.4 }

/**
 * The bus model with a clean livery. Its own colours were sampled from a photo texture onto a few
 * thousand corners, so every stripe and the whole front came out as smears. Here its shape is
 * kept and its paint redone: each triangle is cut along the livery's lines (so the lines are
 * straight whatever the mesh), and each piece is one flat colour by its height: grime, the paint
 * (which takes each bus's colour), a stripe, cream. Windows, doors and both ends are left plain,
 * for the panels `createBusFromModel` puts over them.
 */
function repaintBus(flat: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = flat.getAttribute('position')
  const normal = flat.getAttribute('normal')
  type Corner = { p: Vec; n: Vec }
  const out = { position: [] as number[], normal: [] as number[], color: [] as number[], paint: [] as number[] }
  const tones = { cream: new THREE.Color(CREAM), grime: new THREE.Color(GRIME), paint: new THREE.Color(PAINT), roof: new THREE.Color('#cfc8b6') }
  const lerp = (a: Corner, b: Corner, t: number): Corner => ({
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    n: [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t],
  })
  /** The part of a polygon above (or below) a height. */
  const clip = (polygon: Corner[], height: number, above: boolean): Corner[] => {
    const result: Corner[] = []
    polygon.forEach((a, index) => {
      const b = polygon[(index + 1) % polygon.length]
      const aIn = above ? a.p[1] >= height : a.p[1] < height
      const bIn = above ? b.p[1] >= height : b.p[1] < height
      if (aIn) result.push(a)
      if (aIn !== bIn) result.push(lerp(a, b, (height - a.p[1]) / (b.p[1] - a.p[1])))
    })
    return result
  }
  const emit = (polygon: Corner[], tone: THREE.Color, painted: boolean) => {
    for (let i = 1; i < polygon.length - 1; i++) {
      for (const corner of [polygon[0], polygon[i], polygon[i + 1]]) {
        out.position.push(...corner.p)
        out.normal.push(...corner.n)
        out.color.push(tone.r, tone.g, tone.b)
        out.paint.push(painted ? 1 : 0)
      }
    }
  }
  const bands: [number, number, THREE.Color, boolean][] = [
    [-Infinity, LIVERY.sill, tones.grime, false],
    [LIVERY.sill, LIVERY.belt, tones.paint, true],
    [LIVERY.belt, LIVERY.stripe, tones.cream, false],
    [LIVERY.stripe, Infinity, tones.cream, false],
  ]
  for (let first = 0; first < position.count; first += 3) {
    const corners: Corner[] = [0, 1, 2].map((i) => ({
      p: [position.getX(first + i), position.getY(first + i), position.getZ(first + i)],
      n: [normal.getX(first + i), normal.getY(first + i), normal.getZ(first + i)],
    }))
    const middleY = (corners[0].p[1] + corners[1].p[1] + corners[2].p[1]) / 3
    const upward = (corners[0].n[1] + corners[1].n[1] + corners[2].n[1]) / 3
    // The roof's top is a duller cream, weathered.
    if (upward > 0.7 && middleY > 2.6) {
      emit(corners, tones.roof, false)
      continue
    }
    for (const [from, to, tone, painted] of bands) {
      let piece = corners
      if (from > -Infinity) piece = clip(piece, from, true)
      if (to < Infinity && piece.length >= 3) piece = clip(piece, to, false)
      if (piece.length >= 3) emit(piece, tone, painted)
    }
  }
  const body = new THREE.BufferGeometry()
  body.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3))
  body.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3))
  body.setAttribute('color', new THREE.Float32BufferAttribute(out.color, 3))
  body.setAttribute('_paint', new THREE.Float32BufferAttribute(out.paint, 1))
  return body
}

export function createBusGeometry(): THREE.BufferGeometry {
  const L = HALF_LENGTH
  const W = HALF_WIDTH
  const parts: THREE.BufferGeometry[] = [
    // The painted lower body, and road grime along its bottom edge.
    slab([-W, 0.42, -L], [W, 1.35, L], PAINT, true),
    slab([-W - 0.005, 0.42, -L - 0.005], [W + 0.005, 0.6, L + 0.005], GRIME),
    // The window band, set a little in, and the cream band and roof above it.
    slab([-W + 0.03, 1.35, -L + 0.05], [W - 0.03, 2.45, L - 0.05], GLASS),
    slab([-W, 2.45, -L], [W, ROOF - 0.08, L], CREAM),
    slab([-W + 0.06, ROOF - 0.08, -L + 0.2], [W - 0.06, ROOF, L - 0.4], '#cfc8b6'),
    // A cream stripe under the windows, as most liveries have.
    slab([-W - 0.006, 1.3, -L - 0.006], [W + 0.006, 1.38, L + 0.006], CREAM),
    // The front: the screen over the dashboard, the destination board, the bumper and lamps.
    slab([-W + 0.08, 1.15, L - 0.02], [W - 0.08, 2.4, L + 0.01], GLASS),
    slab([-W + 0.25, 2.5, L], [W - 0.25, 2.85, L + 0.03], BOARD),
    slab([-W + 0.4, 2.6, L + 0.02], [W - 0.9, 2.75, L + 0.04], BOARD_GLOW),
    slab([-W - 0.02, 0.35, L - 0.1], [W + 0.02, 0.62, L + 0.08], DARK),
    slab([-W + 0.12, 0.72, L], [-W + 0.42, 0.9, L + 0.03], LAMP),
    slab([W - 0.42, 0.72, L], [W - 0.12, 0.9, L + 0.03], LAMP),
    // The back: bumper, tail lamps and the engine grille.
    slab([-W - 0.02, 0.35, -L - 0.08], [W + 0.02, 0.62, -L + 0.1], DARK),
    // Small square lamps, low, as a city bus has: they light with the rest of the traffic's (vehicleLamps.ts).
    slab([-W + 0.12, 0.72, -L - 0.03], [-W + 0.3, 0.9, -L], TAIL),
    slab([W - 0.3, 0.72, -L - 0.03], [W - 0.12, 0.9, -L], TAIL),
    slab([-0.6, 0.7, -L - 0.02], [0.6, 1.2, -L], DARK),
  ]
  // Window pillars down both sides.
  for (let z = -L + 0.6; z < L - 0.5; z += 1.15) {
    for (const x of [-W, W - 0.04]) parts.push(slab([x, 1.35, z], [x + 0.04, 2.45, z + 0.09], CREAM))
  }
  // Two doors on the left, the kerb side: dark glass from the step up.
  for (const z of [L - 1.8, -0.9]) parts.push(slab([-W - 0.01, 0.5, z], [-W + 0.02, 2.4, z + 1.05], GLASS))
  // Wheels: the front pair, and a wide rear pair.
  for (const x of [-W + 0.22, W - 0.22]) {
    parts.push(...wheel(x, L - 2.0, 0.5, 0.3))
    parts.push(...wheel(x, -L + 3.1, 0.5, 0.42))
  }
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Could not build a bus')
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}
