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
