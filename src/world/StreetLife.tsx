import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { chunkKey } from './chunks'
import { ChunkedMesh } from './ChunkedMesh'
import type { Prop } from './props'
import { PropInstances } from './RoadsideProps'
import { BOARD_FONT_CHECK, KANNADA_SAMPLE } from './signboards'
import { box, colored, merge } from './simpleShapes'
import { CART_KINDS, cartKind, toKannadaRoadName, type StreetLife as Life, type StreetSign } from './streetPlacement'

const SIGN_FONT = "'Baloo Tamma 2', 'Kannada Sangam MN', 'Noto Sans Kannada', 'Tunga', sans-serif"

/** Kolams and name boards are small, so they're only drawn this close, in metres. */
const KOLAM_DISTANCE = 110
const SIGN_DISTANCE = 220

/** Collects flat faces with texture coordinates, sorted by map square. */
class QuadBuilder {
  private squares = new Map<number, { positions: number[]; normals: number[]; uvs: number[] }>()

  /** Corners go bottom-left, bottom-right, top-right, top-left, as seen from the front. */
  quad(corners: THREE.Vector3[], normal: THREE.Vector3, [u0, v0, u1, v1]: number[]) {
    const key = chunkKey(corners[0].x, corners[0].z)
    let square = this.squares.get(key)
    if (!square) {
      square = { positions: [], normals: [], uvs: [] }
      this.squares.set(key, square)
    }
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]
    for (const index of [0, 1, 2, 0, 2, 3]) {
      square.positions.push(corners[index].x, corners[index].y, corners[index].z)
      square.normals.push(normal.x, normal.y, normal.z)
      square.uvs.push(uvs[index][0], uvs[index][1])
    }
  }

  toGeometries(): THREE.BufferGeometry[] {
    return [...this.squares.values()].map(({ positions, normals, uvs }) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geometry.computeBoundingSphere()
      return geometry
    })
  }
}

// ---------------------------------------------------------------- Kolams

/** Four patterns share one image, two across and two down. */
const KOLAM_CELL = 256
const KOLAM_SIZE = 1.5
const KOLAM_HEIGHT = 0.065
const RICE_FLOUR = '#f7f4ec'
const KOLAM_PINK = 'rgba(226, 74, 134, 0.9)'
const KOLAM_YELLOW = 'rgba(240, 190, 40, 0.9)'

function dot(context: CanvasRenderingContext2D, x: number, y: number, radius = 5) {
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

/** Each is drawn around (0, 0), in a square 256 across. */
const KOLAM_PATTERNS: ((context: CanvasRenderingContext2D) => void)[] = [
  // A lotus: eight petals round a ring, filled in turn with pink and yellow powder.
  (c) => {
    for (let petal = 0; petal < 8; petal++) {
      c.save()
      c.rotate((petal * Math.PI) / 4)
      c.beginPath()
      c.moveTo(0, -22)
      c.quadraticCurveTo(40, -66, 0, -108)
      c.quadraticCurveTo(-40, -66, 0, -22)
      c.fillStyle = petal % 2 ? KOLAM_PINK : KOLAM_YELLOW
      c.fill()
      c.stroke()
      c.restore()
    }
    c.beginPath()
    c.arc(0, 0, 20, 0, Math.PI * 2)
    c.stroke()
    c.fillStyle = RICE_FLOUR
    for (let between = 0; between < 8; between++) {
      const angle = ((between + 0.5) * Math.PI) / 4
      dot(c, Math.cos(angle) * 104, Math.sin(angle) * 104)
    }
  },
  // A star: two squares, one turned, with a loop at each point.
  (c) => {
    for (const turn of [0, Math.PI / 4]) {
      c.save()
      c.rotate(turn)
      c.strokeRect(-70, -70, 140, 140)
      c.restore()
    }
    c.beginPath()
    c.arc(0, 0, 36, 0, Math.PI * 2)
    c.fillStyle = KOLAM_PINK
    c.fill()
    c.stroke()
    for (let point = 0; point < 8; point++) {
      const angle = (point * Math.PI) / 4
      c.beginPath()
      c.arc(Math.cos(angle) * 108, Math.sin(angle) * 108, 10, 0, Math.PI * 2)
      c.stroke()
    }
    c.fillStyle = RICE_FLOUR
    dot(c, 0, 0, 7)
  },
  // A pulli kolam: a diamond of dots, 1-3-5-3-1, each with a line looped round it.
  (c) => {
    const gap = 44
    c.fillStyle = RICE_FLOUR
    for (let row = -2; row <= 2; row++) {
      const reach = 2 - Math.abs(row)
      for (let column = -reach; column <= reach; column++) {
        const x = column * gap
        const y = row * gap
        c.beginPath()
        c.moveTo(x, y - 30)
        c.quadraticCurveTo(x + 14, y - 14, x + 30, y)
        c.quadraticCurveTo(x + 14, y + 14, x, y + 30)
        c.quadraticCurveTo(x - 14, y + 14, x - 30, y)
        c.quadraticCurveTo(x - 14, y - 14, x, y - 30)
        c.stroke()
        dot(c, x, y)
      }
    }
  },
  // A sun: rings, with twelve rays.
  (c) => {
    c.beginPath()
    c.arc(0, 0, 60, 0, Math.PI * 2)
    c.fillStyle = KOLAM_YELLOW
    c.fill()
    c.stroke()
    c.beginPath()
    c.arc(0, 0, 28, 0, Math.PI * 2)
    c.fillStyle = KOLAM_PINK
    c.fill()
    c.stroke()
    for (let ray = 0; ray < 12; ray++) {
      c.save()
      c.rotate((ray * Math.PI) / 6)
      c.beginPath()
      c.moveTo(-14, -66)
      c.lineTo(0, -112)
      c.lineTo(14, -66)
      c.stroke()
      c.restore()
    }
    c.fillStyle = RICE_FLOUR
    dot(c, 0, 0, 6)
  },
]

function createKolamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = KOLAM_CELL * 2
  canvas.height = KOLAM_CELL * 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not draw the kolams')

  KOLAM_PATTERNS.forEach((draw, index) => {
    context.save()
    context.translate((index % 2) * KOLAM_CELL + KOLAM_CELL / 2, Math.floor(index / 2) * KOLAM_CELL + KOLAM_CELL / 2)
    context.strokeStyle = RICE_FLOUR
    context.lineWidth = 8
    context.lineCap = 'round'
    context.lineJoin = 'round'
    draw(context)
    context.restore()
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function createKolamGeometries(kolams: Prop[]): THREE.BufferGeometry[] {
  const builder = new QuadBuilder()
  const up = new THREE.Vector3(0, 1, 0)
  for (const { x, z, rotation, variation, width = KOLAM_SIZE } of kolams) {
    const half = width / 2
    // Square to the gate: `out` points to the road, `side` runs along the wall.
    const outX = Math.sin(rotation) * half
    const outZ = Math.cos(rotation) * half
    const corner = (side: number, out: number) =>
      new THREE.Vector3(x + outZ * side + outX * out, KOLAM_HEIGHT, z - outX * side + outZ * out)
    const pattern = Math.floor(variation * KOLAM_PATTERNS.length * 0.999)
    const u = (pattern % 2) / 2
    // Images count from the top, textures from the bottom.
    const v = 0.5 - Math.floor(pattern / 2) / 2
    builder.quad([corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)], up, [u, v, u + 0.5, v + 0.5])
  }

  return builder.toGeometries()
}

function Kolams({ kolams }: { kolams: Prop[] }) {
  const geometries = useMemo(() => createKolamGeometries(kolams), [kolams])
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: createKolamTexture(),
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false,
        roughness: 1,
        // Drawn on the paving, so it must win over the pavement and the road.
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      }),
    [],
  )
  useEffect(() => () => material.map?.dispose(), [material])

  return <ChunkedMesh geometries={geometries} material={material} maxDistance={KOLAM_DISTANCE} />
}

// ---------------------------------------------------------------- Street name boards

const SIGN_COLUMNS = 4
const SIGN_CELL = { width: 512, height: 160 }
const SIGN_BOARD = { width: 1.6, height: 0.5, bottom: 2.1, gap: 0.045 }
const SIGN_POLE = { width: 0.07, height: 2.6 }
const SIGN_BLUE = '#17479e'
const SIGN_POLE_COLOR = '#6f7479'

/** Where a board's picture is in the atlas: [left, bottom, right, top], counted from the bottom as textures are. */
function signCell(index: number, rows: number): number[] {
  const column = index % SIGN_COLUMNS
  const row = Math.floor(index / SIGN_COLUMNS)
  return [column / SIGN_COLUMNS, 1 - (row + 1) / rows, (column + 1) / SIGN_COLUMNS, 1 - row / rows]
}

/** Paints every road's board. Cell 0 is plain grey, for the poles. */
function paintSigns(canvas: HTMLCanvasElement, names: string[]) {
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = SIGN_CELL

  context.fillStyle = SIGN_POLE_COLOR
  context.fillRect(0, 0, width, height)

  names.forEach((name, index) => {
    const cell = index + 1
    const left = (cell % SIGN_COLUMNS) * width
    const top = Math.floor(cell / SIGN_COLUMNS) * height

    context.fillStyle = SIGN_BLUE
    context.fillRect(left, top, width, height)
    context.strokeStyle = '#ffffff'
    context.lineWidth = 5
    context.beginPath()
    context.roundRect(left + 9, top + 9, width - 18, height - 18, 14)
    context.stroke()

    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const kannada = toKannadaRoadName(name)
    const write = (text: string, weight: number, size: number, y: number) => {
      context.font = `${weight} ${size}px ${SIGN_FONT}`
      // Long names are squeezed to fit, as sign painters do.
      context.fillText(text, left + width / 2, top + y, width - 44)
    }
    if (kannada) {
      write(kannada, 700, 56, 58)
      write(name, 600, 40, 116)
    } else {
      write(name, 700, 46, 62)
      write('HSR Layout', 500, 30, 114)
    }
  })
}

function createSignGeometries(signs: StreetSign[], names: string[]): THREE.BufferGeometry[] {
  const builder = new QuadBuilder()
  const rows = Math.ceil((names.length + 1) / SIGN_COLUMNS)
  const [poleLeft, poleBottom, poleRight, poleTop] = signCell(0, rows)
  // One spot in the grey cell, so the pole is a single colour.
  const poleUv = [(poleLeft + poleRight) / 2, (poleBottom + poleTop) / 2]
  const grey = [poleUv[0], poleUv[1], poleUv[0], poleUv[1]]

  for (const { x, z, alongX, alongZ, name } of signs) {
    const face = signCell(names.indexOf(name) + 1, rows)

    for (const way of [1, -1]) {
      // A face looking along `normal` has the reader's right-hand side at up × normal.
      const normal = new THREE.Vector3(alongX * way, 0, alongZ * way)
      const right = new THREE.Vector3(normal.z, 0, -normal.x)
      const corner = (across: number, y: number, out: number) =>
        new THREE.Vector3(x + right.x * across + normal.x * out, y, z + right.z * across + normal.z * out)

      const halfBoard = SIGN_BOARD.width / 2
      const top = SIGN_BOARD.bottom + SIGN_BOARD.height
      builder.quad(
        [
          corner(-halfBoard, SIGN_BOARD.bottom, SIGN_BOARD.gap),
          corner(halfBoard, SIGN_BOARD.bottom, SIGN_BOARD.gap),
          corner(halfBoard, top, SIGN_BOARD.gap),
          corner(-halfBoard, top, SIGN_BOARD.gap),
        ],
        normal,
        face,
      )

      // Two of the pole's four sides: one facing this way, one facing to its right.
      const halfPole = SIGN_POLE.width / 2
      builder.quad(
        [
          corner(-halfPole, 0, halfPole),
          corner(halfPole, 0, halfPole),
          corner(halfPole, SIGN_POLE.height, halfPole),
          corner(-halfPole, SIGN_POLE.height, halfPole),
        ],
        normal,
        grey,
      )
      builder.quad(
        [
          corner(halfPole, 0, halfPole),
          corner(halfPole, 0, -halfPole),
          corner(halfPole, SIGN_POLE.height, -halfPole),
          corner(halfPole, SIGN_POLE.height, halfPole),
        ],
        right,
        grey,
      )
    }
  }

  return builder.toGeometries()
}

function StreetSigns({ signs }: { signs: StreetSign[] }) {
  const names = useMemo(() => [...new Set(signs.map(({ name }) => name))].sort(), [signs])
  const geometries = useMemo(() => createSignGeometries(signs, names), [signs, names])

  const { material, canvas } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = SIGN_CELL.width * SIGN_COLUMNS
    canvas.height = SIGN_CELL.height * Math.ceil((names.length + 1) / SIGN_COLUMNS)
    paintSigns(canvas, names)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return { material: new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }), canvas }
  }, [names])

  // Paint again once the Kannada letters have arrived.
  useEffect(() => {
    let live = true
    document.fonts?.load(BOARD_FONT_CHECK, KANNADA_SAMPLE).then(
      () => {
        if (!live) return
        paintSigns(canvas, names)
        if (material.map) material.map.needsUpdate = true
      },
      () => {},
    )
    return () => {
      live = false
      material.map?.dispose()
    }
  }, [canvas, material, names])

  return <ChunkedMesh geometries={geometries} material={material} maxDistance={SIGN_DISTANCE} />
}

// ---------------------------------------------------------------- Vendors' carts

/** A shape with flat faces and one colour, ready to merge with boxes. */
function part(geometry: THREE.BufferGeometry, color: string, position: [number, number, number]): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  if (flat !== geometry) geometry.dispose()
  flat.translate(...position)
  return colored(flat, color)
}

/** The same shape seen from inside: each triangle's corners in the opposite order. */
function insideOut(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flipped = geometry.clone()
  const position = flipped.getAttribute('position')
  for (let corner = 0; corner < position.count; corner += 3) {
    const [x, y, z] = [position.getX(corner + 1), position.getY(corner + 1), position.getZ(corner + 1)]
    position.setXYZ(corner + 1, position.getX(corner + 2), position.getY(corner + 2), position.getZ(corner + 2))
    position.setXYZ(corner + 2, x, y, z)
  }
  flipped.computeVertexNormals()
  return flipped
}

/** A big garden umbrella in two colours, panel by panel. */
function umbrella(first: string, second: string, at: [number, number, number]): THREE.BufferGeometry[] {
  const SIDES = 8
  const cone = new THREE.ConeGeometry(1.2, 0.42, SIDES, 1, true).toNonIndexed()
  cone.translate(...at)
  cone.deleteAttribute('uv')
  const count = cone.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  const pair = [new THREE.Color(first), new THREE.Color(second)]
  const perSide = count / SIDES
  for (let corner = 0; corner < count; corner++) {
    const { r, g, b } = pair[Math.floor(corner / perSide) % 2]
    colors.set([r, g, b], corner * 3)
  }
  cone.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // The underside, a little darker, or the umbrella would vanish from below.
  const under = insideOut(cone)
  const shade = under.getAttribute('color')
  for (let corner = 0; corner < shade.count; corner++) {
    shade.setXYZ(corner, shade.getX(corner) * 0.7, shade.getY(corner) * 0.7, shade.getZ(corner) * 0.7)
  }

  const pole = part(new THREE.CylinderGeometry(0.025, 0.025, at[1] - 0.9, 5), '#c9ccd0', [at[0], (at[1] + 0.9) / 2, at[2]])
  return [cone, under, pole]
}

/** A heap of round things: one ball per entry, [x, y, z, radius], squashed a little. */
function heap(balls: number[][], colors: string[]): THREE.BufferGeometry[] {
  return balls.map(([x, y, z, radius], index) => {
    const ball = new THREE.IcosahedronGeometry(radius, 0)
    ball.rotateY(index * 1.3)
    ball.scale(1, 0.85, 1)
    return part(ball, colors[index % colors.length], [x, y, z])
  })
}

/** The cart itself: a painted bed on four cycle wheels, with a push bar. X is its length. */
function cartBody(paint: string): THREE.BufferGeometry[] {
  const BED = 0.86
  const parts = [
    box([1.8, 0.07, 1.0], [0, BED, 0], paint),
    box([1.8, 0.14, 0.04], [0, BED + 0.1, 0.48], paint),
    box([1.8, 0.14, 0.04], [0, BED + 0.1, -0.48], paint),
    box([0.04, 0.14, 1.0], [0.88, BED + 0.1, 0], paint),
    box([0.04, 0.14, 1.0], [-0.88, BED + 0.1, 0], paint),
    // The frame under the bed, and the bar it's pushed by.
    box([1.5, 0.05, 0.05], [0, 0.62, 0.36], '#3a3d41'),
    box([1.5, 0.05, 0.05], [0, 0.62, -0.36], '#3a3d41'),
    box([0.05, 0.3, 0.05], [-0.98, 1.0, 0.4], '#3a3d41'),
    box([0.05, 0.3, 0.05], [-0.98, 1.0, -0.4], '#3a3d41'),
    box([0.05, 0.05, 0.9], [-0.98, 1.14, 0], '#3a3d41'),
  ]
  for (const x of [-0.55, 0.55]) {
    for (const z of [-0.56, 0.56]) {
      const tyre = new THREE.CylinderGeometry(0.34, 0.34, 0.045, 12)
      tyre.rotateX(Math.PI / 2)
      parts.push(part(tyre, '#1c1d1f', [x, 0.34, z]))
      const hub = new THREE.CylinderGeometry(0.26, 0.26, 0.05, 12)
      hub.rotateX(Math.PI / 2)
      parts.push(part(hub, '#b9bcc0', [x, 0.34, z]))
    }
    parts.push(box([0.04, 0.3, 1.1], [x, 0.48, 0], '#3a3d41'))
  }
  return parts
}

/** Tender coconuts, vegetables, flowers: in the order `cartKind` numbers them. */
function createCartGeometries(): THREE.BufferGeometry[] {
  const TOP = 0.9

  // Tender coconuts: a green pile, three deep.
  const coconuts: number[][] = []
  for (let layer = 0; layer < 3; layer++) {
    const across = 3 - layer
    for (let row = 0; row < across; row++) {
      for (let column = 0; column < across + 2; column++) {
        coconuts.push([
          (column - (across + 1) / 2) * 0.3,
          TOP + 0.14 + layer * 0.24,
          (row - (across - 1) / 2) * 0.3,
          0.16,
        ])
      }
    }
  }
  const coconutCart = merge([
    ...cartBody('#2f7d4f'),
    ...heap(coconuts, ['#5c9a3a', '#6fae45', '#4f8a35', '#8fb04a']),
    ...umbrella('#e8b923', '#2f7d4f', [0, 2.55, 0]),
  ])

  // Vegetables: a heap of each, side by side.
  const heapAt = (x: number, z: number, size: number): number[][] => [
    [x, TOP + 0.08, z, size],
    [x + size * 0.9, TOP + 0.07, z + size * 0.5, size * 0.8],
    [x - size * 0.8, TOP + 0.07, z + size * 0.4, size * 0.8],
    [x + size * 0.2, TOP + 0.07, z - size * 0.9, size * 0.8],
    [x, TOP + 0.08 + size * 0.9, z, size * 0.75],
  ]
  const vegetableCart = merge([
    ...cartBody('#2f6fa3'),
    ...heap(heapAt(-0.55, 0.18, 0.15), ['#d83a2a']),
    ...heap(heapAt(0, 0.2, 0.14), ['#e9862a']),
    ...heap(heapAt(0.55, 0.18, 0.15), ['#5a2d6e']),
    ...heap(heapAt(-0.4, -0.25, 0.15), ['#4d9440', '#6aa84a']),
    ...heap(heapAt(0.3, -0.25, 0.14), ['#d9c9a0', '#c98a9a']),
    ...umbrella('#d83a2a', '#f4f1ea', [0, 2.55, 0]),
  ])

  // Flowers: marigold and jasmine in mounds, and garlands hanging from a rail.
  const garlands = [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6].map((x, index) =>
    box([0.07, 0.55, 0.07], [x, 1.62, 0.4], ['#f08a1c', '#f3c623', '#f4f1ea'][index % 3]),
  )
  const flowerCart = merge([
    ...cartBody('#a8432f'),
    ...heap(heapAt(-0.5, 0, 0.2), ['#f08a1c', '#f39a2a']),
    ...heap(heapAt(0.05, -0.05, 0.19), ['#f3c623', '#f6d84a']),
    ...heap(heapAt(0.58, 0, 0.17), ['#f4f1ea']),
    box([0.04, 1.05, 0.04], [-0.75, 1.42, 0.4], '#3a3d41'),
    box([0.04, 1.05, 0.04], [0.75, 1.42, 0.4], '#3a3d41'),
    box([1.54, 0.04, 0.04], [0, 1.93, 0.4], '#3a3d41'),
    ...garlands,
    ...umbrella('#c2278f', '#f3c623', [0, 2.6, -0.1]),
  ])

  return [coconutCart, vegetableCart, flowerCart]
}

function VendorCarts({ carts }: { carts: Prop[] }) {
  const geometries = useMemo(() => createCartGeometries(), [])
  const byKind = useMemo(
    () => Array.from({ length: CART_KINDS }, (_, kind) => carts.filter((cart) => cartKind(cart) === kind)),
    [carts],
  )
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries])

  return (
    <>
      {geometries.map((geometry, kind) => (
        <PropInstances key={kind} props={byKind[kind]} geometry={geometry} color="#ffffff" sizeRange={0} vertexColors />
      ))}
    </>
  )
}

/** The small things that make a street HSR's: kolams at the gates, name boards, and vendors' carts. */
export function StreetLife({ life, kolams }: { life: Life; kolams: Prop[] }) {
  return (
    <>
      <Kolams kolams={kolams} />
      <StreetSigns signs={life.signs} />
      <VendorCarts carts={life.carts} />
    </>
  )
}
