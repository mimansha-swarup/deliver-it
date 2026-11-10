import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { colored } from '../world/simpleShapes'

/** One slice through the car: where it is, how high its parts are, and its width there. */
type Station = { z: number; low: number; belt: number; top: number; width: number }

export type CarSpec = {
  stations: [z: number, low: number, belt: number, top: number, width: number][]
  halfWidth: number
  wheelBase: number
  wheelRadius: number
  /** The side windows, from the back to the front: bottom corners, then top corners. */
  windowBack: number
  windowBackTop: number
  windowFrontTop: number
  windowFront: number
  roofHeight: number
  /** Where the windscreen and the rear window are, seen from above. */
  windscreen: [from: number, to: number]
  rearWindow: [from: number, to: number]
  doorSplit: number
}

export const SEDAN: CarSpec = {
  stations: [
    [-2.12, 0.42, 0.72, 0.76, 0.82],
    [-2.03, 0.34, 0.84, 0.9, 0.96],
    [-1.7, 0.3, 0.9, 0.96, 1],
    [-1.3, 0.3, 0.92, 0.98, 1],
    [-1.05, 0.3, 0.93, 1.14, 1],
    [-0.75, 0.3, 0.93, 1.36, 1],
    [-0.3, 0.3, 0.93, 1.42, 1],
    [0.2, 0.3, 0.92, 1.4, 1],
    [0.55, 0.3, 0.91, 1.28, 1],
    [1, 0.3, 0.89, 0.98, 1],
    [1.5, 0.3, 0.84, 0.9, 0.98],
    [1.9, 0.32, 0.72, 0.78, 0.92],
    [2.09, 0.42, 0.6, 0.66, 0.8],
  ],
  halfWidth: 0.87,
  wheelBase: 1.3,
  wheelRadius: 0.31,
  windowBack: -1.1,
  windowBackTop: -0.72,
  windowFrontTop: 0.25,
  windowFront: 0.92,
  roofHeight: 1.37,
  windscreen: [0.28, 1],
  rearWindow: [-1.08, -0.72],
  doorSplit: -0.1,
}

export const HATCHBACK: CarSpec = {
  stations: [
    [-1.82, 0.42, 0.8, 1.12, 0.84],
    [-1.76, 0.34, 0.9, 1.4, 0.96],
    [-1.5, 0.3, 0.94, 1.5, 1],
    [-1, 0.3, 0.94, 1.52, 1],
    [-0.4, 0.3, 0.94, 1.52, 1],
    [0.15, 0.3, 0.93, 1.47, 1],
    [0.5, 0.3, 0.92, 1.3, 1],
    [0.95, 0.3, 0.9, 1, 1],
    [1.4, 0.32, 0.8, 0.86, 0.96],
    [1.68, 0.34, 0.68, 0.74, 0.9],
    [1.8, 0.44, 0.58, 0.62, 0.78],
  ],
  halfWidth: 0.84,
  wheelBase: 1.15,
  wheelRadius: 0.29,
  windowBack: -1.68,
  windowBackTop: -1.5,
  windowFrontTop: 0.15,
  windowFront: 0.9,
  roofHeight: 1.46,
  windscreen: [0.2, 0.94],
  rearWindow: [-1.8, -1.55],
  doorSplit: -0.35,
}

/** Rows of the texture, from 0 at the bottom. Each view of the car has its own band. */
const SIDE_BAND: [number, number] = [0.66, 1]
const TOP_BAND: [number, number] = [0.33, 0.66]
const END_BAND: [number, number] = [0, 0.33]
const TEXTURE_SIZE = 1024
const MAX_HEIGHT = 1.7
const POINTS_PER_SIDE = 8

function toStations(spec: CarSpec): Station[] {
  return spec.stations.map(([z, low, belt, top, width]) => ({ z, low, belt, top, width }))
}

function lengthOf(stations: Station[]) {
  return { back: stations[0].z, length: stations[stations.length - 1].z - stations[0].z }
}

/** The outline of one slice, from the middle underneath, up one side to the middle on top. */
function sliceOutline({ low, belt, top, width }: Station, halfWidth: number): [number, number][] {
  const side = halfWidth * width
  // The higher the roof here, the more the cabin leans in towards the top.
  const cabin = Math.max(0, Math.min(1, (top - belt - 0.08) / 0.4))
  const shoulder = side * (1 - cabin * 0.1)
  const roofEdge = side * (1 - cabin * 0.3)

  return [
    [0, low],
    [side * 0.86, low],
    [side, low + 0.12],
    [side, (low + belt) / 2],
    [side * 0.99, belt - 0.05],
    [shoulder, belt + (top - belt) * 0.25],
    [roofEdge, top - (top - belt) * 0.14],
    [roofEdge * 0.55, top],
    [0, top + 0.015],
  ]
}

/** Slices joined into a smooth skin, then cut into triangles that each know their corners. */
function createSkin(spec: CarSpec): THREE.BufferGeometry {
  const stations = toStations(spec)
  const ringSize = POINTS_PER_SIDE * 2 + 1
  const positions: number[] = []
  const index: number[] = []

  for (const station of stations) {
    const outline = sliceOutline(station, spec.halfWidth)
    const ring = [...outline.map(([x, y]) => [x, y]), ...outline.slice(1, -1).reverse().map(([x, y]) => [-x, y])]
    for (const [x, y] of ring) positions.push(x, y, station.z)
  }

  for (let slice = 0; slice < stations.length - 1; slice++) {
    for (let point = 0; point < ringSize - 1 + 1; point++) {
      const next = (point + 1) % (ringSize - 1)
      const a = slice * (ringSize - 1) + point % (ringSize - 1)
      const b = slice * (ringSize - 1) + next
      const c = (slice + 1) * (ringSize - 1) + point % (ringSize - 1)
      const d = (slice + 1) * (ringSize - 1) + next
      if (point === ringSize - 1) continue
      index.push(a, b, d, a, d, c)
    }
  }

  // Close both ends.
  const ring = ringSize - 1
  const lastSlice = (stations.length - 1) * ring
  for (let point = 1; point < ring - 1; point++) {
    index.push(0, point + 1, point)
    index.push(lastSlice, lastSlice + point, lastSlice + point + 1)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry.toNonIndexed()
}

/**
 * Wraps the painted image around the body like a blueprint: each triangle takes
 * the view it faces most, whether that's the side, the top, the front or the back.
 */
function applyBlueprintUvs(geometry: THREE.BufferGeometry, spec: CarSpec) {
  const { back, length } = lengthOf(toStations(spec))
  const position = geometry.getAttribute('position')
  const uvs = new Float32Array(position.count * 2)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const face = new THREE.Vector3()

  const band = ([start, end]: [number, number], amount: number) => start + (end - start) * amount

  for (let triangle = 0; triangle < position.count; triangle += 3) {
    a.fromBufferAttribute(position, triangle)
    b.fromBufferAttribute(position, triangle + 1)
    c.fromBufferAttribute(position, triangle + 2)
    face.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()

    for (let corner = 0; corner < 3; corner++) {
      const x = position.getX(triangle + corner)
      const y = position.getY(triangle + corner)
      const z = position.getZ(triangle + corner)
      const along = (z - back) / length
      const across = x / (spec.halfWidth * 2) + 0.5
      const height = y / MAX_HEIGHT

      let u = along
      let v = band(SIDE_BAND, height)
      if (Math.abs(face.y) > 0.72) {
        v = band(TOP_BAND, across)
      } else if (Math.abs(face.z) > 0.7) {
        u = (face.z > 0 ? 0.5 : 0) + across * 0.5
        v = band(END_BAND, height)
      }
      uvs[(triangle + corner) * 2] = u
      uvs[(triangle + corner) * 2 + 1] = v
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}

function wheelPart(
  x: number,
  z: number,
  radius: number,
  width: number,
  color: string,
): THREE.BufferGeometry {
  const part = new THREE.CylinderGeometry(radius, radius, width, 14)
  part.rotateZ(Math.PI / 2)
  part.translate(x, 0, z)
  const flat = colored(part.toNonIndexed(), color)
  flat.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array(flat.getAttribute('position').count * 2).fill(0.002), 2),
  )
  return flat
}

/** The whole car: a white, painted body that takes each car's colour, on real wheels. */
export function createCarGeometry(spec: CarSpec): THREE.BufferGeometry {
  const skin = createSkin(spec)
  applyBlueprintUvs(skin, spec)
  const paint = new Float32Array(skin.getAttribute('position').count * 3).fill(1)
  skin.setAttribute('color', new THREE.BufferAttribute(paint, 3))

  const wheels = [-1, 1].flatMap((side) =>
    [-1, 1].flatMap((end) => {
      const x = side * (spec.halfWidth - 0.08)
      const z = end * spec.wheelBase
      const r = spec.wheelRadius
      const parts = [
        wheelPart(x, z, r, 0.2, '#131416'),
        wheelPart(x + side * 0.015, z, r * 0.62, 0.2, '#a9acb1'),
        wheelPart(x + side * 0.02, z, r * 0.22, 0.2, '#4b4e53'),
      ]
      parts.forEach((part) => part.translate(0, r, 0))
      return parts
    }),
  )

  const merged = mergeGeometries([skin, ...wheels])
  if (!merged) throw new Error('Could not merge car geometry')
  return merged
}

/** Paints the side, top, front and back of a car into one image. */
export function createCarTexture(spec: CarSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const context = canvas.getContext('2d')
  const { back, length } = lengthOf(toStations(spec))
  const size = TEXTURE_SIZE

  if (context) {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)

    const px = (z: number) => ((z - back) / length) * size
    const sideY = (y: number) => size * (1 - (0.66 + (y / MAX_HEIGHT) * 0.34))
    const topY = (x: number) => size * (1 - (0.33 + (x / (spec.halfWidth * 2) + 0.5) * 0.33))
    const glass = '#10161b'
    const seam = 'rgb(0 0 0 / 55%)'

    const polygon = (points: [number, number][], fill: string) => {
      context.fillStyle = fill
      context.beginPath()
      points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
      context.closePath()
      context.fill()
    }
    const line = (x1: number, y1: number, x2: number, y2: number, color = seam, width = 2) => {
      context.strokeStyle = color
      context.lineWidth = width
      context.beginPath()
      context.moveTo(x1, y1)
      context.lineTo(x2, y2)
      context.stroke()
    }

    // The side: windows, door seams, handles, a dark sill and wheel arches.
    const belt = 0.95
    const roof = spec.roofHeight - 0.03
    polygon(
      [
        [px(spec.windowBack), sideY(belt)],
        [px(spec.windowBackTop), sideY(roof)],
        [px(spec.windowFrontTop), sideY(roof)],
        [px(spec.windowFront), sideY(belt)],
      ],
      glass,
    )
    line(px(spec.doorSplit), sideY(belt - 0.02), px(spec.doorSplit), sideY(roof), '#ffffff', 11)
    for (const z of [spec.doorSplit, spec.windowFront - 0.05, spec.windowBack + 0.35]) {
      line(px(z), sideY(belt), px(z - 0.02), sideY(0.34))
    }
    line(px(back), sideY(0.68), px(back + length), sideY(0.68), 'rgb(0 0 0 / 20%)', 3)
    context.fillStyle = '#5a5d62'
    context.fillRect(px(spec.doorSplit) + 12, sideY(0.8), 26, 6)
    context.fillRect(px(spec.doorSplit) - 110, sideY(0.8), 26, 6)
    context.fillStyle = '#17181a'
    context.fillRect(0, sideY(0.38), size, sideY(0) - sideY(0.38))
    for (const z of [-spec.wheelBase, spec.wheelBase]) {
      context.beginPath()
      context.arc(px(z), sideY(spec.wheelRadius), (spec.wheelRadius + 0.05) * (size / length), 0, Math.PI * 2)
      context.fill()
    }

    // The top: windscreen, rear window and seams around the bonnet and boot.
    const across = spec.halfWidth * 0.84
    for (const [from, to] of [spec.windscreen, spec.rearWindow]) {
      polygon(
        [
          [px(from), topY(-across)],
          [px(to), topY(-across)],
          [px(to), topY(across)],
          [px(from), topY(across)],
        ],
        glass,
      )
    }
    line(px(spec.windscreen[1]) + 40, topY(-across), px(spec.windscreen[1]) + 40, topY(across))
    line(px(back + length) - 60, topY(-across), px(spec.windscreen[1]) + 40, topY(-across))
    line(px(back + length) - 60, topY(across), px(spec.windscreen[1]) + 40, topY(across))

    // The ends. Across each half of the image is the car's width.
    const endY = (y: number) => size * (1 - (y / MAX_HEIGHT) * 0.33)
    const front = (amount: number) => size * (0.5 + amount * 0.5)
    const rear = (amount: number) => size * (amount * 0.5)
    const end = (place: (amount: number) => number, from: number, to: number, y1: number, y2: number, fill: string) => {
      context.fillStyle = fill
      context.fillRect(place(from), endY(y2), place(to) - place(from), endY(y1) - endY(y2))
    }

    end(rear, 0, 1, 0.3, 0.46, '#17181a')
    end(rear, 0.06, 0.34, 0.68, 0.84, '#a51d16')
    end(rear, 0.66, 0.94, 0.68, 0.84, '#a51d16')
    end(rear, 0.08, 0.2, 0.71, 0.78, '#e9e4d8')
    end(rear, 0.8, 0.92, 0.71, 0.78, '#e9e4d8')
    end(rear, 0.38, 0.62, 0.5, 0.62, '#f4f4f0')
    if (spec === HATCHBACK) end(rear, 0.1, 0.9, 0.98, 1.4, glass)

    end(front, 0, 1, 0.3, 0.42, '#17181a')
    end(front, 0.3, 0.7, 0.52, 0.66, '#1e2024')
    end(front, 0.05, 0.28, 0.6, 0.72, '#f6f7f2')
    end(front, 0.72, 0.95, 0.6, 0.72, '#f6f7f2')
    end(front, 0.39, 0.61, 0.33, 0.41, '#f4f4f0')
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * Paint looks like paint because it mirrors its surroundings. This is a tiny
 * painted world of sky, skyline and road, for shiny things to reflect.
 */
export function getStreetReflection(renderer: THREE.WebGLRenderer): THREE.Texture {
  const existing = reflections.get(renderer)
  if (existing) return existing

  const created = createStreetReflection(renderer)
  reflections.set(renderer, created)
  return created
}

const reflections = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()

function createStreetReflection(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene()

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vDirection;
        void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDirection;
        void main() {
          float height = normalize(vDirection).y;
          vec3 sky = mix(vec3(1.35, 1.42, 1.5), vec3(0.42, 0.62, 0.95), smoothstep(0.0, 0.7, height));
          vec3 road = vec3(0.13, 0.13, 0.14);
          gl_FragColor = vec4(height > 0.0 ? sky : road, 1.0);
        }`,
    }),
  )
  scene.add(dome)

  // Dark blocks around the horizon: the buildings along the street.
  const blockMaterial = new THREE.MeshBasicMaterial({ color: '#39393c' })
  for (let block = 0; block < 12; block++) {
    const angle = (block / 12) * Math.PI * 2
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2 + (block % 3) * 0.8, 1), blockMaterial)
    mesh.position.set(Math.sin(angle) * 8, 0.6 + (block % 3) * 0.4, Math.cos(angle) * 8)
    mesh.rotation.y = angle
    scene.add(mesh)
  }

  const generator = new THREE.PMREMGenerator(renderer)
  const reflection = generator.fromScene(scene, 0.01).texture
  generator.dispose()
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose()
  })
  return reflection
}
