import * as THREE from 'three'

/*
 * Writes many small vertex-coloured shapes straight into one geometry.
 *
 * The usual way, a new BoxGeometry per counter or bucket, then translate, rotate,
 * colour and merge, makes and throws away one three.js object, with its own
 * arrays, per part. With 300,000 parts across HSR's shops that took seconds. Here
 * each kind of shape is made once, at unit size, as a template; every copy is
 * scaled, turned and placed by arithmetic straight into growing arrays.
 *
 * Shapes are placed the way the world places them: scaled, moved in their own
 * frame, turned about the vertical, then moved to their spot on the map.
 */

type Template = { positions: Float32Array; normals: Float32Array }

const templates = new Map<string, Template>()

/** A shape's corners and normals, made once and kept. */
function templateOf(key: string, make: () => THREE.BufferGeometry): Template {
  let template = templates.get(key)
  if (!template) {
    const geometry = make().toNonIndexed()
    template = {
      positions: Float32Array.from(geometry.getAttribute('position').array),
      normals: Float32Array.from(geometry.getAttribute('normal').array),
    }
    geometry.dispose()
    templates.set(key, template)
  }
  return template
}

/** A unit box (1 × 1 × 1), centred on its middle. */
export const BOX = () => templateOf('box', () => new THREE.BoxGeometry(1, 1, 1))
/** A unit plane (1 × 1) facing +z, centred on its middle. */
export const PLANE = () => templateOf('plane', () => new THREE.PlaneGeometry(1, 1))
/** A cylinder of radius 1 and height 1, centred on its middle, its top `taper` times its bottom's radius. */
export const CYLINDER = (taper = 1, segments = 10) => {
  const rounded = Math.round(taper * 1000) / 1000
  return templateOf(`cylinder:${rounded}:${segments}`, () => new THREE.CylinderGeometry(rounded, 1, 1, segments))
}

/** Where a copy goes: its size, its offset in its own frame, its turn about the vertical, and its spot on the map. */
export type Placement = {
  scale: [number, number, number]
  offset: [number, number, number]
  rotation: number
  x: number
  z: number
}

export class ShapeWriter {
  private positions = new Float32Array(3 * 1024)
  private normals = new Float32Array(3 * 1024)
  private colors = new Float32Array(3 * 1024)
  private used = 0

  private grow(more: number) {
    const needed = (this.used + more) * 3
    if (needed <= this.positions.length) return
    let size = this.positions.length
    while (size < needed) size *= 2
    for (const name of ['positions', 'normals', 'colors'] as const) {
      const bigger = new Float32Array(size)
      bigger.set(this[name])
      this[name] = bigger
    }
  }

  /** Adds a copy of `template`, placed, in one colour. */
  add(template: Template, { scale, offset, rotation, x, z }: Placement, color: THREE.Color) {
    const count = template.positions.length / 3
    this.grow(count)
    const [sx, sy, sz] = scale
    const [ox, oy, oz] = offset
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const { positions, normals, colors } = this
    let at = this.used * 3
    for (let i = 0; i < count * 3; i += 3) {
      // Scaled and moved in the shape's own frame, then turned and moved onto the map.
      const px = template.positions[i] * sx + ox
      const py = template.positions[i + 1] * sy + oy
      const pz = template.positions[i + 2] * sz + oz
      positions[at] = px * cos + pz * sin + x
      positions[at + 1] = py
      positions[at + 2] = -px * sin + pz * cos + z
      // A normal is scaled by the inverse of the shape's scale, so a squashed or tapered shape still lights right.
      let nx = template.normals[i] / sx
      let ny = template.normals[i + 1] / sy
      let nz = template.normals[i + 2] / sz
      const length = Math.hypot(nx, ny, nz) || 1
      nx /= length
      ny /= length
      nz /= length
      normals[at] = nx * cos + nz * sin
      normals[at + 1] = ny
      normals[at + 2] = -nx * sin + nz * cos
      colors[at] = color.r
      colors[at + 1] = color.g
      colors[at + 2] = color.b
      at += 3
    }
    this.used += count
  }

  /** Adds a finished geometry as it stands, for the odd shape no template fits. It's disposed. */
  addGeometry(geometry: THREE.BufferGeometry, color: THREE.Color) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    const position = flat.getAttribute('position')
    const normal = flat.getAttribute('normal')
    this.grow(position.count)
    for (let i = 0; i < position.count; i++) {
      const at = (this.used + i) * 3
      this.positions[at] = position.getX(i)
      this.positions[at + 1] = position.getY(i)
      this.positions[at + 2] = position.getZ(i)
      this.normals[at] = normal.getX(i)
      this.normals[at + 1] = normal.getY(i)
      this.normals[at + 2] = normal.getZ(i)
      this.colors[at] = color.r
      this.colors[at + 1] = color.g
      this.colors[at + 2] = color.b
    }
    this.used += position.count
    if (flat !== geometry) flat.dispose()
    geometry.dispose()
  }

  get isEmpty() {
    return this.used === 0
  }

  /** Everything written so far, as one geometry with positions, normals and colours. */
  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions.slice(0, this.used * 3), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals.slice(0, this.used * 3), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors.slice(0, this.used * 3), 3))
    geometry.computeBoundingSphere()
    return geometry
  }
}

const colorCache = new Map<string, THREE.Color>()

/** A colour from a CSS string, made once and kept. */
export function colorOf(css: string): THREE.Color {
  let color = colorCache.get(css)
  if (!color) {
    color = new THREE.Color(css)
    colorCache.set(css, color)
  }
  return color
}
