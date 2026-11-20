import * as THREE from 'three'
import type { VehicleKind } from './trafficLogic'

/*
 * Traffic's lamps: tail lamps, brake lamps, headlamps and indicators, as part of each vehicle's own
 * shape and lit by its own material. Nothing is drawn separately for them, so they turn, tilt, fall
 * over and change level of detail with the vehicle, and cost no draw calls.
 *
 * Every vehicle shape gets a number on each corner, `aLamp`: 0 for the body, and for a lamp which
 * one it is (`LAMP`). Where a model has its lamps modelled (the four cars' tail and head clusters,
 * the bus's lamps) those corners are found by where they are (`CLUSTERS`), and on a car the outer
 * part of each cluster is its indicator, as on a real one. Where it hasn't (an auto, a two-wheeler,
 * the far-away stand-ins), small lamp shapes are added, set into the body where they belong:
 * wedges on cars, squares on the bus, round lamps on autos and two-wheelers.
 *
 * The body's material then makes those corners glow (`addLampGlow`): tail lamps deep red, dim by
 * day and brighter at night, much brighter on the brakes; headlamps warm white, at night;
 * indicators amber, when they're flashing. The glow is bright enough for the picture's own bloom
 * to give it a soft edge. Each copy of a vehicle says what its lamps are doing in `aSignal`.
 */

export const LAMP = { body: 0, tail: 1, head: 2, left: 3, right: 4 } as const

/** A lamp's own colour unlit: a deep red lens, a clear one, an amber one. */
const LENS: Record<number, string> = { [LAMP.tail]: '#5c0f0f', [LAMP.head]: '#dcd9cc', [LAMP.left]: '#8a4a12', [LAMP.right]: '#8a4a12' }

/** Night, from 0 to 1, for every vehicle's lamps: Traffic.tsx keeps it. */
export const lampUniforms = { uLampNight: { value: 0 } }

/**
 * Where the lamps go on a kind of vehicle when its model has none of its own: how far out from the
 * middle (0 for one lamp in the middle), how high, and how big (width and height, or a round
 * lamp's radius twice), in metres. Indicators sit `out` metres further out than the lamp beside
 * them, or where `at` says.
 */
type Layout = {
  round: boolean
  tail: { x: number; y: number; size: [number, number] }
  head: { x: number; y: number; size: [number, number] }
  indicator: { rear: [number, number]; front: [number, number]; size: number }
}
const LAYOUTS: Record<VehicleKind, Layout> = {
  sedan: { round: false, tail: { x: 0.6, y: 0.78, size: [0.24, 0.1] }, head: { x: 0.6, y: 0.68, size: [0.26, 0.1] }, indicator: { rear: [0.76, 0.78], front: [0.78, 0.68], size: 0.08 } },
  hatchback: { round: false, tail: { x: 0.58, y: 0.95, size: [0.2, 0.12] }, head: { x: 0.58, y: 0.72, size: [0.26, 0.11] }, indicator: { rear: [0.72, 0.95], front: [0.74, 0.72], size: 0.08 } },
  suv: { round: false, tail: { x: 0.68, y: 1.0, size: [0.2, 0.14] }, head: { x: 0.66, y: 0.9, size: [0.26, 0.12] }, indicator: { rear: [0.82, 1.0], front: [0.82, 0.9], size: 0.09 } },
  mpv: { round: false, tail: { x: 0.64, y: 1.2, size: [0.18, 0.16] }, head: { x: 0.62, y: 0.78, size: [0.26, 0.11] }, indicator: { rear: [0.78, 1.2], front: [0.78, 0.78], size: 0.08 } },
  auto: { round: true, tail: { x: 0.45, y: 0.58, size: [0.09, 0.09] }, head: { x: 0, y: 0.9, size: [0.15, 0.15] }, indicator: { rear: [0.45, 0.72], front: [0.34, 0.8], size: 0.07 } },
  bike: { round: true, tail: { x: 0, y: 0.8, size: [0.08, 0.08] }, head: { x: 0, y: 0.92, size: [0.13, 0.13] }, indicator: { rear: [0.13, 0.76], front: [0.17, 0.9], size: 0.05 } },
  bus: { round: false, tail: { x: 1.05, y: 0.86, size: [0.16, 0.16] }, head: { x: 0.98, y: 0.81, size: [0.3, 0.18] }, indicator: { rear: [0.84, 0.81], front: [1.19, 0.81], size: 0.11 } },
}

/**
 * Where a model's own lamp clusters are, for the vehicles that have them modelled: how far out
 * from the middle and how high, in metres, at the back and at the front. Measured from the models
 * (their lamps are every colour from clear to near black, so colour doesn't find them: the place
 * does). `split`: the outer part of each cluster is its indicator, as on a car; without it,
 * indicators are added beside the lamps.
 */
type Clusters = { rear: { x: [number, number]; y: [number, number] }; front: { x: [number, number]; y: [number, number] }; split: boolean }
const CLUSTERS: Partial<Record<VehicleKind, Clusters>> = {
  sedan: { rear: { x: [0.48, 1], y: [0.76, 1.05] }, front: { x: [0.48, 1], y: [0.6, 0.9] }, split: true },
  hatchback: { rear: { x: [0.48, 0.8], y: [0.76, 1.2] }, front: { x: [0.3, 0.8], y: [0.6, 0.9] }, split: true },
  suv: { rear: { x: [0.5, 1.05], y: [1, 1.65] }, front: { x: [0.45, 1.05], y: [0.88, 1.08] }, split: true },
  mpv: { rear: { x: [0.5, 1], y: [0.9, 1.2] }, front: { x: [0.45, 1], y: [0.72, 0.92] }, split: true },
  // The bus's are plain slabs (bus.ts): too few corners to divide.
  bus: { rear: { x: [0.9, 1.2], y: [0.7, 0.92] }, front: { x: [0.8, 1.16], y: [0.7, 0.92] }, split: false },
}
/** A cluster is looked for within this far of the vehicle's end, in metres; with fewer corners than `few` there's no lamp there to use; the outer `outer` of a divided cluster is its indicator. */
const CLUSTER = { deep: 0.45, few: 8, outer: 0.3 }
/** A lamp shape is this deep, and stands this far proud of the body it's set into, in metres. */
const LAMP_DEPTH = 0.03
const LAMP_PROUD = 0.012


/**
 * A copy of a vehicle's shape with its lamps marked (`aLamp`), and added where it had none. `far`:
 * a far-away stand-in, which gets plain tail and head lamps only.
 */
export function withLamps(source: THREE.BufferGeometry, kind: VehicleKind, far = false): THREE.BufferGeometry {
  const layout = LAYOUTS[kind]
  const position = source.getAttribute('position')
  const paint = source.getAttribute('_paint')
  const count = position.count
  let back = Infinity
  let front = -Infinity
  for (let i = 0; i < count; i++) {
    back = Math.min(back, position.getZ(i))
    front = Math.max(front, position.getZ(i))
  }
  const length = front - back
  /** Which lamp each corner would be, by where it is. A triangle is a lamp's only if all three of its corners are. */
  const wanted = new Float32Array(count)
  const lamp = new Float32Array(count)

  // The model's own lamps, by where they are: never the paint.
  const clusters = far ? undefined : CLUSTERS[kind]
  const tails: number[] = []
  const heads: number[] = []
  if (clusters) {
    const within = (value: number, [low, high]: [number, number]) => value >= low && value <= high
    for (let i = 0; i < count; i++) {
      if (paint && paint.getX(i) > 0.5) continue
      const x = Math.abs(position.getX(i))
      const y = position.getY(i)
      const z = position.getZ(i)
      if (z < back + CLUSTER.deep && within(x, clusters.rear.x) && within(y, clusters.rear.y)) tails.push(i)
      else if (z > front - CLUSTER.deep && within(x, clusters.front.x) && within(y, clusters.front.y)) heads.push(i)
    }
  }
  /** Marks a found cluster, its outer share on each side as that side's indicator. True if it had indicators to give. */
  const mark = (corners: number[], kind: number): boolean => {
    const reach = [0, 0]
    const inner = [Infinity, Infinity]
    for (const i of corners) {
      const x = position.getX(i)
      const side = x > 0 ? 0 : 1
      reach[side] = Math.max(reach[side], Math.abs(x))
      inner[side] = Math.min(inner[side], Math.abs(x))
    }
    const split = clusters?.split === true
    for (const i of corners) {
      const x = position.getX(i)
      const side = x > 0 ? 0 : 1
      const outer = split && Math.abs(x) > reach[side] - (reach[side] - inner[side]) * CLUSTER.outer
      // The vehicle's left is +x.
      wanted[i] = outer ? (side === 0 ? LAMP.left : LAMP.right) : kind
    }
    return split
  }
  const hasTail = tails.length >= CLUSTER.few
  const hasHead = heads.length >= CLUSTER.few
  const tailIndicators = hasTail && mark(tails, LAMP.tail)
  const headIndicators = hasHead && mark(heads, LAMP.head)

  // Whole triangles only: a big triangle of the boot lid with one corner in the cluster isn't lamp.
  // A lamp's triangles get corners of their own (copies), so the body's corners beside them stay body.
  const copies: { from: number; kind: number }[] = []
  let index: Uint32Array | null = null
  const kindOf = (a: number, b: number, c: number) => (wanted[a] === wanted[b] || wanted[a] === wanted[c] ? wanted[a] : wanted[b] === wanted[c] ? wanted[b] : wanted[a])
  if (source.index) {
    index = Uint32Array.from(source.index.array)
    const copyOf = new Map<number, number>()
    for (let t = 0; t + 2 < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]]
      if (!wanted[a] || !wanted[b] || !wanted[c]) continue
      const kind = kindOf(a, b, c)
      for (let corner = 0; corner < 3; corner++) {
        const from = index[t + corner]
        const key = from * 8 + kind
        let copy = copyOf.get(key)
        if (copy === undefined) {
          copy = count + copies.length
          copyOf.set(key, copy)
          copies.push({ from, kind })
        }
        index[t + corner] = copy
      }
    }
  } else {
    for (let t = 0; t + 2 < count; t += 3) {
      if (wanted[t] && wanted[t + 1] && wanted[t + 2]) lamp[t] = lamp[t + 1] = lamp[t + 2] = kindOf(t, t + 1, t + 2)
    }
  }

  // Where the body's surface is at a place on its back or front, so a lamp added there sits in it.
  const surface = (x: number, y: number, halfWidth: number, halfHeight: number, rear: boolean): number => {
    for (const widen of [1, 3, 8]) {
      let found = rear ? Infinity : -Infinity
      for (let i = 0; i < count; i++) {
        if (Math.abs(position.getX(i) - x) > halfWidth * widen + 0.03 || Math.abs(position.getY(i) - y) > halfHeight * widen + 0.03) continue
        const z = position.getZ(i)
        // Only what's at that end of the vehicle: not the far side of a hollow shape.
        if (rear ? z > back + length * 0.35 : z < front - length * 0.35) continue
        found = rear ? Math.min(found, z) : Math.max(found, z)
      }
      if (Number.isFinite(found)) return found
    }
    return rear ? back : front
  }

  const added: { shape: THREE.BufferGeometry; kind: number }[] = []
  const add = (kind: number, x: number, y: number, [width, height]: [number, number], rear: boolean, wedge = false) => {
    const at = surface(x, y, width / 2, height / 2, rear)
    const z = at + (rear ? -1 : 1) * (LAMP_PROUD - LAMP_DEPTH / 2)
    const shape = layout.round
      ? new THREE.CylinderGeometry(width / 2, width / 2, LAMP_DEPTH, 12).rotateX(Math.PI / 2)
      : new THREE.BoxGeometry(width, height, LAMP_DEPTH)
    added.push({ shape: shape.translate(x, y, z), kind })
    // A car's cluster wraps up at its outer end: an upright piece there makes the wedge.
    if (wedge) {
      const outer = x + Math.sign(x) * (width / 2 - 0.035)
      added.push({ shape: new THREE.BoxGeometry(0.07, height * 1.9, LAMP_DEPTH).translate(outer, y + height * 0.45, surface(outer, y + height * 0.45, 0.035, height, rear) + (rear ? -1 : 1) * (LAMP_PROUD - LAMP_DEPTH / 2)), kind })
    }
  }
  const eachSide = (x: number) => (x === 0 ? [0] : [x, -x])
  const car = !layout.round && kind !== 'bus'
  if (!hasTail) for (const x of eachSide(layout.tail.x)) add(LAMP.tail, x, layout.tail.y, layout.tail.size, true, car && !far)
  if (!hasHead) for (const x of eachSide(layout.head.x)) add(LAMP.head, x, layout.head.y, layout.head.size, false, false)
  if (!far) {
    const { rear, front: ahead, size } = layout.indicator
    if (!tailIndicators) for (const x of [rear[0], -rear[0]]) add(x > 0 ? LAMP.left : LAMP.right, x, rear[1], [size, size], true)
    if (!headIndicators) for (const x of [ahead[0], -ahead[0]]) add(x > 0 ? LAMP.left : LAMP.right, x, ahead[1], [size, size], false)
  }

  return merge(source, lamp, copies, index, added)
}

/**
 * The source's shape with its lamps' own corners (`copies`) and the lamp shapes joined on, every
 * attribute carried over, and `aLamp` on all of it. Tail lamps and indicators take the lens colour,
 * whatever the model painted them; headlamps keep the model's.
 */
function merge(source: THREE.BufferGeometry, lamp: Float32Array, copies: { from: number; kind: number }[], sourceIndex: Uint32Array | null, added: { shape: THREE.BufferGeometry; kind: number }[]): THREE.BufferGeometry {
  const indexed = sourceIndex !== null
  const shapes = added.map(({ shape, kind }) => ({ shape: indexed ? shape : shape.toNonIndexed(), kind }))
  const base = source.getAttribute('position').count
  const extra = copies.length + shapes.reduce((sum, { shape }) => sum + shape.getAttribute('position').count, 0)
  const merged = new THREE.BufferGeometry()
  const lamps = new Float32Array(base + extra)
  lamps.set(lamp)
  const lens = new THREE.Color()
  const tinted = (kind: number) => kind !== LAMP.head && kind !== LAMP.body

  for (const name of Object.keys(source.attributes)) {
    const from = source.getAttribute(name) as THREE.BufferAttribute
    const Kind = from.array.constructor as new (length: number) => THREE.TypedArray
    const array = new Kind((base + extra) * from.itemSize)
    array.set(from.array.subarray(0, base * from.itemSize))
    const to = new THREE.BufferAttribute(array, from.itemSize, from.normalized)
    // A lamp found on a shape with no corners to spare (not indexed) is coloured where it is.
    if (name === 'color') {
      for (let i = 0; i < base; i++) {
        if (!tinted(lamp[i])) continue
        lens.set(LENS[lamp[i]])
        to.setXYZ(i, lens.r, lens.g, lens.b)
      }
    }
    let at = base
    for (const { from: corner, kind } of copies) {
      for (let part = 0; part < from.itemSize; part++) to.setComponent(at, part, from.getComponent(corner, part))
      if (name === 'color' && tinted(kind)) {
        lens.set(LENS[kind])
        to.setXYZ(at, lens.r, lens.g, lens.b)
      }
      lamps[at] = kind
      at++
    }
    for (const { shape, kind } of shapes) {
      const part = shape.getAttribute(name)
      const size = shape.getAttribute('position').count
      lens.set(LENS[kind])
      for (let i = 0; i < size; i++) {
        // The shape's own place and facing; the lens colour; nothing else (no paint, no limb).
        if (name === 'color') to.setXYZ(at + i, lens.r, lens.g, lens.b)
        else if (part && (name === 'position' || name === 'normal')) to.setXYZ(at + i, part.getX(i), part.getY(i), part.getZ(i))
        lamps[at + i] = kind
      }
      at += size
    }
    merged.setAttribute(name, to)
  }
  merged.setAttribute('aLamp', new THREE.BufferAttribute(lamps, 1))

  if (sourceIndex) {
    const total = sourceIndex.length + shapes.reduce((sum, { shape }) => sum + (shape.index?.count ?? 0), 0)
    const index = base + extra > 65535 ? new Uint32Array(total) : new Uint16Array(total)
    index.set(sourceIndex)
    let at = sourceIndex.length
    let offset = base + copies.length
    for (const { shape } of shapes) {
      const part = shape.index
      if (part) for (let i = 0; i < part.count; i++) index[at++] = part.getX(i) + offset
      offset += shape.getAttribute('position').count
    }
    merged.setIndex(new THREE.BufferAttribute(index, 1))
  }
  for (const { shape } of shapes) shape.dispose()
  for (const { shape } of added) shape.dispose()
  merged.userData = source.userData
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

/**
 * How bright each lamp is, as a multiple of full white: `day` and `night` for tail lamps and
 * headlamps with nothing else going on, `brake` added on the brakes, and an indicator when lit.
 * Near 1 the bloom gives it a soft edge. The picture's tone curve turns a bright red towards pink
 * and orange (which is how the old lamps looked), so a brake lamp stays under 1 to stay red.
 */
const GLOW = { tailDay: 0.05, tailNight: 0.4, brake: 0.6, headDay: 0.05, headNight: 2.2, indicator: 1.0 }

/**
 * Adds the lamps' glow to a vehicle body's material. A lamp's triangles have corners of their own,
 * all the same lamp, so a lamp ends where its shape does.
 * `aSignal` is each copy's own: how hard it's braking (0 to 1), and whether its left and right
 * indicators are lit just now.
 */
export function addLampGlow(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, lampUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'attribute float aLamp;\nattribute vec3 aSignal;\nvarying float vLamp;\nvarying vec3 vSignal;\nvoid main() {\n  vLamp = aLamp;\n  vSignal = aSignal;')
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uLampNight;\nvarying float vLamp;\nvarying vec3 vSignal;\nvoid main() {')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  if (vLamp > 0.5) {
    if (vLamp < 1.5) totalEmissiveRadiance += vec3(1.0, 0.018, 0.008) * (mix(${GLOW.tailDay.toFixed(2)}, ${GLOW.tailNight.toFixed(2)}, uLampNight) + vSignal.x * ${GLOW.brake.toFixed(2)});
    else if (vLamp < 2.5) totalEmissiveRadiance += vec3(1.0, 0.93, 0.78) * mix(${GLOW.headDay.toFixed(2)}, ${GLOW.headNight.toFixed(2)}, uLampNight);
    else totalEmissiveRadiance += vec3(1.0, 0.4, 0.0) * ${GLOW.indicator.toFixed(2)} * (vLamp < 3.5 ? vSignal.y : vSignal.z);
  }`,
    )
}
